/**
 * TCP 3 ウェイハンドシェイク
 *
 * 根拠:
 * - RFC 9293 §3.5（Establishing a Connection）: 3 ウェイハンドシェイクの手順
 * - RFC 9293 §3.3.2（State Machine Overview）: 状態の名前と遷移
 * - RFC 9293 §3.4（Sequence Numbers）: ISS、SND.NXT、RCV.NXT
 * - RFC 9293 §3.10.7.1 / §3.10.7.3: CLOSED のポートへの SYN に対する RST と、SYN-SENT で RST を受けたときの処理
 * - RFC 9293 §3.8.1 / RFC 6298 §2.1, §5.5: 再送タイマー（初期 RTO 1 秒、満了のたびに倍にするバックオフ）
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
  synLoss: z.enum(['none', 'once', 'twice']).catch('none'),
  synAckLost: z.stringbool().catch(false),
  serverPort: z.enum(['open', 'closed']).catch('open'),
})
export type TcpOptions = z.infer<typeof optionsSchema>

const CLIENT: ActorId = 'client'
const SERVER: ActorId = 'server'
const STATE: StateKey = 'state'
const SND_NXT: StateKey = 'SND.NXT'
const RCV_NXT: StateKey = 'RCV.NXT'

// 学習用の固定値。実際の ISS は RFC 9293 §3.4.1 のとおり推測されにくい値を選ぶ
const CLIENT_ISS = 1000
const SERVER_ISS = 5000
const CLIENT_PORT = '49152'
const SERVER_PORT = '80'
const MSS = '1460'
/** RFC 6298 §2.1 の初期 RTO（1 秒） */
const INITIAL_RTO_MS = 1000

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

const set = (actorId: ActorId, key: StateKey, value: string): StepEvent => ({
  kind: 'stateChange',
  actorId,
  key,
  value,
})
const send = (message: Message): StepEvent => ({ kind: 'message', message })
const rto = (actorId: ActorId, durationMs: number): StepEvent => ({
  kind: 'timer',
  actorId,
  name: 'RTO',
  durationMs,
})

const FIELD_TEXT = {
  ports: { en: 'Source and destination ports', ja: '送信元と宛先のポート番号' },
  seqSyn: {
    en: 'The initial send sequence number (ISS). The SYN itself uses one sequence number.',
    ja: '初期送信シーケンス番号（ISS）。SYN 自体がシーケンス番号を 1 つ消費する。',
  },
  ackUnused: {
    en: 'Not meaningful because the ACK flag is not set',
    ja: 'ACK フラグが立っていないので意味を持たない',
  },
  mss: {
    en: 'Maximum segment size this side can receive',
    ja: 'この側が受け取れる最大セグメントサイズ',
  },
} satisfies Record<string, LocalizedText>

function ports(from: 'client' | 'server'): PacketField {
  const [source, destination] =
    from === 'client' ? [CLIENT_PORT, SERVER_PORT] : [SERVER_PORT, CLIENT_PORT]
  return {
    name: 'Src → Dst Port',
    value: `${source} → ${destination}`,
    description: FIELD_TEXT.ports,
  }
}

const synMessage: Message = {
  id: 'syn',
  from: CLIENT,
  to: SERVER,
  label: 'SYN',
  status: 'delivered',
  description: {
    en: 'Asks the server to open a connection and tells it the client’s initial sequence number.',
    ja: 'サーバーに接続の開始を求め、クライアントの初期シーケンス番号を伝える。',
  },
  fields: [
    ports('client'),
    {
      name: 'Flags',
      value: 'SYN',
      highlight: true,
      description: { en: 'Synchronize sequence numbers', ja: 'シーケンス番号の同期を求める' },
    },
    { name: 'Seq', value: String(CLIENT_ISS), highlight: true, description: FIELD_TEXT.seqSyn },
    { name: 'Ack', value: '0', description: FIELD_TEXT.ackUnused },
    { name: 'Options', value: `MSS=${MSS}`, description: FIELD_TEXT.mss },
  ],
}

