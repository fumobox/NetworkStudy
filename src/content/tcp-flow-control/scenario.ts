/**
 * TCP のフロー制御: 受信ウィンドウ
 *
 * 根拠:
 * - RFC 9293 §3.1（Window: 受け取れるバイト数。16 ビット）、§3.3.1（SND.UNA、SND.NXT、SND.WND、RCV.NXT、RCV.WND）
 * - RFC 9293 §3.8.6（受信側がウィンドウで送信量を制御する）、§3.8.6.1（ゼロウィンドウでも送信側はプローブを送る。MUST-36、MUST-37。
 *   最初のプローブは RTO の後、以降は間隔を倍にする。SHLD-29、SHLD-30。ACK やウィンドウの更新は再送されないので、プローブがないと行き詰まる）
 * - RFC 9293 §3.8.6.2.1（送信側の使えるウィンドウ = SND.UNA + SND.WND − SND.NXT）、§3.8.6.2.2（受信側の SWS 回避:
 *   空きが min(Fr × RCV.BUFF, Eff.snd.MSS) 以上になるまでウィンドウを広げない。Fr = 1/2）、§3.8.6.3（遅延 ACK: 満杯のセグメント
 *   2 つごとに ACK を送る）、§3.10.7.4（ACK で SND.WND を更新する。RCV.WND が 0 のときは、データのセグメントを受け入れない）
 * - RFC 1122 §4.2.2.17（ゼロウィンドウのプローブ）、§4.2.3.2（遅延 ACK）、§4.2.3.3（受信側の SWS 回避）
 * - RFC 6298 §2.4、§5.5（RTO の下限 1 秒、満了のたびに倍）、RFC 7323 §2（Window Scale。このページでは使わない）
 *
 * 学習用の単純化:
 * - MSS は読みやすさのため 1000 バイト（3 ウェイハンドシェイクのテーマでは 1460）。ISS は 3 ウェイハンドシェイクと同じ 1000 と 5000
 * - 1 つのメッセージを 1 つのセグメントとして描く。輻輳ウィンドウ（cwnd）は受信ウィンドウより大きいものとする
 *   （実際に送れる量は min(cwnd, rwnd)。輻輳制御のテーマを参照）
 * - 遅延 ACK は 2 セグメントごとだけを描き、タイマー（最大 500 ミリ秒）は描かない
 * - プローブは 1 バイトの新しいデータ（実装によって違う）。受け入れられなかったプローブでは SND.NXT を進めない（実際の送信側は
 *   SND.NXT を進め、そのバイトを未確認のまま持ち、次のセグメントに含めて再送する）。送信側の SWS 回避（Nagle のアルゴリズム、RFC 9293 §3.7.4。もとは RFC 896）は概要で触れるだけ
 */
import { z } from 'zod'
import type {
  Actor,
  ActorId,
  Message,
  PacketField,
  Scenario,
  StateKey,
  Step,
  StepEvent,
} from '@/engine/types'
import type { LocalizedText } from '@/lib/i18n/locale'

const optionsSchema = z.object({
  receiverApp: z.enum(['slow', 'fast', 'trickle']).catch('slow'),
  updateLost: z.stringbool().catch(false),
})
export type TcpFlowControlOptions = z.infer<typeof optionsSchema>

const SENDER: ActorId = 'client'
const RECEIVER: ActorId = 'server'
const SND_UNA: StateKey = 'sndUna'
const SND_NXT: StateKey = 'sndNxt'
const SND_WND: StateKey = 'sndWnd'
const USABLE: StateKey = 'usable'
const RCV_NXT: StateKey = 'rcvNxt'
const RCV_WND: StateKey = 'rcvWnd'
const BUFFER: StateKey = 'buffer'

