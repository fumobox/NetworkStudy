/**
 * 高速再送と SACK: 失われた分だけを再送する
 *
 * 根拠:
 * - RFC 5681 §3.2（3 つ目の重複 ACK で、失われたと思われるセグメントを RTO を待たずに再送する）、§4.2（順序が入れ替わったセグメントには
 *   すぐに重複 ACK を返す）
 * - RFC 2018 §1（累積の確認応答だけでは、1 往復に 1 つの抜けしかわからない）、§2（SACK-Permitted はオプション 4 で SYN に載せる）、
 *   §3（SACK オプション 5。各ブロックは受け取った連続した範囲で、右端は受け取っていない最初のバイト）、§4（最初のブロックには、
 *   最後に受け取ったセグメントを含める）、§8（受信側は SACK したデータを捨ててもよい。このページでは捨てない）
 * - RFC 6675 §2（DupThresh = 3）、§4（スコアボード。IsLost: そのセグメントより後に SACK されたバイトが (DupThresh − 1) × SMSS + 1 以上なら
 *   失われたとみなす）、§5（SACK による回復）
 * - RFC 6582 §3.2（NewReno: 回復中の部分的な確認応答で、次の抜けをすぐに再送する）
 * - RFC 6298 §5（RTO が満了したら、確認応答されていない最初のセグメントを再送する）、RFC 8985（RACK-TLP。概要で触れるだけ）
 *
 * 学習用の単純化: MSS は 1000 バイト、ISS は 3 ウェイハンドシェイクと同じ（データは 1001 から）。8 つのセグメントを一度に送り、
 * 輻輳ウィンドウ（cwnd）は十分に大きいものとして描かない（輻輳制御のテーマを参照）。1 つのメッセージを 1 つのセグメントとして描く。
 * 回復中に新しいデータは送らない（RFC 6675 の pipe は扱わない）。SACK のブロックは最大 2 つまでしか出てこない
 */
import { z } from 'zod'
import type {
  Actor,
  ActorId,
  Message,
  PacketField,
  Scenario,
  StateKey,
  StateTable,
  Step,
  StepEvent,
} from '@/engine/types'
import type { LocalizedText } from '@/lib/i18n/locale'

const optionsSchema = z.object({
  ack: z.enum(['sack', 'cumulative']).catch('sack'),
  loss: z.enum(['two', 'one', 'tail']).catch('two'),
})
export type TcpSackOptions = z.infer<typeof optionsSchema>
type LossPattern = TcpSackOptions['loss']

const SENDER: ActorId = 'client'
const RECEIVER: ActorId = 'server'
const SND_UNA: StateKey = 'sndUna'
const DUPACKS: StateKey = 'dupacks'
const SCOREBOARD: StateKey = 'scoreboard'
const RCV_NXT: StateKey = 'rcvNxt'
const OUT_OF_ORDER: StateKey = 'outOfOrder'
export const SCOREBOARD_COLUMNS = ['Seq', 'Status'] as const

export const MSS = 1000
export const SEGMENTS = 8
export const FIRST_SEQ = 1001
const END = FIRST_SEQ + SEGMENTS * MSS
/** RFC 6675 §2 */
export const DUP_THRESH = 3
/** RFC 6675 §4 の IsLost: 後に SACK されたバイトがこれ以上なら失われたとみなす */
export const IS_LOST_BYTES = (DUP_THRESH - 1) * MSS + 1
export const RTO_MS = 1000

/** 失われるセグメント（1 から数える） */
const LOST: Readonly<Record<LossPattern, readonly number[]>> = {
  two: [2, 5],
  one: [2],
  tail: [8],
}

const seqOf = (n: number) => FIRST_SEQ + (n - 1) * MSS
const rangeText = (n: number) => `${String(seqOf(n))}–${String(seqOf(n) + MSS - 1)}`

