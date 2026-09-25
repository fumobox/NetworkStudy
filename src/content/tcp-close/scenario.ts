/**
 * TCP の接続の終了（4 ウェイクローズ）
 *
 * 根拠:
 * - RFC 9293 §3.6（Closing a Connection）: 通常のクローズ（Figure 12）と同時クローズ（Figure 13）の手順
 * - RFC 9293 §3.3.2（State Machine Overview）: FIN-WAIT-1、FIN-WAIT-2、CLOSE-WAIT、LAST-ACK、CLOSING、TIME-WAIT
 * - RFC 9293 §3.4（Sequence Numbers）: FIN はシーケンス番号を 1 つ消費する
 * - RFC 9293 §3.4.2（Knowing When to Keep Quiet）: MSL（Maximum Segment Lifetime）は 2 分
 * - RFC 9293 §3.10.7.4（SEGMENT ARRIVES の各状態）: TIME-WAIT で再送された FIN を受けたら ACK を返し、2MSL のタイマーをやり直す。
 *   ESTABLISHED などで RST を受けたら CLOSED になる
 * - RFC 9293 §3.10.4（CLOSE call）/ §3.10.5（ABORT call）: ABORT は <SEQ=SND.NXT><CTL=RST> を送り、すぐに CLOSED になる
 * - RFC 6298 §2.4: RTO は 1 秒を下回らないように切り上げる（この例では最後の FIN の再送に 1 秒を使う）
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
  closeMode: z.enum(['normal', 'simultaneous', 'abort']).catch('normal'),
  lastAckLost: z.stringbool().catch(false),
})
export type TcpCloseOptions = z.infer<typeof optionsSchema>

const CLIENT: ActorId = 'client'
const SERVER: ActorId = 'server'
const STATE: StateKey = 'state'
const SND_NXT: StateKey = 'SND.NXT'
const RCV_NXT: StateKey = 'RCV.NXT'

// 3 ウェイハンドシェイクのテーマ（ISS はクライアント 1000、サーバー 5000）の続き。データは送らずに閉じる
const CLIENT_SEQ = 1001
const SERVER_SEQ = 5001
const CLIENT_PORT = '49152'
const SERVER_PORT = '80'
/** RFC 9293 §3.4.2 の MSL（2 分）の 2 倍 */
const TWO_MSL_MS = 2 * 2 * 60 * 1000
/** RFC 6298 §2.4 の下限（1 秒） */
const RTO_MS = 1000

const stateSlots = [
  { key: STATE, label: { en: 'TCP state', ja: 'TCP の状態' }, initial: 'CLOSED' },
  {
    key: SND_NXT,
    label: { en: 'SND.NXT (next seq to send)', ja: 'SND.NXT（次に送るシーケンス番号）' },
    initial: '-',
  },
  {
    key: RCV_NXT,
    label: { en: 'RCV.NXT (next seq expected)', ja: 'RCV.NXT（次に受け取るシーケンス番号）' },
    initial: '-',
  },
] as const

const actors: readonly Actor[] = [
  { id: CLIENT, kind: 'client', name: { en: 'Client', ja: 'クライアント' }, stateSlots },
  { id: SERVER, kind: 'server', name: { en: 'Server', ja: 'サーバー' }, stateSlots },
]

const set = (actorId: ActorId, key: StateKey, value: string | number): StepEvent => ({
  kind: 'stateChange',
  actorId,
  key,
  value: String(value),
})
const send = (message: Message): StepEvent => ({ kind: 'message', message })
const timer = (actorId: ActorId, name: string, durationMs: number): StepEvent => ({
  kind: 'timer',
  actorId,
  name,
  durationMs,
})

const FIELD_TEXT = {
  ports: { en: 'Source and destination ports', ja: '送信元と宛先のポート番号' },
  seqFin: {
    en: 'The FIN takes one sequence number, just like a byte of data, so the other side acknowledges it with this value + 1.',
    ja: 'FIN はデータの 1 バイトと同じようにシーケンス番号を 1 つ消費する。そのため相手はこの値 + 1 で確認応答する。',
  },
  seqAck: {
    en: 'A bare ACK carries no data and takes no sequence number.',
    ja: 'データを含まない ACK は、シーケンス番号を消費しない。',
  },
  ackFin: {
    en: 'Acknowledges everything up to and including the other side’s FIN.',
    ja: '相手の FIN までを受け取ったことを示す。',
  },
  ackNoFin: {
    en: 'The other side’s FIN has not arrived yet, so this acknowledges only the data received so far.',
    ja: '相手の FIN はまだ届いていないので、それまでに受け取った分だけを確認応答する。',
  },
} satisfies Record<string, LocalizedText>