const synAckMessage: Message = {
  id: 'syn-ack',
  from: SERVER,
  to: CLIENT,
  label: 'SYN, ACK',
  status: 'delivered',
  description: {
    en: 'Acknowledges the client’s SYN and sends the server’s own initial sequence number.',
    ja: 'クライアントの SYN を確認応答し、サーバー自身の初期シーケンス番号を送る。',
  },
  fields: [
    ports('server'),
    {
      name: 'Flags',
      value: 'SYN, ACK',
      highlight: true,
      description: {
        en: 'Synchronize the server’s sequence numbers and acknowledge the client’s SYN',
        ja: 'サーバー側のシーケンス番号の同期と、クライアントの SYN の確認応答',
      },
    },
    {
      name: 'Seq',
      value: String(SERVER_ISS),
      highlight: true,
      description: { en: 'The server’s ISS', ja: 'サーバーの ISS' },
    },
    {
      name: 'Ack',
      value: String(CLIENT_ISS + 1),
      highlight: true,
      description: {
        en: 'Client ISS + 1: the next sequence number the server expects (the SYN used one)',
        ja: 'クライアントの ISS + 1。サーバーが次に期待するシーケンス番号（SYN が 1 つ消費した）',
      },
    },
    { name: 'Options', value: `MSS=${MSS}`, description: FIELD_TEXT.mss },
  ],
}

const ackMessage: Message = {
  id: 'ack',
  from: CLIENT,
  to: SERVER,
  label: 'ACK',
  status: 'delivered',
  description: {
    en: 'Acknowledges the server’s SYN. The connection is now established on the client side.',
    ja: 'サーバーの SYN を確認応答する。これでクライアント側の接続は確立する。',
  },
  fields: [
    ports('client'),
    {
      name: 'Flags',
      value: 'ACK',
      highlight: true,
      description: { en: 'Acknowledgment only', ja: '確認応答のみ' },
    },
    {
      name: 'Seq',
      value: String(CLIENT_ISS + 1),
      description: { en: 'Client ISS + 1', ja: 'クライアントの ISS + 1' },
    },
    {
      name: 'Ack',
      value: String(SERVER_ISS + 1),
      highlight: true,
      description: {
        en: 'Server ISS + 1: the next sequence number the client expects',
        ja: 'サーバーの ISS + 1。クライアントが次に期待するシーケンス番号',
      },
    },
  ],
}

const rstMessage: Message = {
  id: 'rst',
  from: SERVER,
  to: CLIENT,
  label: 'RST, ACK',
  status: 'delivered',
  description: {
    en: 'No process is listening on the port, so the server refuses the connection with a reset.',
    ja: 'そのポートで待ち受けているプロセスがないので、サーバーはリセットで接続を拒否する。',
  },
  fields: [
    ports('server'),
    {
      name: 'Flags',
      value: 'RST, ACK',
      highlight: true,
      description: { en: 'Reset the connection', ja: '接続のリセット' },
    },
    {
      name: 'Seq',
      value: '0',
      description: {
        en: 'The SYN had no ACK, so the reset uses sequence number 0',
        ja: 'SYN に ACK がなかったので、リセットのシーケンス番号は 0',
      },
    },
    {
      name: 'Ack',
      value: String(CLIENT_ISS + 1),
      highlight: true,
      description: {
        en: 'Acknowledges the SYN so the client can accept the reset',
        ja: 'SYN を確認応答し、クライアントがリセットを受け入れられるようにする',
      },
    },
  ],
}