const actors: readonly Actor[] = [
  {
    id: SENDER,
    kind: 'client',
    name: { en: 'Sender', ja: '送信側' },
    stateSlots: [
      {
        key: SND_UNA,
        label: { en: 'SND.UNA (oldest unacknowledged)', ja: 'SND.UNA（確認応答されていない最初）' },
        initial: '-',
      },
      { key: DUPACKS, label: { en: 'Duplicate ACKs', ja: '重複 ACK の数' }, initial: '0' },
      {
        key: SCOREBOARD,
        label: {
          en: 'Scoreboard (what the sender knows)',
          ja: 'スコアボード（送信側が知っていること）',
        },
        initial: { columns: SCOREBOARD_COLUMNS, rows: [] },
      },
    ],
  },
  {
    id: RECEIVER,
    kind: 'server',
    name: { en: 'Receiver', ja: '受信側' },
    stateSlots: [
      {
        key: RCV_NXT,
        label: { en: 'RCV.NXT (next expected)', ja: 'RCV.NXT（次に受け取る）' },
        initial: '-',
      },
      {
        key: OUT_OF_ORDER,
        label: { en: 'Received out of order', ja: '順序が入れ替わって受け取った範囲' },
        initial: '-',
      },
    ],
  },
]

const send = (message: Message): StepEvent => ({ kind: 'message', message })

const FIELD_TEXT = {
  sack: {
    en: 'Byte ranges received beyond the Ack number. The right edge is the first byte NOT received',
    ja: 'Ack の番号より先に受け取ったバイトの範囲。右端は、受け取っていない最初のバイト',
  },
  ack: {
    en: 'Cumulative acknowledgment: every byte before this number has arrived',
    ja: '累積の確認応答。この番号より前のバイトはすべて届いている',
  },
} satisfies Record<string, LocalizedText>

type SegmentStatus = 'in flight' | 'ACKed' | 'SACKed' | 'retransmitted'

/** 連続した番号のまとまり（[最初, 最後]） */
function runs(numbers: readonly number[]): [number, number][] {
  const result: [number, number][] = []
  for (const n of [...numbers].sort((a, b) => a - b)) {
    const last = result.at(-1)
    if (last !== undefined && n === last[1] + 1) {
      last[1] = n
    } else {
      result.push([n, n])
    }
  }
  return result
}

const blockText = ([first, last]: [number, number]) =>
  `${String(seqOf(first))}-${String(seqOf(last) + MSS)}`

/** ステップの種類。説明の文を選ぶのに使う */
type StepKind =
  | 'in-order'
  | 'dupacks'
  | 'fast-retransmit'
  | 'sack-retransmit'
  | 'more-dupacks'
  | 'partial-ack'
  | 'recovering'
  | 'recovered'

interface Pending {
  kind: StepKind
  events: StepEvent[]
  /** このステップの最後の ACK を処理した直後の状態 */
  snapshot: StepEvent[]
}