export const MSS = 1000
export const RCV_BUFF = 4000
/** 送る量（6 セグメント） */
export const TOTAL = 6000
/** 最初のデータの Seq（ISS 1000 + 1） */
export const FIRST_SEQ = 1001
/** 受信側（サーバー）の Seq（ISS 5000 + 1）。受信側はデータを送らない */
export const RECEIVER_SEQ = 5001
/** 送信側の Win（Window Scale なしの最大） */
const SENDER_WIN = 65535
/** 最初のプローブまでの時間（RTO、RFC 6298 §2.4 の下限） */
export const PERSIST_MS = 1000
/** 受信側の SWS 回避のしきい値: min(Fr × RCV.BUFF, MSS)。Fr = 1/2 */
export const SWS_THRESHOLD = Math.min(RCV_BUFF / 2, MSS)
const END = FIRST_SEQ + TOTAL

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
      {
        key: SND_NXT,
        label: { en: 'SND.NXT (next to send)', ja: 'SND.NXT（次に送る）' },
        initial: '-',
      },
      {
        key: SND_WND,
        label: {
          en: 'SND.WND (window from the receiver)',
          ja: 'SND.WND（受信側が知らせたウィンドウ）',
        },
        initial: '-',
      },
      {
        key: USABLE,
        label: {
          en: 'Usable window (SND.UNA + SND.WND − SND.NXT)',
          ja: '使えるウィンドウ（SND.UNA + SND.WND − SND.NXT）',
        },
        initial: '-',
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
        key: BUFFER,
        label: {
          en: 'Receive buffer (not yet read by the application)',
          ja: '受信バッファー（アプリケーションがまだ読んでいない量）',
        },
        initial: '-',
      },
      {
        key: RCV_WND,
        label: { en: 'RCV.WND (window it advertises)', ja: 'RCV.WND（知らせるウィンドウ）' },
        initial: '-',
      },
    ],
  },
]

const send = (message: Message): StepEvent => ({ kind: 'message', message })

const FIELD_TEXT = {
  win: {
    en: 'How many more bytes the receiver can accept, counted from the Ack number',
    ja: '受信側があと何バイト受け取れるか。Ack の番号から数える',
  },
  senderWin: {
    en: 'The sender’s own receive window (the largest value without Window Scale)',
    ja: '送信側自身の受信ウィンドウ（Window Scale なしの最大）',
  },
  seq: { en: 'Sequence number of the first byte', ja: '最初のバイトのシーケンス番号' },
  probe: {
    en: 'One byte of new data, sent only to get an ACK with the current window',
    ja: '今のウィンドウを載せた ACK を返してもらうためだけに送る、1 バイトの新しいデータ',
  },
} satisfies Record<string, LocalizedText>