function buildSteps(options: TcpOptions): readonly Step[] {
  const portOpen = options.serverPort === 'open'
  const lostSyns = { none: 0, once: 1, twice: 2 }[options.synLoss]
  const steps: Step[] = []

  steps.push(
    portOpen
      ? {
          id: 'listen',
          title: { en: 'The server waits for connections', ja: 'サーバーが接続を待ち受ける' },
          description: {
            en: 'An application on the server opens port 80 passively (for example with listen()). The server moves from CLOSED to LISTEN.',
            ja: 'サーバーのアプリケーションが 80 番ポートを受動的にオープンする（listen() など）。サーバーは CLOSED から LISTEN に移る。',
          },
          events: [set(SERVER, STATE, 'LISTEN')],
        }
      : {
          id: 'no-listener',
          title: { en: 'No one is listening on the port', ja: 'ポートで誰も待ち受けていない' },
          description: {
            en: 'No application has opened port 80 on the server, so the port stays CLOSED.',
            ja: 'サーバーでは 80 番ポートを開いているアプリケーションがないので、ポートは CLOSED のまま。',
          },
          events: [],
        },
  )

  // SYN（ロスする場合は、RTO のたびに再送する）
  let rtoMs = INITIAL_RTO_MS
  for (let attempt = 0; attempt <= lostSyns; attempt++) {
    const lost = attempt < lostSyns
    const message: Message = {
      ...synMessage,
      id: attempt === 0 ? 'syn' : `syn-rtx-${String(attempt)}`,
      status: lost ? 'lost' : portOpen ? 'delivered' : 'rejected',
      ...(attempt === 0 ? {} : { retransmitOf: 'syn' }),
    }
    if (attempt === 0) {
      steps.push({
        id: 'syn',
        title: lost
          ? {
              en: 'The client sends a SYN, but it is lost',
              ja: 'クライアントが SYN を送るが、途中で失われる',
            }
          : { en: 'The client sends a SYN', ja: 'クライアントが SYN を送る' },
        description: {
          en: `The client opens the connection actively, chooses its initial sequence number (ISS = ${String(CLIENT_ISS)}), and sends a SYN. It moves to SYN-SENT and starts the retransmission timer.${lost ? ' The segment is lost on the way to the server.' : ''}`,
          ja: `クライアントは能動的にオープンし、初期シーケンス番号（ISS = ${String(CLIENT_ISS)}）を決めて SYN を送る。SYN-SENT に移り、再送タイマーを開始する。${lost ? 'このセグメントはサーバーに届く前に失われる。' : ''}`,
        },
        events: [
          set(CLIENT, STATE, 'SYN-SENT'),
          set(CLIENT, SND_NXT, String(CLIENT_ISS + 1)),
          send(message),
        ],
      })
    } else {
      const seconds = String(rtoMs / 1000)
      steps.push({
        id: `syn-rtx-${String(attempt)}`,
        title: lost
          ? {
              en: `RTO expires; the retransmitted SYN is lost again`,
              ja: `RTO が満了して SYN を再送するが、また失われる`,
            }
          : {
              en: 'RTO expires; the client retransmits the SYN',
              ja: 'RTO が満了し、クライアントが SYN を再送する',
            },
        description: {
          en: `No SYN-ACK arrived within the retransmission timeout (${seconds} s), so the client sends the same SYN again with the same sequence number. ${attempt === 1 ? 'The timeout starts at 1 second.' : 'Each time the timer expires, the timeout doubles (exponential backoff).'}`,
          ja: `再送タイムアウト（${seconds} 秒）以内に SYN-ACK が届かなかったので、クライアントは同じシーケンス番号で同じ SYN をもう一度送る。${attempt === 1 ? 'タイムアウトは最初 1 秒。' : 'タイマーが満了するたびにタイムアウトは倍になる（指数バックオフ）。'}`,
        },
        events: [rto(CLIENT, rtoMs), send(message)],
      })
      rtoMs *= 2
    }
  }

  if (!portOpen) {
    steps.push(
      {
        id: 'rst',
        title: { en: 'The server replies with a reset', ja: 'サーバーがリセットを返す' },
        description: {
          en: 'A SYN arrived for a CLOSED port. The server answers with RST, ACK (Seq 0, Ack = client ISS + 1) instead of SYN, ACK.',
          ja: 'CLOSED のポートに SYN が届いた。サーバーは SYN, ACK の代わりに RST, ACK（Seq 0、Ack = クライアントの ISS + 1）を返す。',
        },
        events: [send(rstMessage)],
      },
      {
        id: 'reset',
        title: { en: 'The connection is refused', ja: '接続が拒否される' },
        description: {
          en: 'The reset acknowledges the client’s SYN, so the client accepts it, drops the connection, and returns to CLOSED. RFC 9293 calls this “connection reset”; the sockets API reports it as “Connection refused” (ECONNREFUSED).',
          ja: 'リセットがクライアントの SYN を確認応答しているので、クライアントはそれを受け入れて接続をやめ、CLOSED に戻る。RFC 9293 ではこれを「connection reset」と呼び、ソケット API では「Connection refused」（ECONNREFUSED）として通知される。',
        },
        events: [set(CLIENT, STATE, 'CLOSED'), set(CLIENT, SND_NXT, '-')],
      },
    )
    return steps
  }

  // SYN, ACK（ロスする場合は、サーバーの再送タイマーで再送する）
  steps.push({
    id: 'syn-ack',
    title: options.synAckLost
      ? {
          en: 'The server sends a SYN, ACK, but it is lost',
          ja: 'サーバーが SYN, ACK を送るが、途中で失われる',
        }
      : { en: 'The server replies with a SYN, ACK', ja: 'サーバーが SYN, ACK を返す' },
    description: {
      en: `The server records the client’s sequence number (RCV.NXT = ${String(CLIENT_ISS + 1)}), chooses its own ISS (${String(SERVER_ISS)}), and replies with a SYN, ACK. It moves to SYN-RECEIVED.${options.synAckLost ? ' The segment is lost on the way to the client.' : ''}`,
      ja: `サーバーはクライアントのシーケンス番号を記録し（RCV.NXT = ${String(CLIENT_ISS + 1)}）、自分の ISS（${String(SERVER_ISS)}）を決めて SYN, ACK を返す。SYN-RECEIVED に移る。${options.synAckLost ? 'このセグメントはクライアントに届く前に失われる。' : ''}`,
    },
    events: [
      set(SERVER, STATE, 'SYN-RECEIVED'),
      set(SERVER, RCV_NXT, String(CLIENT_ISS + 1)),
      set(SERVER, SND_NXT, String(SERVER_ISS + 1)),
      send({ ...synAckMessage, status: options.synAckLost ? 'lost' : 'delivered' }),
    ],
  })
  if (options.synAckLost) {
    steps.push({
      id: 'syn-ack-rtx',
      title: {
        en: 'RTO expires; the server retransmits the SYN, ACK',
        ja: 'RTO が満了し、サーバーが SYN, ACK を再送する',
      },
      description: {
        en: 'The server’s SYN is not acknowledged within the retransmission timeout (1 s), so the server sends the SYN, ACK again. (Depending on timing, the client may also retransmit its SYN; the server answers that with a SYN, ACK as well.)',
        ja: 'サーバーの SYN が再送タイムアウト（1 秒）以内に確認応答されなかったので、サーバーは SYN, ACK をもう一度送る。（タイミングによってはクライアントも SYN を再送することがあり、その場合もサーバーは SYN, ACK で応える。）',
      },
      events: [
        rto(SERVER, INITIAL_RTO_MS),
        send({ ...synAckMessage, id: 'syn-ack-rtx-1', retransmitOf: 'syn-ack' }),
      ],
    })
  }

  steps.push(
    {
      id: 'ack',
      title: { en: 'The client sends an ACK', ja: 'クライアントが ACK を送る' },
      description: {
        en: `The client records the server’s sequence number (RCV.NXT = ${String(SERVER_ISS + 1)}) and acknowledges it. The client is now ESTABLISHED and can start sending data.`,
        ja: `クライアントはサーバーのシーケンス番号を記録し（RCV.NXT = ${String(SERVER_ISS + 1)}）、確認応答する。クライアントは ESTABLISHED になり、データを送り始められる。`,
      },
      events: [
        set(CLIENT, STATE, 'ESTABLISHED'),
        set(CLIENT, RCV_NXT, String(SERVER_ISS + 1)),
        send(ackMessage),
      ],
    },
    {
      id: 'established',
      title: { en: 'The connection is established', ja: '接続が確立する' },
      description: {
        en: 'The ACK acknowledges the server’s SYN, so the server also moves to ESTABLISHED. Both sides now know each other’s sequence numbers.',
        ja: 'ACK がサーバーの SYN を確認応答しているので、サーバーも ESTABLISHED に移る。これで両者がお互いのシーケンス番号を知っている。',
      },
      events: [set(SERVER, STATE, 'ESTABLISHED')],
    },
  )
  return steps
}