function ports(from: ActorId): PacketField {
  const [source, destination] =
    from === CLIENT ? [CLIENT_PORT, SERVER_PORT] : [SERVER_PORT, CLIENT_PORT]
  return {
    name: 'Src → Dst Port',
    value: `${source} → ${destination}`,
    description: FIELD_TEXT.ports,
  }
}

const other = (actorId: ActorId): ActorId => (actorId === CLIENT ? SERVER : CLIENT)

/** FIN, ACK（Seq は FIN の番号）。ackOfFin は、相手の FIN をすでに受け取っているか */
function finMessage(
  id: string,
  from: ActorId,
  seq: number,
  ack: number,
  ackOfFin: boolean,
): Message {
  return {
    id,
    from,
    to: other(from),
    label: 'FIN, ACK',
    status: 'delivered',
    description: ackOfFin
      ? {
          en: 'Says “I have no more data to send.” The other side has already closed its direction, so this closes the connection in both directions.',
          ja: '「もう送るデータはない」と伝える。相手はすでに自分の向きを閉じているので、これで両方の向きが閉じる。',
        }
      : {
          en: 'Says “I have no more data to send.” The sender can still receive data until the other side closes too.',
          ja: '「もう送るデータはない」と伝える。送った側も、相手が閉じるまではデータを受け取れる。',
        },
    fields: [
      ports(from),
      {
        name: 'Flags',
        value: 'FIN, ACK',
        highlight: true,
        description: {
          en: 'Finish (no more data from the sender)',
          ja: '送信の終了（これ以上データを送らない）',
        },
      },
      { name: 'Seq', value: String(seq), highlight: true, description: FIELD_TEXT.seqFin },
      {
        name: 'Ack',
        value: String(ack),
        description: ackOfFin ? FIELD_TEXT.ackFin : FIELD_TEXT.ackNoFin,
      },
    ],
  }
}

/** 相手の FIN への ACK */
function ackMessage(id: string, from: ActorId, seq: number, ack: number): Message {
  return {
    id,
    from,
    to: other(from),
    label: 'ACK',
    status: 'delivered',
    description: {
      en: 'Acknowledges the other side’s FIN.',
      ja: '相手の FIN を確認応答する。',
    },
    fields: [
      ports(from),
      {
        name: 'Flags',
        value: 'ACK',
        description: { en: 'Acknowledgment', ja: '確認応答' },
      },
      { name: 'Seq', value: String(seq), description: FIELD_TEXT.seqAck },
      { name: 'Ack', value: String(ack), highlight: true, description: FIELD_TEXT.ackFin },
    ],
  }
}

const establishedStep: Step = {
  id: 'established',
  title: { en: 'The connection is established', ja: '接続が確立している' },
  description: {
    en: `The three-way handshake has finished and both sides are ESTABLISHED. The client’s next sequence number is ${String(CLIENT_SEQ)} and the server’s is ${String(SERVER_SEQ)}. Each direction of the connection is closed separately.`,
    ja: `3 ウェイハンドシェイクが終わり、両者とも ESTABLISHED。クライアントが次に送るシーケンス番号は ${String(CLIENT_SEQ)}、サーバーは ${String(SERVER_SEQ)}。接続は送信の向きごとに別々に閉じる。`,
  },
  events: [
    set(CLIENT, STATE, 'ESTABLISHED'),
    set(CLIENT, SND_NXT, CLIENT_SEQ),
    set(CLIENT, RCV_NXT, SERVER_SEQ),
    set(SERVER, STATE, 'ESTABLISHED'),
    set(SERVER, SND_NXT, SERVER_SEQ),
    set(SERVER, RCV_NXT, CLIENT_SEQ),
  ],
}

const timeWaitExpiresStep = (actorIds: readonly ActorId[]): Step => ({
  id: 'time-wait-expires',
  title: {
    en: 'TIME-WAIT ends after 2MSL',
    ja: '2MSL が経って TIME-WAIT が終わる',
  },
  description: {
    en: 'After waiting twice the maximum segment lifetime (MSL is 2 minutes in RFC 9293, so 4 minutes), any old segments of this connection have disappeared from the network, and the connection is finally CLOSED. Many implementations use a shorter wait; Linux, for example, waits 60 seconds.',
    ja: 'セグメントの最大生存時間（MSL。RFC 9293 では 2 分）の 2 倍（4 分）待つと、この接続の古いセグメントはネットワークから消えている。これでようやく CLOSED になる。実装ではもっと短いことが多く、たとえば Linux は 60 秒待つ。',
  },
  // 両者が TIME-WAIT のとき（同時クローズ）も、タイマーはほぼ同時に満了するので 1 つだけ示す（経過時間を二重に数えない）
  events: [
    timer(actorIds[0] ?? CLIENT, '2MSL', TWO_MSL_MS),
    ...actorIds.flatMap((actorId) => [
      set(actorId, STATE, 'CLOSED'),
      set(actorId, SND_NXT, '-'),
      set(actorId, RCV_NXT, '-'),
    ]),
  ],
})