/** 送信側と受信側の状態を持ち、メッセージと状態の変化を作る */
function createSimulation() {
  let sndUna = FIRST_SEQ
  let sndNxt = FIRST_SEQ
  let sndWnd = RCV_BUFF
  let rcvNxt = FIRST_SEQ
  let buffered = 0
  let rcvWnd = RCV_BUFF
  let dataCount = 0
  /** 送ったが、まだ受信側で処理していないセグメント（[seq, len]） */
  const pending: [number, number][] = []

  const senderState = (): StepEvent[] => [
    { kind: 'stateChange', actorId: SENDER, key: SND_UNA, value: String(sndUna) },
    { kind: 'stateChange', actorId: SENDER, key: SND_NXT, value: String(sndNxt) },
    { kind: 'stateChange', actorId: SENDER, key: SND_WND, value: String(sndWnd) },
    {
      kind: 'stateChange',
      actorId: SENDER,
      key: USABLE,
      value: String(Math.max(0, sndUna + sndWnd - sndNxt)),
    },
  ]
  const receiverState = (): StepEvent[] => [
    { kind: 'stateChange', actorId: RECEIVER, key: RCV_NXT, value: String(rcvNxt) },
    {
      kind: 'stateChange',
      actorId: RECEIVER,
      key: BUFFER,
      value: `${String(buffered)} / ${String(RCV_BUFF)}`,
    },
    { kind: 'stateChange', actorId: RECEIVER, key: RCV_WND, value: String(rcvWnd) },
  ]

  return {
    state: () => [...senderState(), ...receiverState()],
    remaining: () => END - sndNxt,
    /** データを送る。受信側が受け入れれば、受信バッファーに入る */
    data(length: number, options: { probe?: boolean; accepted?: boolean } = {}): Message {
      const seq = sndNxt
      const accepted = options.accepted ?? true
      dataCount += 1
      // 受け入れられなかったプローブのバイトは、あとでもう一度送るので SND.NXT を進めない（学習用の単純化）
      if (accepted) {
        sndNxt = seq + length
        pending.push([seq, length])
      }
      const fields: PacketField[] = [
        { name: 'Ports', value: '49152 → 443' },
        { name: 'Flags', value: 'ACK' },
        { name: 'Seq', value: String(seq), description: FIELD_TEXT.seq },
        { name: 'Ack', value: String(RECEIVER_SEQ) },
        { name: 'Win', value: String(SENDER_WIN), description: FIELD_TEXT.senderWin },
        {
          name: 'Len',
          value: String(length),
          highlight: options.probe === true,
          ...(options.probe === true ? { description: FIELD_TEXT.probe } : {}),
        },
      ]
      return {
        id: `data-${String(dataCount)}`,
        from: SENDER,
        to: RECEIVER,
        label: `${options.probe === true ? 'Window probe' : 'DATA'} seq=${String(seq)} len=${String(length)}`,
        status: accepted ? 'delivered' : 'rejected',
        fields,
      }
    },
    /** 受信側が、送られたセグメントを count 個（省略ならすべて）受け取る */
    deliver(count = pending.length) {
      for (const [seq, length] of pending.splice(0, count)) {
        rcvNxt = seq + length
        buffered += length
        // 右端を動かさない（受け取った分だけウィンドウが縮む）
        rcvWnd = Math.max(0, rcvWnd - length)
      }
    },
    /** 受信側が今の状態で ACK を送る。届けば送信側の SND.UNA と SND.WND が変わる */
    ack(id: string, status: Message['status'] = 'delivered'): Message {
      if (status === 'delivered') {
        sndUna = rcvNxt
        sndWnd = rcvWnd
      }
      return {
        id,
        from: RECEIVER,
        to: SENDER,
        label: `ACK ${String(rcvNxt)} win=${String(rcvWnd)}`,
        status,
        fields: [
          { name: 'Ports', value: '443 → 49152' },
          { name: 'Flags', value: 'ACK' },
          { name: 'Seq', value: String(RECEIVER_SEQ) },
          { name: 'Ack', value: String(rcvNxt) },
          { name: 'Win', value: String(rcvWnd), highlight: true, description: FIELD_TEXT.win },
          { name: 'Len', value: '0' },
        ],
      }
    },
    /** アプリケーションが読む。空きが増えたら、知らせるウィンドウを広げるか（SWS 回避を考える） */
    read(bytes: number, swsAvoidance: boolean) {
      buffered = Math.max(0, buffered - bytes)
      const free = RCV_BUFF - buffered
      if (!swsAvoidance || free - rcvWnd >= SWS_THRESHOLD || free === RCV_BUFF) {
        rcvWnd = free
      }
    },
    /** 受信バッファーの空きに合わせて、知らせるウィンドウを決める（データを受け取った後） */
    shrink() {
      rcvWnd = RCV_BUFF - buffered
    },
  }
}

const persist = (durationMs: number): StepEvent => ({
  kind: 'timer',
  actorId: SENDER,
  name: 'persist',
  durationMs,
})