export const tcpHandshakeScenario: Scenario<TcpOptions> = {
  id: 'tcp-handshake',
  title: { en: 'TCP three-way handshake', ja: 'TCP 3 ウェイハンドシェイク' },
  actors,
  optionDefs: {
    synLoss: {
      kind: 'select',
      label: { en: 'Lose the client’s SYN', ja: 'クライアントの SYN をロスさせる' },
      description: {
        en: 'See how the retransmission timer and exponential backoff work.',
        ja: '再送タイマーと指数バックオフの動きを確かめる。',
      },
      choices: [
        { value: 'none', label: { en: 'No loss', ja: 'ロスしない' } },
        { value: 'once', label: { en: 'Lose it once', ja: '1 回ロスする' } },
        { value: 'twice', label: { en: 'Lose it twice', ja: '2 回ロスする' } },
      ],
      defaultValue: 'none',
    },
    synAckLost: {
      kind: 'toggle',
      label: { en: 'Lose the server’s SYN, ACK', ja: 'サーバーの SYN, ACK をロスさせる' },
      description: {
        en: 'Has no effect when the port is closed.',
        ja: 'ポートが閉じているときは影響しない。',
      },
      defaultValue: false,
    },
    serverPort: {
      kind: 'select',
      label: { en: 'Server port 80', ja: 'サーバーの 80 番ポート' },
      choices: [
        {
          value: 'open',
          label: { en: 'Open (a server is listening)', ja: '開いている（待ち受けている）' },
        },
        {
          value: 'closed',
          label: { en: 'Closed (no one is listening)', ja: '閉じている（誰も待ち受けていない）' },
        },
      ],
      defaultValue: 'open',
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