function normalClose(lastAckLost: boolean): Step[] {
  const clientFin = finMessage('client-fin', CLIENT, CLIENT_SEQ, SERVER_SEQ, false)
  const serverFin = finMessage('server-fin', SERVER, SERVER_SEQ, CLIENT_SEQ + 1, true)
  const lastAck = ackMessage('client-ack', CLIENT, CLIENT_SEQ + 1, SERVER_SEQ + 1)
  const steps: Step[] = [
    {
      id: 'client-fin',
      title: { en: 'The client sends a FIN', ja: 'クライアントが FIN を送る' },
      description: {
        en: 'The client application closes the connection (for example with close()). The client has no more data to send, so it sends a FIN and moves to FIN-WAIT-1.',
        ja: 'クライアントのアプリケーションが接続を閉じる（close() など）。もう送るデータはないので、クライアントは FIN を送って FIN-WAIT-1 に移る。',
      },
      events: [
        set(CLIENT, STATE, 'FIN-WAIT-1'),
        set(CLIENT, SND_NXT, CLIENT_SEQ + 1),
        send(clientFin),
      ],
    },
    {
      id: 'server-ack',
      title: {
        en: 'The server acknowledges the FIN',
        ja: 'サーバーが FIN を確認応答する',
      },
      description: {
        en: `The server acknowledges the FIN (Ack = ${String(CLIENT_SEQ + 1)}) and moves to CLOSE-WAIT. It tells its application that the client has finished sending (end of file). When the ACK arrives, the client moves to FIN-WAIT-2. The connection is now half-closed: the server can still send data to the client.`,
        ja: `サーバーは FIN を確認応答し（Ack = ${String(CLIENT_SEQ + 1)}）、CLOSE-WAIT に移る。アプリケーションには、クライアントの送信が終わったこと（ファイルの終わり）を伝える。ACK が届くと、クライアントは FIN-WAIT-2 に移る。これで接続は半分だけ閉じた状態（ハーフクローズ）で、サーバーはまだクライアントにデータを送れる。`,
      },
      events: [
        set(SERVER, STATE, 'CLOSE-WAIT'),
        set(SERVER, RCV_NXT, CLIENT_SEQ + 1),
        send(ackMessage('server-ack', SERVER, SERVER_SEQ, CLIENT_SEQ + 1)),
        set(CLIENT, STATE, 'FIN-WAIT-2'),
      ],
    },
    {
      id: 'server-fin',
      title: { en: 'The server sends its FIN', ja: 'サーバーも FIN を送る' },
      description: {
        en: 'When the server application has finished and closes its side too, the server sends its own FIN and moves to LAST-ACK. If the application never closes, the server stays in CLOSE-WAIT.',
        ja: 'サーバーのアプリケーションも処理を終えて閉じると、サーバーは自分の FIN を送って LAST-ACK に移る。アプリケーションが閉じなければ、サーバーは CLOSE-WAIT のまま残る。',
      },
      events: [
        set(SERVER, STATE, 'LAST-ACK'),
        set(SERVER, SND_NXT, SERVER_SEQ + 1),
        send(serverFin),
      ],
    },
    {
      id: 'client-ack',
      title: lastAckLost
        ? {
            en: 'The client acknowledges the FIN, but the ACK is lost',
            ja: 'クライアントが FIN を確認応答するが、ACK が失われる',
          }
        : { en: 'The client acknowledges the FIN', ja: 'クライアントが FIN を確認応答する' },
      description: {
        en: `The client acknowledges the server’s FIN (Ack = ${String(SERVER_SEQ + 1)}) and moves to TIME-WAIT. It starts a timer of twice the maximum segment lifetime (2MSL).${lastAckLost ? ' The ACK is lost on the way to the server.' : ''}`,
        ja: `クライアントはサーバーの FIN を確認応答し（Ack = ${String(SERVER_SEQ + 1)}）、TIME-WAIT に移る。セグメントの最大生存時間の 2 倍（2MSL）のタイマーを開始する。${lastAckLost ? 'この ACK はサーバーに届く前に失われる。' : ''}`,
      },
      events: [
        set(CLIENT, STATE, 'TIME-WAIT'),
        set(CLIENT, RCV_NXT, SERVER_SEQ + 1),
        send({ ...lastAck, status: lastAckLost ? 'lost' : 'delivered' }),
      ],
    },
  ]
  if (lastAckLost) {
    steps.push({
      id: 'server-fin-rtx',
      title: {
        en: 'RTO expires; the server retransmits its FIN',
        ja: 'RTO が満了し、サーバーが FIN を再送する',
      },
      description: {
        en: 'The server’s FIN was not acknowledged within the retransmission timeout, so the server sends it again. The client is still in TIME-WAIT, so it can acknowledge the FIN again and restarts its 2MSL timer. This is one reason for TIME-WAIT: without it, the client would have forgotten the connection and answered the FIN with a reset.',
        ja: 'サーバーの FIN が再送タイムアウト以内に確認応答されなかったので、サーバーは FIN をもう一度送る。クライアントはまだ TIME-WAIT にいるので、もう一度確認応答でき、2MSL のタイマーをやり直す。これが TIME-WAIT がある理由の 1 つで、TIME-WAIT がなければクライアントは接続を忘れていて、FIN にリセット（RST）を返してしまう。',
      },
      events: [
        timer(SERVER, 'RTO', RTO_MS),
        send({ ...serverFin, id: 'server-fin-rtx-1', retransmitOf: 'server-fin' }),
        send(ackMessage('client-ack-2', CLIENT, CLIENT_SEQ + 1, SERVER_SEQ + 1)),
      ],
    })
  }
  steps.push(
    {
      id: 'server-closed',
      title: { en: 'The server closes the connection', ja: 'サーバーが接続を閉じる' },
      description: {
        en: 'The ACK of its FIN has arrived, so the server deletes the connection and returns to CLOSED right away.',
        ja: '自分の FIN への ACK が届いたので、サーバーは接続を削除し、すぐに CLOSED に戻る。',
      },
      events: [set(SERVER, STATE, 'CLOSED'), set(SERVER, SND_NXT, '-'), set(SERVER, RCV_NXT, '-')],
    },
    timeWaitExpiresStep([CLIENT]),
  )
  return steps
}