function buildSteps(options: TcpSackOptions): readonly Step[] {
  const { ack: ackMode, loss } = options
  const sack = ackMode === 'sack'
  const lost = new Set(LOST[loss])
  const status = new Map<number, SegmentStatus>()
  for (let n = 1; n <= SEGMENTS; n++) {
    status.set(n, 'in flight')
  }
  // 受信側
  const received = new Set<number>()
  let rcvNxt = FIRST_SEQ
  // 送信側
  let sndUna = FIRST_SEQ
  let dupacks = 0
  let inRecovery = false

  const scoreboard = (): StateTable => ({
    columns: SCOREBOARD_COLUMNS,
    rows: Array.from({ length: SEGMENTS }, (_, i) => [
      rangeText(i + 1),
      status.get(i + 1) ?? 'in flight',
    ]),
  })
  const state = (): StepEvent[] => [
    { kind: 'stateChange', actorId: SENDER, key: SND_UNA, value: String(sndUna) },
    { kind: 'stateChange', actorId: SENDER, key: DUPACKS, value: String(dupacks) },
    { kind: 'stateChange', actorId: SENDER, key: SCOREBOARD, value: scoreboard() },
    { kind: 'stateChange', actorId: RECEIVER, key: RCV_NXT, value: String(rcvNxt) },
    {
      kind: 'stateChange',
      actorId: RECEIVER,
      key: OUT_OF_ORDER,
      value: (() => {
        const above = [...received].filter((n) => seqOf(n) >= rcvNxt)
        return above.length === 0
          ? '-'
          : runs(above)
              .map(([a, b]) => `${String(seqOf(a))}–${String(seqOf(b) + MSS - 1)}`)
              .join(', ')
      })(),
    },
  ]

  const dataMessage = (n: number, retransmit: boolean): Message => {
    const seq = seqOf(n)
    const fields: PacketField[] = [
      { name: 'Ports', value: '49152 → 443' },
      { name: 'Flags', value: 'ACK' },
      { name: 'Seq', value: String(seq), highlight: retransmit },
      { name: 'Ack', value: '5001' },
      { name: 'Len', value: String(MSS) },
    ]
    const message: Message = {
      id: retransmit ? `rtx-${String(n)}` : `data-${String(n)}`,
      from: SENDER,
      to: RECEIVER,
      label: `DATA seq=${String(seq)} len=${String(MSS)}`,
      status: !retransmit && lost.has(n) ? 'lost' : 'delivered',
      fields,
    }
    return retransmit ? { ...message, retransmitOf: `data-${String(n)}` } : message
  }

  /** 受信側がセグメント n を受け取り、ACK を作る */
  const receive = (n: number): Message => {
    received.add(n)
    while (received.has((rcvNxt - FIRST_SEQ) / MSS + 1)) {
      rcvNxt += MSS
    }
    const above = [...received].filter((x) => seqOf(x) >= rcvNxt)
    const blocks = runs(above)
    // 最初のブロックには、最後に受け取ったセグメントを含める（RFC 2018 §4）
    const latest = blocks.find(([a, b]) => n >= a && n <= b)
    const ordered =
      latest === undefined
        ? blocks.reverse()
        : [latest, ...blocks.filter((b) => b !== latest).reverse()]
    const sackText = ordered.map(blockText).join(', ')
    const fields: PacketField[] = [
      { name: 'Ports', value: '443 → 49152' },
      { name: 'Flags', value: 'ACK' },
      { name: 'Ack', value: String(rcvNxt), highlight: true, description: FIELD_TEXT.ack },
      ...(sack && sackText !== ''
        ? [{ name: 'SACK', value: sackText, highlight: true, description: FIELD_TEXT.sack }]
        : []),
    ]
    return {
      id: `ack-${String(n)}${status.get(n) === 'retransmitted' ? '-rtx' : ''}`,
      from: RECEIVER,
      to: SENDER,
      label:
        sack && sackText !== ''
          ? `ACK ${String(rcvNxt)} SACK ${sackText}`
          : `ACK ${String(rcvNxt)}`,
      status: 'delivered',
      fields,
    }
  }

  const steps: Step[] = [
    {
      id: 'start',
      title: { en: 'Eight segments to send', ja: '送る 8 つのセグメント' },
      description: sack
        ? {
            en: 'The connection is open, and both sides sent SACK-Permitted in their SYNs, so the receiver may report exactly which ranges arrived. The sender has 8000 bytes to send, in eight segments of 1000 bytes.',
            ja: '接続ができていて、両者は SYN で SACK-Permitted を送ったので、受信側はどの範囲が届いたかを正確に知らせられる。送信側は 8000 バイトを、1000 バイトずつ 8 つのセグメントで送る。',
          }
        : {
            en: 'The connection is open, but SACK was not negotiated: the receiver can only report the next byte it expects (a cumulative ACK). The sender has 8000 bytes to send, in eight segments of 1000 bytes.',
            ja: '接続ができているが、SACK は取り決めなかった。受信側が知らせられるのは、次に受け取りたいバイトだけ（累積の確認応答）。送信側は 8000 バイトを、1000 バイトずつ 8 つのセグメントで送る。',
          },
      events: state(),
    },
  ]
  const lostList = LOST[loss].map((n) => String(seqOf(n))).join(loss === 'two' ? ' and ' : '')
  const lostListJa = LOST[loss].map((n) => String(seqOf(n))).join(' と ')
  steps.push({
    id: 'send-8',
    title: { en: 'All eight segments are sent', ja: '8 つのセグメントをすべて送る' },
    description: {
      en: `The sender sends all eight segments without waiting. The segment${LOST[loss].length > 1 ? 's' : ''} starting at ${lostList} ${LOST[loss].length > 1 ? 'are' : 'is'} lost on the way.`,
      ja: `送信側は待たずに 8 つのセグメントを送る。${lostListJa} から始まるセグメントが途中で失われる。`,
    },
    events: [
      ...Array.from({ length: SEGMENTS }, (_, i) => send(dataMessage(i + 1, false))),
      ...state(),
    ],
  })

  if (loss === 'tail') {
    for (let n = 1; n < SEGMENTS; n++) {
      receive(n)
      status.set(n, 'ACKed')
    }
    sndUna = rcvNxt
    steps.push({
      id: 'acks',
      title: { en: 'Seven ACKs, but no duplicate', ja: '7 つの ACK、重複はない' },
      description: {
        en: 'Segments 1 to 7 arrive in order, so every ACK acknowledges new data (summarized here as one message). The last segment was lost, and no segment follows it, so no duplicate ACK can ever tell the sender about the loss.',
        ja: 'セグメント 1〜7 は順番どおりに届くので、どの ACK も新しいデータを確認応答する（ここでは 1 つのメッセージにまとめた）。失われたのは最後のセグメントで、その後に続くセグメントがないので、重複 ACK でロスを知らせることはできない。',
      },
      events: [
        send({
          id: 'acks-1-7',
          from: RECEIVER,
          to: SENDER,
          label: `ACK 2001 … ${String(rcvNxt)} (×7)`,
          status: 'delivered',
          fields: [{ name: 'Ack', value: `2001 … ${String(rcvNxt)}`, description: FIELD_TEXT.ack }],
        }),
        ...state(),
      ],
    })
    status.set(SEGMENTS, 'retransmitted')
    steps.push({
      id: 'rto',
      title: { en: 'Only the timeout helps', ja: 'タイムアウトを待つしかない' },
      description: {
        en: 'The sender has to wait for the retransmission timer (RTO, at least 1 second) and then resends the last segment. Modern TCP stacks shorten this wait with a tail loss probe (RACK-TLP, RFC 8985).',
        ja: '送信側は再送タイマー（RTO。最短でも 1 秒）を待ってから、最後のセグメントを再送するしかない。今の TCP の実装は、テールロスプローブ（RACK-TLP、RFC 8985）でこの待ちを短くする。',
      },
      events: [
        { kind: 'timer', actorId: SENDER, name: 'RTO', durationMs: RTO_MS },
        send(dataMessage(SEGMENTS, true)),
        ...state(),
      ],
    })
    const finalAck = receive(SEGMENTS)
    status.set(SEGMENTS, 'ACKed')
    sndUna = rcvNxt
    steps.push({
      id: 'recovered',
      title: { en: 'Everything is acknowledged', ja: 'すべて確認応答される' },
      description: {
        en: 'The retransmission arrives and the receiver acknowledges all 8000 bytes.',
        ja: '再送が届き、受信側は 8000 バイトすべてを確認応答する。',
      },
      events: [send(finalAck), ...state()],
    })
    return steps
  }

  // 元のセグメントが届くたびに ACK が戻り、送信側が反応する。再送が起きたらステップを区切る
  const arrivals = [
    ...Array.from({ length: SEGMENTS }, (_, i) => i + 1).filter((n) => !lost.has(n)),
  ]
  const retransmitQueue: number[] = []
  const pending: Pending[] = []
  let current: Pending | null = null
  const flush = () => {
    if (current !== null) {
      current.events.push(...current.snapshot)
      pending.push(current)
      current = null
    }
  }
  const stepFor = (kind: StepKind): Pending => {
    if (current !== null && current.kind === kind) {
      return current
    }
    flush()
    const next: Pending = { kind, events: [], snapshot: [] }
    current = next
    return next
  }
  /** 失われたとみなすセグメント（SACK の IsLost、RFC 6675 §4） */
  const sackLost = (): number | null => {
    for (let n = 1; n <= SEGMENTS; n++) {
      if (status.get(n) !== 'in flight') {
        continue
      }
      const sackedAbove =
        [...status.entries()].filter(([m, st]) => m > n && st === 'SACKed').length * MSS
      if (sackedAbove >= IS_LOST_BYTES) {
        return n
      }
    }
    return null
  }
  /** 送信側が ACK を処理する（SACK なら、スコアボードを更新してロスを調べる）。再送したら、そのステップを閉じる */
  const onAck = (message: Message, arrived: number) => {
    const ackNo = rcvNxt
    const isNew = ackNo > sndUna
    let kind: StepKind
    if (isNew) {
      for (let n = 1; n <= SEGMENTS; n++) {
        if (seqOf(n) < ackNo) {
          status.set(n, 'ACKed')
        }
      }
      sndUna = ackNo
      dupacks = 0
      kind =
        sndUna >= END ? 'recovered' : !inRecovery ? 'in-order' : sack ? 'recovering' : 'partial-ack'
    } else {
      dupacks += 1
      kind = inRecovery ? 'more-dupacks' : 'dupacks'
    }
    if (sack && seqOf(arrived) >= ackNo) {
      status.set(arrived, 'SACKed')
    }
    // この ACK で再送するなら、どのセグメントか
    let lostSegment: number | null = null
    if (!inRecovery && dupacks >= DUP_THRESH) {
      inRecovery = true
      kind = 'fast-retransmit'
      lostSegment = (sndUna - FIRST_SEQ) / MSS + 1
    } else if (inRecovery && sack) {
      lostSegment = sackLost()
      if (lostSegment !== null) {
        kind = 'sack-retransmit'
      }
    } else if (inRecovery && isNew && sndUna < END) {
      // NewReno: 部分的な確認応答なら、次の抜けをすぐに再送する
      lostSegment = (sndUna - FIRST_SEQ) / MSS + 1
    }
    const step = stepFor(kind)
    step.events.push(send(message))
    if (lostSegment !== null) {
      status.set(lostSegment, 'retransmitted')
      retransmitQueue.push(lostSegment)
      step.events.push(send(dataMessage(lostSegment, true)))
    }
    step.snapshot = state()
    if (lostSegment !== null) {
      flush()
    }
  }
  for (const n of arrivals) {
    onAck(receive(n), n)
  }
  // 再送が届く（届くたびに ACK が戻り、さらに再送が起きることもある）
  while (retransmitQueue.length > 0) {
    const n = retransmitQueue.shift()
    if (n === undefined) {
      break
    }
    onAck(receive(n), n)
  }
  flush()

  const texts = stepTexts(sack, loss)
  pending.forEach((step, i) => {
    const text = texts[step.kind]
    steps.push({
      id: `${step.kind}-${String(i + 1)}`,
      title: text.title,
      description: text.description,
      events: step.events,
    })
  })
  return steps
}

