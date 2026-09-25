/**
 * TCP の再送と輻輳制御（Reno 相当）
 *
 * 根拠:
 * - RFC 5681 §3.1（Slow Start and Congestion Avoidance）: cwnd < ssthresh の間はスロースタート（ACK ごとに cwnd を最大 1 SMSS 増やす）、
 *   それ以降は輻輳回避（1 RTT あたり約 1 SMSS 増やす）。RTO が満了したら ssthresh = max(FlightSize / 2, 2 SMSS)、cwnd = 1 SMSS（loss window）
 * - RFC 5681 §3.2（Fast Retransmit/Fast Recovery）: 3 つ目の重複 ACK で失われたセグメントを再送し、ssthresh = max(FlightSize / 2, 2 SMSS)、
 *   cwnd = ssthresh + 3 SMSS。新しいデータを確認応答する ACK が届いたら cwnd = ssthresh に戻す
 * - RFC 6298 §5: RTO が満了したら、確認応答されていない最初のセグメントを再送する
 *
 * 学習用の単純化:
 * - 1 ステップ = 1 往復（ラウンド）とし、そのラウンドのセグメントと ACK をそれぞれ 1 つのメッセージにまとめる
 * - cwnd と ssthresh はセグメント数（MSS 単位）で数え、セグメントには 1 から番号を振る（Seq はバイトではなくセグメントの番号）
 * - 初期値は cwnd = 1、ssthresh = 8。RFC 5681 の初期ウィンドウは 2〜4 SMSS（RFC 6928 では 10）で、ssthresh の初期値は任意に大きくてよい
 * - 高速リカバリ中の cwnd の一時的な増加（重複 ACK ごとに +1）と、その間に送れる新しいセグメントは省略する
 */
import { z } from 'zod'
import type {
  Actor,
  ActorId,
  Message,
  Scenario,
  StateKey,
  StateTable,
  Step,
  StepEvent,
} from '@/engine/types'
import type { LocalizedText } from '@/lib/i18n/locale'

const optionsSchema = z.object({
  loss: z.enum(['none', 'dupack', 'rto']).catch('none'),
})
export type TcpCongestionOptions = z.infer<typeof optionsSchema>
export type LossMode = TcpCongestionOptions['loss']

const SENDER: ActorId = 'client'
const RECEIVER: ActorId = 'server'
export const CWND: StateKey = 'cwnd'
export const SSTHRESH: StateKey = 'ssthresh'
export const CWND_HISTORY: StateKey = 'cwndHistory'
export const CWND_HISTORY_COLUMNS = ['round', 'cwnd', 'ssthresh', 'event'] as const

const INITIAL_CWND = 1
const INITIAL_SSTHRESH = 8
/** RFC 6298 §2.4 の下限（1 秒）。実際の RTO は測った RTT から計算する */
const RTO_MS = 1000

/** 図の表示（cwndHistory の event 列）。グラフの凡例と合わせるため、翻訳しない */
export const EVENTS = {
  slowStart: 'slow start',
  congestionAvoidance: 'congestion avoidance',
  fastRetransmit: '3 dup ACKs',
  rto: 'RTO',
} as const

const actors: readonly Actor[] = [
  {
    id: SENDER,
    kind: 'client',
    name: { en: 'Sender', ja: '送信側' },
    stateSlots: [
      {
        key: CWND,
        label: {
          en: 'cwnd (congestion window, segments)',
          ja: 'cwnd（輻輳ウィンドウ、セグメント数）',
        },
        initial: '-',
      },
      {
        key: SSTHRESH,
        label: {
          en: 'ssthresh (slow start threshold)',
          ja: 'ssthresh（スロースタートのしきい値）',
        },
        initial: '-',
      },
      {
        key: CWND_HISTORY,
        label: { en: 'cwnd in each round', ja: 'ラウンドごとの cwnd' },
        initial: { columns: CWND_HISTORY_COLUMNS, rows: [] },
      },
    ],
  },
  { id: RECEIVER, kind: 'server', name: { en: 'Receiver', ja: '受信側' }, stateSlots: [] },
]