function simultaneousClose(): Step[] {
  return [
    {
      id: 'both-fin',
      title: { en: 'Both sides send a FIN at the same time', ja: '両者が同時に FIN を送る' },
      description: {
        en: 'Both applications close the connection at about the same time. Each side sends a FIN before receiving the other’s, and moves to FIN-WAIT-1.',
        ja: '両方のアプリケーションがほぼ同時に接続を閉じる。どちらも相手の FIN を受け取る前に自分の FIN を送り、FIN-WAIT-1 に移る。',
      },
      events: [
        set(CLIENT, STATE, 'FIN-WAIT-1'),
        set(CLIENT, SND_NXT, CLIENT_SEQ + 1),
        send(finMessage('client-fin', CLIENT, CLIENT_SEQ, SERVER_SEQ, false)),
        set(SERVER, STATE, 'FIN-WAIT-1'),
        set(SERVER, SND_NXT, SERVER_SEQ + 1),
        send(finMessage('server-fin', SERVER, SERVER_SEQ, CLIENT_SEQ, false)),
      ],
    },
    {
      id: 'both-ack',
      title: {
        en: 'Each side acknowledges the other’s FIN',
        ja: 'それぞれが相手の FIN を確認応答する',
      },
      description: {
        en: 'Each side receives a FIN while still in FIN-WAIT-1, so it acknowledges the FIN and moves to CLOSING (waiting for the ACK of its own FIN).',
        ja: 'どちらも FIN-WAIT-1 のまま相手の FIN を受け取るので、FIN を確認応答して CLOSING に移る（自分の FIN への ACK を待つ）。',
      },
      events: [
        set(CLIENT, STATE, 'CLOSING'),
        set(CLIENT, RCV_NXT, SERVER_SEQ + 1),
        send(ackMessage('client-ack', CLIENT, CLIENT_SEQ + 1, SERVER_SEQ + 1)),
        set(SERVER, STATE, 'CLOSING'),
        set(SERVER, RCV_NXT, CLIENT_SEQ + 1),
        send(ackMessage('server-ack', SERVER, SERVER_SEQ + 1, CLIENT_SEQ + 1)),
      ],
    },
    {
      id: 'both-time-wait',
      title: { en: 'Both sides enter TIME-WAIT', ja: '両者とも TIME-WAIT に入る' },
      description: {
        en: 'When the ACK of its own FIN arrives, each side moves from CLOSING to TIME-WAIT. In a simultaneous close, both sides wait for 2MSL.',
        ja: '自分の FIN への ACK が届くと、どちらも CLOSING から TIME-WAIT に移る。同時クローズでは、両者とも 2MSL 待つ。',
      },
      events: [set(CLIENT, STATE, 'TIME-WAIT'), set(SERVER, STATE, 'TIME-WAIT')],
    },
    timeWaitExpiresStep([CLIENT, SERVER]),
  ]
}