interface StepText {
  readonly title: LocalizedText
  readonly description: LocalizedText
}

function stepTexts(sack: boolean, loss: LossPattern): Readonly<Record<StepKind, StepText>> {
  return {
    'in-order': {
      title: { en: 'The first segment is acknowledged', ja: '最初のセグメントが確認応答される' },
      description: {
        en: 'Segment 1 arrived in order, so the ACK acknowledges it: the receiver now expects byte 2001.',
        ja: 'セグメント 1 は順番どおりに届いたので、ACK はそれを確認応答する。受信側が次に受け取りたいのはシーケンス番号 2001。',
      },
    },
    dupacks: {
      title: { en: 'Duplicate ACKs', ja: '重複 ACK' },
      description: sack
        ? {
            en: 'Later segments arrive, but 2001 is missing, so the Ack number cannot move: these are duplicate ACKs, sent at once. Their SACK blocks tell the sender exactly which later ranges did arrive.',
            ja: '後のセグメントは届くが、2001 が抜けているので Ack の番号は進めない。これが重複 ACK で、すぐに送られる。SACK のブロックが、後のどの範囲が届いたかを送信側に正確に伝える。',
          }
        : {
            en: 'Later segments arrive, but 2001 is missing, so the Ack number cannot move: these are duplicate ACKs, sent at once. Without SACK they only say “still waiting for 2001”; the sender cannot tell which later segments arrived.',
            ja: '後のセグメントは届くが、2001 が抜けているので Ack の番号は進めない。これが重複 ACK で、すぐに送られる。SACK がないので「まだ 2001 を待っている」としか伝わらず、後のどのセグメントが届いたかは送信側にわからない。',
          },
    },
    'fast-retransmit': {
      title: { en: 'Third duplicate ACK: fast retransmit', ja: '3 つ目の重複 ACK: 高速再送' },
      description: {
        en: 'After three duplicate ACKs the sender concludes that 2001 was lost and resends it at once, without waiting for the retransmission timer. (How cwnd and ssthresh change at this point is shown in the congestion control theme.)',
        ja: '重複 ACK が 3 つ届いたので、送信側は 2001 が失われたと判断し、再送タイマーを待たずにすぐに再送する（このとき cwnd と ssthresh がどう変わるかは、輻輳制御のテーマを参照）。',
      },
    },
    'sack-retransmit': {
      title: { en: 'SACK reveals the second hole', ja: 'SACK で 2 つ目の抜けがわかる' },
      description: {
        en: `The SACK blocks now show 3000 bytes received after 5001, which is at least (3 − 1) × 1000 + 1 bytes: the sender treats 5001 as lost too and resends it in the same round trip.`,
        ja: `SACK のブロックから、5001 より後に 3000 バイト届いたことがわかる。(3 − 1) × 1000 + 1 バイト以上なので、送信側は 5001 も失われたとみなし、同じ往復の中で再送する。`,
      },
    },
    'more-dupacks': {
      title: { en: 'More duplicate ACKs', ja: 'さらに重複 ACK' },
      description: sack
        ? {
            en: 'More segments arrive after the hole, and the SACK blocks grow. Nothing new needs to be resent yet.',
            ja: '抜けの後にさらにセグメントが届き、SACK のブロックが広がる。まだ新しく再送するものはない。',
          }
        : loss === 'two'
          ? {
              en: 'More duplicate ACKs arrive, but without SACK they carry no new information: the sender cannot know that 5001 is also missing.',
              ja: 'さらに重複 ACK が届くが、SACK がないので新しいことは何もわからない。5001 も抜けていることを、送信側は知りようがない。',
            }
          : {
              en: 'More duplicate ACKs arrive, but without SACK they carry no new information. (Here nothing else is missing, but the sender has no way to know that.)',
              ja: 'さらに重複 ACK が届くが、SACK がないので新しいことは何もわからない（ここではほかに抜けはないが、送信側にはそれも確かめられない）。',
            },
    },
    'partial-ack': {
      title: {
        en: 'A partial ACK reveals the next hole',
        ja: '部分的な確認応答で次の抜けがわかる',
      },
      description: {
        en: 'The retransmitted 2001 arrived, but the ACK stops at 5001, not at the end: a partial ACK. Only now does the sender learn that 5001 is missing, and it resends it (NewReno). Without SACK, finding the second hole cost one more round trip.',
        ja: '再送した 2001 は届いたが、ACK は最後までではなく 5001 で止まる。これが部分的な確認応答。ここで初めて送信側は 5001 が抜けていると知り、再送する（NewReno）。SACK がないと、2 つ目の抜けを見つけるのに 1 往復よけいにかかる。',
      },
    },
    recovering: {
      title: { en: 'The first retransmission arrives', ja: '1 つ目の再送が届く' },
      description: {
        en: 'The retransmitted 2001 fills the first gap, so the Ack jumps to 5001. The SACK block still shows 6001-9001 (bytes 6001–9000); 5001 has already been resent, so nothing else is needed.',
        ja: '再送した 2001 で最初の抜けが埋まり、Ack は 5001 まで進む。SACK のブロックはまだ 6001-9001（6001〜9000 バイト）を示している。5001 はすでに再送したので、ほかにすることはない。',
      },
    },
    recovered: {
      title: { en: 'Everything is acknowledged', ja: 'すべて確認応答される' },
      description:
        loss === 'two' && sack
          ? {
              en: 'The second retransmission fills the last gap, and the receiver acknowledges all 8000 bytes. Only the two lost segments were resent, both within one round trip.',
              ja: '2 つ目の再送で最後の抜けが埋まり、受信側は 8000 バイトすべてを確認応答する。再送したのは失われた 2 つのセグメントだけで、どちらも 1 往復のうちに送った。',
            }
          : {
              en: 'The retransmission fills the last gap, and the receiver acknowledges all 8000 bytes.',
              ja: '再送で最後の抜けが埋まり、受信側は 8000 バイトすべてを確認応答する。',
            },
    },
  }
}

export const tcpSackScenario: Scenario<TcpSackOptions> = {
  id: 'tcp-sack',
  title: {
    en: 'Fast retransmit and SACK: resending only what was lost',
    ja: '高速再送と SACK: 失われた分だけを再送する',
  },
  actors,
  optionDefs: {
    ack: {
      kind: 'select',
      label: { en: 'Acknowledgments', ja: '確認応答' },
      choices: [
        { value: 'sack', label: { en: 'With SACK', ja: 'SACK あり' } },
        {
          value: 'cumulative',
          label: { en: 'Cumulative ACK only (no SACK)', ja: '累積の確認応答だけ（SACK なし）' },
        },
      ],
      defaultValue: 'sack',
    },
    loss: {
      kind: 'select',
      label: { en: 'Lost segments', ja: '失われるセグメント' },
      choices: [
        { value: 'two', label: { en: 'Two (2001 and 5001)', ja: '2 つ（2001 と 5001）' } },
        { value: 'one', label: { en: 'One (2001)', ja: '1 つ（2001）' } },
        { value: 'tail', label: { en: 'The last one (8001)', ja: '最後の 1 つ（8001）' } },
      ],
      defaultValue: 'two',
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