const set = (key: StateKey, value: string | number | StateTable): StepEvent => ({
  kind: 'stateChange',
  actorId: SENDER,
  key,
  value: typeof value === 'number' ? String(value) : value,
})
const send = (message: Message): StepEvent => ({ kind: 'message', message })

/** セグメントの番号の範囲（`8–15`） */
function range(first: number, count: number): string {
  return count === 1 ? String(first) : `${String(first)}–${String(first + count - 1)}`
}

function dataMessage(
  id: string,
  first: number,
  count: number,
  status: Message['status'],
  extra: Partial<Pick<Message, 'retransmitOf'>> = {},
): Message {
  return {
    id,
    from: SENDER,
    to: RECEIVER,
    label:
      count === 1 ? `DATA #${String(first)}` : `DATA #${range(first, count)} (×${String(count)})`,
    status,
    ...extra,
    description: {
      en: 'Data segments sent in this round, summarized as one message.',
      ja: 'このラウンドで送るデータのセグメント（1 つのメッセージにまとめている）。',
    },
    fields: [
      {
        name: 'Segments',
        value: range(first, count),
        highlight: true,
        description: {
          en: 'Segment numbers (this page counts segments, not bytes)',
          ja: 'セグメントの番号（このページではバイトではなくセグメントで数える）',
        },
      },
      {
        name: 'Count',
        value: String(count),
        description: {
          en: 'The sender may have at most cwnd segments in flight.',
          ja: '送信側は、確認応答されていないセグメントを cwnd 個まで送れる。',
        },
      },
    ],
  }
}

function ackMessage(id: string, acks: string, summary: LocalizedText, count: number): Message {
  return {
    id,
    from: RECEIVER,
    to: SENDER,
    label: count === 1 ? `ACK ${acks}` : `ACK ×${String(count)}`,
    status: 'delivered',
    description: summary,
    fields: [
      {
        name: 'Ack',
        value: acks,
        highlight: true,
        description: {
          en: 'The next segment number the receiver expects (cumulative acknowledgment)',
          ja: '受信側が次に受け取りたいセグメントの番号（累積の確認応答）',
        },
      },
      {
        name: 'Count',
        value: String(count),
        description: { en: 'Number of ACKs in this round', ja: 'このラウンドの ACK の数' },
      },
    ],
  }
}

interface Round {
  readonly cwnd: number
  readonly ssthresh: number
  readonly event: string
}

/** 送信側の状態と、ラウンドごとの記録を組み立てる */
class History {
  private readonly rows: (readonly string[])[] = []

  record(round: Round): StepEvent {
    this.rows.push([
      String(this.rows.length + 1),
      String(round.cwnd),
      String(round.ssthresh),
      round.event,
    ])
    return set(CWND_HISTORY, { columns: CWND_HISTORY_COLUMNS, rows: [...this.rows] })
  }
}