function buildSteps(options: TcpFlowControlOptions): readonly Step[] {
  const { receiverApp, updateLost } = options
  const fast = receiverApp === 'fast'
  const sim = createSimulation()
  const steps: Step[] = [
    {
      id: 'established',
      title: { en: 'The connection is open', ja: '接続ができている' },
      description: {
        en: `The sender has ${String(TOTAL)} bytes to send, in segments of ${String(MSS)} bytes. In the handshake the receiver advertised a window of ${String(RCV_BUFF)} bytes: the size of its receive buffer. The sender may have at most that many bytes sent but not yet acknowledged.`,
        ja: `送信側は ${String(TOTAL)} バイトを、${String(MSS)} バイトずつのセグメントで送る。受信側はハンドシェイクで ${String(RCV_BUFF)} バイトのウィンドウを知らせた。これは受信バッファーの大きさ。送信側は、送ったがまだ確認応答されていないバイトを、この量までしか持てない。`,
      },
      events: sim.state(),
    },
  ]

  // 1. ウィンドウいっぱいまで送る
  const firstBurst = [sim.data(MSS), sim.data(MSS), sim.data(MSS), sim.data(MSS)]
  steps.push({
    id: 'send-window',
    title: { en: 'The sender fills the window', ja: '送信側がウィンドウいっぱいまで送る' },
    description: {
      en: 'The sender sends four segments, exactly the 4000-byte window. Now the usable window is 0: it must stop, even though it still has 2000 bytes to send.',
      ja: '送信側は 4 つのセグメント、ちょうど 4000 バイトのウィンドウ分を送る。使えるウィンドウは 0 になり、まだ 2000 バイト残っているのに止まらなければならない。',
    },
    events: [...firstBurst.map(send), ...sim.state()],
  })

  // 2. 受信側の ACK（2 セグメントごと）
  if (fast) {
    sim.deliver(2)
    sim.read(2 * MSS, false)
    const ack1 = sim.ack('ack-3001')
    sim.deliver(2)
    sim.read(2 * MSS, false)
    const ack2 = sim.ack('ack-5001')
    steps.push({
      id: 'window-slides',
      title: {
        en: 'The application reads at once: the window slides',
        ja: 'アプリケーションがすぐに読む: ウィンドウが進む',
      },
      description: {
        en: 'The receiving application reads the data as soon as it arrives, so the buffer never fills. Each ACK moves the acknowledged point forward and still advertises 4000 bytes: the right edge of the window slides forward.',
        ja: '受信側のアプリケーションは、届いたデータをすぐに読むので、バッファーはいっぱいにならない。ACK のたびに確認応答の位置が進み、ウィンドウは 4000 バイトのまま。ウィンドウの右端が前へ進んでいく。',
      },
      events: [send(ack1), send(ack2), ...sim.state()],
    })
    const rest = [sim.data(MSS), sim.data(MSS)]
    sim.deliver()
    sim.read(2 * MSS, false)
    steps.push({
      id: 'send-rest',
      title: { en: 'The rest is sent without waiting', ja: '残りも待たずに送る' },
      description: {
        en: 'The usable window is 4000 bytes again, so the sender sends the last 2000 bytes right away. Flow control never had to slow it down.',
        ja: '使えるウィンドウがまた 4000 バイトになったので、送信側は残りの 2000 バイトをすぐに送る。フロー制御で遅くなることはなかった。',
      },
      events: [...rest.map(send), send(sim.ack('ack-7001')), ...sim.state()],
    })
    return steps
  }

  sim.deliver(2)
  sim.shrink()
  const ackAfterTwo = sim.ack('ack-3001')
  sim.deliver(2)
  sim.shrink()
  const ackAfterFour = sim.ack('ack-5001')
  steps.push({
    id: 'window-shrinks',
    title: { en: 'The window shrinks to zero', ja: 'ウィンドウが 0 に縮む' },
    description: {
      en: 'The receiving application is busy and reads nothing, so the data stays in the buffer. The receiver acknowledges every second segment (delayed ACK) and advertises only the free space: 2000 bytes, then 0. A zero window means “stop sending”. The sender starts its persist timer.',
      ja: '受信側のアプリケーションは忙しくて何も読まないので、データはバッファーにたまる。受信側は 2 セグメントごとに確認応答し（遅延 ACK）、空いている分だけをウィンドウとして知らせる。2000 バイト、そして 0。ゼロウィンドウは「送るのを止めて」という意味。送信側はパーシストタイマーを動かす。',
    },
    events: [send(ackAfterTwo), send(ackAfterFour), ...sim.state()],
  })

  // 3. 最初のプローブ（ウィンドウは 0 のまま）
  steps.push({
    id: 'probe-1',
    title: {
      en: 'The persist timer fires: a window probe',
      ja: 'パーシストタイマーが満了: ウィンドウプローブ',
    },
    description: {
      en: 'After one retransmission timeout (1 second) the sender sends a window probe: one byte of new data. The window is still 0, so the receiver does not accept the byte, but it answers with an ACK that shows the current window: still 0.',
      ja: '再送タイムアウト 1 回分（1 秒）たつと、送信側はウィンドウプローブを送る。1 バイトの新しいデータ。ウィンドウはまだ 0 なので受信側はこのバイトを受け入れないが、今のウィンドウを載せた ACK で答える。まだ 0。',
    },
    events: [
      persist(PERSIST_MS),
      send(sim.data(1, { probe: true, accepted: false })),
      send(sim.ack('probe-1-ack')),
      ...sim.state(),
    ],
  })

  if (receiverApp === 'trickle') {
    sim.read(500, true)
    steps.push({
      id: 'read-500',
      title: { en: 'The application reads a little', ja: 'アプリケーションが少しだけ読む' },
      description: {
        en: `The application reads 500 bytes. 500 bytes are free, but the receiver does not advertise them: it waits until at least min(half the buffer, one MSS) = ${String(SWS_THRESHOLD)} bytes are free. Advertising tiny windows would make the sender send tiny segments (silly window syndrome).`,
        ja: `アプリケーションが 500 バイト読む。500 バイト空いたが、受信側はそれを知らせない。min(バッファーの半分, 1 MSS) = ${String(SWS_THRESHOLD)} バイト以上空くまで待つ。小さなウィンドウを知らせると、送信側が小さなセグメントを送るようになるから（シリーウィンドウシンドローム）。`,
      },
      events: sim.state(),
    })
    sim.read(500, true)
    steps.push({
      id: 'read-1000',
      title: {
        en: 'Enough space: the window opens a little',
        ja: '十分に空いた: ウィンドウが少し開く',
      },
      description: {
        en: 'Another 500 bytes are read, so 1000 bytes are free. Now the receiver sends a window update: an ACK with no data and the new window.',
        ja: 'さらに 500 バイト読み、1000 バイト空いた。ここで受信側はウィンドウの更新を送る。データのない、新しいウィンドウを載せた ACK。',
      },
      events: [send(sim.ack('update-1000')), ...sim.state()],
    })
    const segment = sim.data(MSS)
    sim.deliver()
    sim.shrink()
    steps.push({
      id: 'send-one',
      title: { en: 'One full segment fits', ja: '満杯のセグメントが 1 つ入る' },
      description: {
        en: 'The sender sends one full segment. The probe byte was not accepted, so the segment starts at the same Seq, 5001. The buffer is full again and the window drops back to 0.',
        ja: '送信側は満杯のセグメントを 1 つ送る。プローブのバイトは受け入れられなかったので、同じ 5001 から始まる。バッファーはまたいっぱいになり、ウィンドウは 0 に戻る。',
      },
      events: [send(segment), send(sim.ack('ack-6001')), ...sim.state()],
    })
    sim.read(RCV_BUFF, true)
    steps.push({
      id: 'read-all',
      title: { en: 'The application reads everything', ja: 'アプリケーションが全部読む' },
      description: {
        en: 'The application reads the whole buffer, and the receiver advertises the full 4000 bytes again.',
        ja: 'アプリケーションがバッファーを全部読み、受信側はまた 4000 バイトのウィンドウを知らせる。',
      },
      events: [send(sim.ack('update-4000')), ...sim.state()],
    })
    const last = sim.data(MSS)
    sim.deliver()
    sim.shrink()
    steps.push({
      id: 'send-last',
      title: { en: 'The last segment', ja: '最後のセグメント' },
      description: {
        en: 'The sender sends the last 1000 bytes. All 6000 bytes have arrived.',
        ja: '送信側は最後の 1000 バイトを送る。6000 バイトがすべて届いた。',
      },
      events: [send(last), send(sim.ack('ack-7001')), ...sim.state()],
    })
    return steps
  }

  // slow: アプリケーションがまとめて読み、ウィンドウの更新を送る
  sim.read(RCV_BUFF, false)
  steps.push({
    id: 'app-reads',
    title: {
      en: 'The application reads: a window update',
      ja: 'アプリケーションが読む: ウィンドウの更新',
    },
    description: updateLost
      ? {
          en: 'The application finally reads all 4000 bytes, and the receiver sends a window update. But this ACK is lost. Pure ACKs are not retransmitted, so without the persist timer both sides would now wait for each other forever.',
          ja: 'アプリケーションがようやく 4000 バイトを全部読み、受信側はウィンドウの更新を送る。ところが、この ACK が失われる。データのない ACK は再送されないので、パーシストタイマーがなければ、両者はいつまでもお互いを待つことになる。',
        }
      : {
          en: 'The application finally reads all 4000 bytes. The receiver sends a window update: an ACK with no data that advertises 4000 bytes again.',
          ja: 'アプリケーションがようやく 4000 バイトを全部読む。受信側はウィンドウの更新を送る。データのない、また 4000 バイトを知らせる ACK。',
        },
    events: [send(sim.ack('update-4000', updateLost ? 'lost' : 'delivered')), ...sim.state()],
  })

  if (updateLost) {
    const probe = sim.data(1, { probe: true })
    sim.deliver()
    sim.shrink()
    steps.push({
      id: 'probe-2',
      title: { en: 'The next probe reopens the window', ja: '次のプローブでウィンドウが開く' },
      description: {
        en: 'The persist timer doubles to 2 seconds and fires again. This time the window is open, so the receiver accepts the probe byte and its ACK advances by one: ACK 5002 with a window of 3999 bytes.',
        ja: 'パーシストタイマーは 2 秒に倍になり、また満了する。今度はウィンドウが開いているので、受信側はプローブのバイトを受け入れ、ACK は 1 つ進む。ACK 5002、ウィンドウは 3999 バイト。',
      },
      events: [persist(2 * PERSIST_MS), send(probe), send(sim.ack('probe-2-ack')), ...sim.state()],
    })
    const next = sim.data(MSS)
    // 1 つ目を送った後の残り（999 バイト）
    const last = sim.data(sim.remaining())
    const rest = [next, last]
    sim.deliver()
    sim.shrink()
    steps.push({
      id: 'send-rest',
      title: { en: 'The rest is sent', ja: '残りを送る' },
      description: {
        en: 'The probe byte counted as data, so the rest starts at 5002: 1000 bytes and then the last 999 bytes.',
        ja: 'プローブのバイトはデータとして数えられたので、残りは 5002 から始まる。1000 バイトと、最後の 999 バイト。',
      },
      events: [...rest.map(send), send(sim.ack('ack-7001')), ...sim.state()],
    })
    return steps
  }

  const rest = [sim.data(MSS), sim.data(MSS)]
  sim.deliver()
  sim.shrink()
  steps.push({
    id: 'send-rest',
    title: { en: 'The rest is sent', ja: '残りを送る' },
    description: {
      en: 'The usable window is 4000 bytes again, so the sender sends the last 2000 bytes. The probe byte was not accepted, so they start at 5001 again (a real sender would keep that byte as unacknowledged and resend it inside this segment).',
      ja: '使えるウィンドウがまた 4000 バイトになったので、送信側は残りの 2000 バイトを送る。プローブのバイトは受け入れられなかったので、また 5001 から始まる（実際の送信側はこのバイトを未確認のまま持ち、このセグメントに含めて再送する）。',
    },
    events: [...rest.map(send), send(sim.ack('ack-7001')), ...sim.state()],
  })
  return steps
}

export const tcpFlowControlScenario: Scenario<TcpFlowControlOptions> = {
  id: 'tcp-flow-control',
  title: { en: 'TCP flow control: the receive window', ja: 'TCP のフロー制御: 受信ウィンドウ' },
  actors,
  optionDefs: {
    receiverApp: {
      kind: 'select',
      label: { en: 'Receiving application', ja: '受信側のアプリケーション' },
      choices: [
        {
          value: 'slow',
          label: { en: 'Busy (reads later, all at once)', ja: '忙しい（あとでまとめて読む）' },
        },
        { value: 'fast', label: { en: 'Reads as soon as data arrives', ja: 'すぐに読む' } },
        { value: 'trickle', label: { en: 'Reads 500 bytes at a time', ja: '500 バイトずつ読む' } },
      ],
      defaultValue: 'slow',
    },
    updateLost: {
      kind: 'toggle',
      label: { en: 'The window update is lost', ja: 'ウィンドウの更新が失われる' },
      description: {
        en: 'Only has an effect when the application is busy.',
        ja: 'アプリケーションが忙しいときだけ影響する。',
      },
      defaultValue: false,
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