function abortClose(): Step[] {
  return [
    {
      id: 'client-rst',
      title: { en: 'The client aborts with a reset', ja: 'クライアントがリセットで中断する' },
      description: {
        en: 'The client application aborts the connection instead of closing it (for example close() with SO_LINGER set to 0). The client sends a reset (RST) and deletes the connection at once, without waiting for anything.',
        ja: 'クライアントのアプリケーションが、接続を閉じる代わりに中断する（SO_LINGER を 0 にした close() など）。クライアントはリセット（RST）を送り、何も待たずにすぐ接続を削除する。',
      },
      events: [
        set(CLIENT, STATE, 'CLOSED'),
        set(CLIENT, SND_NXT, '-'),
        set(CLIENT, RCV_NXT, '-'),
        send({
          id: 'client-rst',
          from: CLIENT,
          to: SERVER,
          label: 'RST',
          status: 'delivered',
          description: {
            en: 'Aborts the connection. No acknowledgment is expected, and data not yet delivered is discarded.',
            ja: '接続を中断する。確認応答は求めず、まだ届けていないデータは捨てられる。',
          },
          fields: [
            ports(CLIENT),
            {
              name: 'Flags',
              value: 'RST',
              highlight: true,
              description: { en: 'Reset the connection', ja: '接続のリセット' },
            },
            {
              name: 'Seq',
              value: String(CLIENT_SEQ),
              description: {
                en: 'SND.NXT. The receiver accepts the reset only if this number is within its receive window.',
                ja: 'SND.NXT。受け取った側は、この番号が受信ウィンドウの中にあるときだけリセットを受け入れる。',
              },
            },
          ],
        }),
      ],
    },
    {
      id: 'server-reset',
      title: { en: 'The server drops the connection', ja: 'サーバーが接続を捨てる' },
      description: {
        en: 'The server accepts the reset and goes straight to CLOSED. Its application is told that the connection was reset (ECONNRESET). There is no TIME-WAIT, so old segments may still be in the network.',
        ja: 'サーバーはリセットを受け入れ、そのまま CLOSED になる。アプリケーションには接続がリセットされたこと（ECONNRESET）が伝えられる。TIME-WAIT はないので、古いセグメントがネットワークに残っているかもしれない。',
      },
      events: [set(SERVER, STATE, 'CLOSED'), set(SERVER, SND_NXT, '-'), set(SERVER, RCV_NXT, '-')],
    },
  ]
}

function buildSteps(options: TcpCloseOptions): readonly Step[] {
  switch (options.closeMode) {
    case 'normal':
      return [establishedStep, ...normalClose(options.lastAckLost)]
    case 'simultaneous':
      return [establishedStep, ...simultaneousClose()]
    case 'abort':
      return [establishedStep, ...abortClose()]
  }
}

export const tcpCloseScenario: Scenario<TcpCloseOptions> = {
  id: 'tcp-close',
  title: { en: 'Closing a TCP connection', ja: 'TCP の接続の終了' },
  actors,
  optionDefs: {
    closeMode: {
      kind: 'select',
      label: { en: 'How the connection is closed', ja: '接続の閉じ方' },
      choices: [
        {
          value: 'normal',
          label: { en: 'The client closes first', ja: 'クライアントが先に閉じる' },
        },
        {
          value: 'simultaneous',
          label: { en: 'Both close at the same time', ja: '両者が同時に閉じる' },
        },
        {
          value: 'abort',
          label: { en: 'The client aborts (RST)', ja: 'クライアントが中断する（RST）' },
        },
      ],
      defaultValue: 'normal',
    },
    lastAckLost: {
      kind: 'toggle',
      label: { en: 'Lose the client’s last ACK', ja: 'クライアントの最後の ACK をロスさせる' },
      description: {
        en: 'See why TIME-WAIT is needed. Only has an effect when the client closes first.',
        ja: 'TIME-WAIT が必要な理由を確かめる。クライアントが先に閉じるときだけ影響する。',
      },
      defaultValue: false,
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