/** 損失のない 1 ラウンド。cwnd 個のセグメントを送り、すべて確認応答される */
function normalRound(
  history: History,
  roundNumber: number,
  first: number,
  cwnd: number,
  ssthresh: number,
): { step: Step; next: number; cwnd: number } {
  const slowStart = cwnd < ssthresh
  // スロースタートは ACK ごとに +1（ただし ssthresh を超えない）、輻輳回避は 1 RTT あたり +1
  const nextCwnd = slowStart ? Math.min(cwnd * 2, ssthresh) : cwnd + 1
  const round = String(roundNumber)
  return {
    next: first + cwnd,
    cwnd: nextCwnd,
    step: {
      id: `round-${round}`,
      title: slowStart
        ? {
            en: `Round ${round}: slow start (cwnd ${String(cwnd)} → ${String(nextCwnd)})`,
            ja: `ラウンド ${round}: スロースタート（cwnd ${String(cwnd)} → ${String(nextCwnd)}）`,
          }
        : {
            en: `Round ${round}: congestion avoidance (cwnd ${String(cwnd)} → ${String(nextCwnd)})`,
            ja: `ラウンド ${round}: 輻輳回避（cwnd ${String(cwnd)} → ${String(nextCwnd)}）`,
          },
      description: slowStart
        ? {
            en: `The sender sends ${String(cwnd)} ${cwnd === 1 ? 'segment' : 'segments'}. In slow start, each ACK increases cwnd by one segment, so cwnd doubles every round trip${nextCwnd === ssthresh ? ` until it reaches ssthresh (${String(ssthresh)}). From the next round, the sender switches to congestion avoidance` : ''}.`,
            ja: `送信側は ${String(cwnd)} 個のセグメントを送る。スロースタートでは ACK が 1 つ届くたびに cwnd が 1 増えるので、cwnd は 1 往復ごとに倍になる${nextCwnd === ssthresh ? `。ssthresh（${String(ssthresh)}）に達したので、次のラウンドからは輻輳回避に移る` : ''}。`,
          }
        : {
            en: 'cwnd has reached ssthresh, so the sender is in congestion avoidance: cwnd grows by only about one segment per round trip, probing carefully for more capacity.',
            ja: 'cwnd が ssthresh に達しているので、送信側は輻輳回避にいる。cwnd は 1 往復あたり約 1 セグメントしか増やさず、使える帯域を慎重に探る。',
          },
      events: [
        send(dataMessage(`data-${round}`, first, cwnd, 'delivered')),
        send(
          ackMessage(
            `ack-${round}`,
            cwnd === 1 ? String(first + 1) : range(first + 1, cwnd),
            {
              en: 'One ACK for each segment received.',
              ja: '受け取ったセグメントごとに 1 つの ACK。',
            },
            cwnd,
          ),
        ),
        history.record({
          cwnd,
          ssthresh,
          event: slowStart ? EVENTS.slowStart : EVENTS.congestionAvoidance,
        }),
        set(CWND, nextCwnd),
      ],
    },
  }
}

function buildSteps(options: TcpCongestionOptions): readonly Step[] {
  const history = new History()
  const steps: Step[] = [
    {
      id: 'start',
      title: {
        en: 'The sender starts with a small window',
        ja: '送信側は小さなウィンドウから始める',
      },
      description: {
        en: `The connection is established and the sender has plenty of data. It does not know how much the network can carry, so it starts with a congestion window (cwnd) of ${String(INITIAL_CWND)} segment. ssthresh is ${String(INITIAL_SSTHRESH)} on this page (real stacks start it very large and start cwnd at 2 to 10 segments).`,
        ja: `接続は確立していて、送信側には送るデータがたくさんある。ネットワークがどれだけ運べるかわからないので、輻輳ウィンドウ（cwnd）を ${String(INITIAL_CWND)} セグメントから始める。このページでは ssthresh を ${String(INITIAL_SSTHRESH)} にしている（実際の実装では ssthresh は非常に大きい値から、cwnd は 2〜10 セグメントから始める）。`,
      },
      events: [set(CWND, INITIAL_CWND), set(SSTHRESH, INITIAL_SSTHRESH)],
    },
  ]

  let next = 1
  let cwnd = INITIAL_CWND
  let ssthresh = INITIAL_SSTHRESH
  const addRounds = (from: number, to: number) => {
    for (let round = from; round <= to; round++) {
      const result = normalRound(history, round, next, cwnd, ssthresh)
      steps.push(result.step)
      next = result.next
      cwnd = result.cwnd
    }
  }

  // ラウンド 1〜3: スロースタート（1 → 2 → 4 → 8）
  addRounds(1, 3)

  if (options.loss === 'none') {
    // ラウンド 4〜6: 輻輳回避（8 → 9 → 10 → 11）
    addRounds(4, 6)
    return steps
  }

  // ラウンド 4: cwnd = 8 で送ったセグメントの一部（dupack）またはすべて（rto）が失われる
  const first = next
  // このラウンドで送ったセグメントの数（cwnd と同じ）
  const sent = cwnd
  /** RFC 5681 の式（3）: ssthresh = max(FlightSize / 2, 2 SMSS)。FlightSize は、送ったが累積の確認応答をまだ受けていない量（cwnd ではない） */
  const halve = (flightSize: number) => Math.max(Math.floor(flightSize / 2), 2)

  if (options.loss === 'dupack') {
    const lost = first + 2
    const after = first + sent - lost - 1
    // 3 つ目の重複 ACK の時点で、lost 〜 最後のセグメントが確認応答されていない（lost より前は ACK 済み）
    const flight = first + sent - lost
    const halved = halve(flight)
    steps.push({
      id: 'round-4',
      title: {
        en: `Round 4: segment ${String(lost)} is lost`,
        ja: `ラウンド 4: セグメント ${String(lost)} が失われる`,
      },
      description: {
        en: `The sender sends ${String(sent)} segments, and segment ${String(lost)} is lost. The receiver acknowledges up to ${String(lost - 1)} normally. Every later segment is out of order, so each one gets a duplicate ACK that asks for ${String(lost)} again.`,
        ja: `送信側は ${String(sent)} 個のセグメントを送り、セグメント ${String(lost)} が失われる。受信側は ${String(lost - 1)} までは普通に確認応答する。その後のセグメントは順番が抜けているので、どれにも ${String(lost)} をもう一度求める重複 ACK を返す。`,
      },
      events: [
        send(dataMessage('data-4', first, 2, 'delivered')),
        send(dataMessage('data-4-lost', lost, 1, 'lost')),
        send(dataMessage('data-4-rest', lost + 1, after, 'delivered')),
        send(
          ackMessage(
            'ack-4',
            `${range(first + 1, 2)}, ${String(lost)} ×${String(after)} (dup)`,
            {
              en: `Two normal ACKs, then ${String(after)} duplicate ACKs for segment ${String(lost)}.`,
              ja: `普通の ACK が 2 つ、続いてセグメント ${String(lost)} を求める重複 ACK が ${String(after)} 個。`,
            },
            2 + after,
          ),
        ),
        history.record({ cwnd: sent, ssthresh, event: EVENTS.fastRetransmit }),
      ],
    })
    const inflated = halved + 3
    steps.push(
      {
        id: 'fast-retransmit',
        title: {
          en: 'Three duplicate ACKs: fast retransmit',
          ja: '重複 ACK が 3 つ届いた: 高速再送',
        },
        description: {
          en: `Three duplicate ACKs strongly suggest that one segment was lost while later ones still arrive. Without waiting for the RTO, the sender retransmits segment ${String(lost)} and sets ssthresh to half of the data in flight: segments ${range(lost, flight)} (${String(flight)} segments) are sent but not yet acknowledged, so ${String(flight)} / 2 = ${String(halved)}. It then sets cwnd to ssthresh + 3 = ${String(inflated)} for fast recovery. (Each further duplicate ACK temporarily inflates cwnd by one; this page leaves that out.)`,
          ja: `重複 ACK が 3 つ届くのは、1 つのセグメントが失われ、後のセグメントは届いているしるし。送信側は RTO を待たずにセグメント ${String(lost)} を再送し、ssthresh を送信中のデータの半分にする。セグメント ${range(lost, flight)}（${String(flight)} 個）が送ったまま確認応答されていないので、${String(flight)} / 2 = ${String(halved)}。そして高速リカバリのため cwnd を ssthresh + 3 = ${String(inflated)} にする（その後の重複 ACK のたびに cwnd を一時的に 1 ずつ増やすが、このページでは省略する）。`,
        },
        events: [
          send(dataMessage('data-rtx', lost, 1, 'delivered', { retransmitOf: 'data-4-lost' })),
          set(SSTHRESH, halved),
          set(CWND, inflated),
        ],
      },
      {
        id: 'recovery-ack',
        title: {
          en: `The retransmission is acknowledged (cwnd → ${String(halved)})`,
          ja: `再送が確認応答される（cwnd → ${String(halved)}）`,
        },
        description: {
          en: `The retransmitted segment fills the gap, so the receiver acknowledges everything up to segment ${String(first + sent - 1)} at once. Fast recovery ends and cwnd is set back to ssthresh (${String(halved)}). The sender continues in congestion avoidance, without going back to slow start.`,
          ja: `再送したセグメントで抜けが埋まったので、受信側はセグメント ${String(first + sent - 1)} までをまとめて確認応答する。高速リカバリが終わり、cwnd は ssthresh（${String(halved)}）に戻る。送信側はスロースタートに戻らず、輻輳回避を続ける。`,
        },
        events: [
          send(
            ackMessage(
              'ack-rtx',
              String(first + sent),
              {
                en: 'A cumulative ACK for everything received so far.',
                ja: 'ここまでに受け取ったすべてへの累積の ACK。',
              },
              1,
            ),
          ),
          set(CWND, halved),
        ],
      },
    )
    next = first + sent
    cwnd = halved
    ssthresh = halved
    addRounds(5, 6)
    return steps
  }

  // rto: 重複 ACK が 3 つ届かない（ここではラウンドのセグメントがすべて失われる）。どれも確認応答されていないので、FlightSize = sent
  const flight = sent
  const halved = halve(flight)
  steps.push(
    {
      id: 'round-4',
      title: {
        en: 'Round 4: all segments of the round are lost',
        ja: 'ラウンド 4: ラウンドのセグメントがすべて失われる',
      },
      description: {
        en: `The sender sends ${String(flight)} segments, but all of them are lost (for example, a router’s queue overflowed). No ACK comes back, so there are no duplicate ACKs either.`,
        ja: `送信側は ${String(flight)} 個のセグメントを送るが、すべて失われる（たとえばルーターのキューがあふれた）。ACK は 1 つも返ってこないので、重複 ACK も届かない。`,
      },
      events: [
        send(dataMessage('data-4', first, flight, 'lost')),
        history.record({ cwnd: flight, ssthresh, event: EVENTS.rto }),
      ],
    },
    {
      id: 'rto',
      title: {
        en: 'Round 5: RTO expires, back to slow start (cwnd 1 → 2)',
        ja: 'ラウンド 5: RTO が満了し、スロースタートからやり直す（cwnd 1 → 2）',
      },
      description: {
        en: `The retransmission timer expires. The sender takes this as a sign of heavy congestion: it sets ssthresh to half of the data in flight (none of the ${String(flight)} segments was acknowledged, so ${String(flight)} / 2 = ${String(halved)}), drops cwnd to 1 segment, and retransmits the first unacknowledged segment (${String(first)}). It then goes through slow start again, resending segments ${range(first + 1, flight - 1)} before any new data.`,
        ja: `再送タイマーが満了する。送信側はこれを激しい輻輳のしるしと受け取り、ssthresh を送信中のデータの半分にし（${String(flight)} 個のセグメントがどれも確認応答されていないので ${String(flight)} / 2 = ${String(halved)}）、cwnd を 1 セグメントまで下げて、確認応答されていない最初のセグメント（${String(first)}）を再送する。そこからもう一度スロースタートし、新しいデータより先にセグメント ${range(first + 1, flight - 1)} を送り直す。`,
      },
      events: [
        { kind: 'timer', actorId: SENDER, name: 'RTO', durationMs: RTO_MS },
        send(dataMessage('data-rtx', first, 1, 'delivered', { retransmitOf: 'data-4' })),
        send(
          ackMessage(
            'ack-rtx',
            String(first + 1),
            { en: 'The retransmitted segment is acknowledged.', ja: '再送したセグメントの ACK。' },
            1,
          ),
        ),
        set(SSTHRESH, halved),
        history.record({ cwnd: 1, ssthresh: halved, event: EVENTS.slowStart }),
        set(CWND, 2),
      ],
    },
  )
  next = first + 1
  cwnd = 2
  ssthresh = halved
  addRounds(6, 7)
  return steps
}

export const tcpCongestionScenario: Scenario<TcpCongestionOptions> = {
  id: 'tcp-congestion',
  title: { en: 'TCP congestion control', ja: 'TCP の輻輳制御' },
  actors,
  optionDefs: {
    loss: {
      kind: 'select',
      label: { en: 'Segment loss in round 4', ja: 'ラウンド 4 でのセグメントのロス' },
      description: {
        en: 'See how the sender reacts to a single lost segment and to a timeout.',
        ja: 'セグメントが 1 つ失われたときと、タイムアウトしたときの送信側の反応を確かめる。',
      },
      choices: [
        { value: 'none', label: { en: 'No loss', ja: 'ロスしない' } },
        {
          value: 'dupack',
          label: {
            en: 'One segment lost (3 duplicate ACKs)',
            ja: '1 つ失われる（重複 ACK が 3 つ）',
          },
        },
        { value: 'rto', label: { en: 'All segments lost (RTO)', ja: 'すべて失われる（RTO）' } },
      ],
      defaultValue: 'none',
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
