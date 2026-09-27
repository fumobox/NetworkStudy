/**
 * QUIC と HTTP/3: ハンドシェイク、0-RTT、ロス
 *
 * 根拠:
 * - RFC 9000 §2・§2.1（ストリーム。クライアントが開く双方向のストリームは 0、4、8…）、§7（ハンドシェイクは TLS と一体）、
 *   §12.2（複数のパケットを 1 つの UDP データグラムにまとめる）、§12.3（パケット番号の空間は Initial・Handshake・
 *   アプリケーション（0-RTT と 1-RTT で共有）の 3 つ）、§13.3（再送するのはパケットではなく情報。新しいパケット番号で送る）、
 *   §14.1（Initial を運ぶデータグラムは 1,200 バイト以上）、§17.2.2・§17.2.3・§17.2.4・§17.3.1（Initial・0-RTT・
 *   Handshake・1-RTT のパケット）、§19.3（ACK）、§19.6（CRYPTO）、§19.8（STREAM）、§19.20（HANDSHAKE_DONE）
 * - RFC 9001 §4.1.1・§4.1.2（ハンドシェイクの完了と確定。クライアントは HANDSHAKE_DONE で確定する）、§4.1.4（暗号化レベル）、
 *   §4.6（0-RTT。§4.6.2 で拒否されたら 0-RTT のデータは届かなかったものとして扱う）、§4.9.1・§4.9.2（Initial と
 *   Handshake の鍵を捨てる時点）、§5.2（Initial の鍵は Destination Connection ID から誰でも計算できる）、§9.2（0-RTT の再送攻撃）、
 *   付録 A（例の Destination Connection ID 0x8394c8f03e515708）
 * - RFC 9002 §5.3・§6.2.1（RTT の初期値 333 ミリ秒からの PTO = 333 + 4 × 166.5 ≈ 1 秒）、§6.1.1（後のパケットが 3 つ
 *   確認されたら、確認されないパケットを失われたとみなす）
 * - RFC 9114 §4.1（要求と応答は HEADERS と DATA のフレーム）、§6.1（要求ごとに 1 つの双方向ストリーム）、§10.9（0-RTT）
 * - RFC 8446 §4.6.1（NewSessionTicket）、§8（0-RTT の再送）
 *
 * 学習用の単純化: 1 つのメッセージを 1 つの QUIC パケットとして描き、データグラムへのまとめ方は説明で示す。
 * Retry、バージョンの交渉、ヘッダーの保護、接続の移行、鍵の更新、輻輳制御、ACK の範囲と遅延、サーバーの Handshake の ACK、
 * HTTP/3 の制御ストリームと QPACK、Alt-Svc などによる HTTP/3 の発見は省く（概要で触れる）。パケットの大きさは例
 */
import { z } from 'zod'
import type {
  Actor,
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
  earlyData: z.enum(['none', 'accepted', 'rejected']).catch('none'),
  loss: z.enum(['none', 'handshake', 'stream']).catch('none'),
})
export type QuicOptions = z.infer<typeof optionsSchema>

const CLIENT = 'client'
const SERVER = 'server'
const KEYS: StateKey = 'keys'
const HANDSHAKE: StateKey = 'handshake'
const PACKET_NUMBERS: StateKey = 'packetNumbers'
const STREAMS: StateKey = 'streams'

export const DCID = '0x8394c8f03e515708'
/** RFC 9002 §6.2.1: RTT の初期値 333 ミリ秒のときの PTO（333 + 4 × 166.5） */
export const PTO_MS = 999
export const PN_COLUMNS = ['Space', 'Packets sent'] as const
export const STREAM_COLUMNS = ['Stream', 'Request', 'State'] as const

const SECTIONS = {
  handshake: { en: 'Handshake (1 round trip)', ja: 'ハンドシェイク（1 往復）' },
  application: {
    en: 'Application data (1-RTT keys)',
    ja: 'アプリケーションのデータ（1-RTT の鍵）',
  },
} satisfies Record<string, LocalizedText>

const actors: readonly Actor[] = [
  {
    id: CLIENT,
    kind: 'client',
    name: { en: 'Browser', ja: 'ブラウザー' },
    stateSlots: [
      { key: KEYS, label: { en: 'Keys', ja: '鍵' }, initial: 'none' },
      { key: HANDSHAKE, label: { en: 'Handshake', ja: 'ハンドシェイク' }, initial: '-' },
      {
        key: PACKET_NUMBERS,
        label: { en: 'Packet numbers sent', ja: '送ったパケット番号' },
        initial: { columns: PN_COLUMNS, rows: [] },
      },
      {
        key: STREAMS,
        label: { en: 'Streams (requests)', ja: 'ストリーム（要求）' },
        initial: { columns: STREAM_COLUMNS, rows: [] },
      },
    ],
  },
  {
    id: SERVER,
    kind: 'server',
    name: { en: 'www.example.com (192.0.2.10)', ja: 'www.example.com（192.0.2.10）' },
    shortName: { en: 'Server', ja: 'サーバー' },
    stateSlots: [
      { key: KEYS, label: { en: 'Keys', ja: '鍵' }, initial: 'none' },
      { key: HANDSHAKE, label: { en: 'Handshake', ja: 'ハンドシェイク' }, initial: '-' },
    ],
  },
]

const set = (actorId: string, key: StateKey, value: string | StateTable): StepEvent => ({
  kind: 'stateChange',
  actorId,
  key,
  value,
})
const send = (message: Message): StepEvent => ({ kind: 'message', message })

type PacketType = 'Initial' | 'Handshake' | '0-RTT' | '1-RTT'

const PROTECTION: Readonly<Record<PacketType, LocalizedText>> = {
  Initial: {
    en: 'Initial keys, derived from the Destination Connection ID: anyone on the path can compute them, so this is not secret',
    ja: 'Initial の鍵。Destination Connection ID から作るので、経路上の誰でも計算でき、秘密ではない',
  },
  Handshake: {
    en: 'Handshake keys from the TLS key exchange (same idea as the TLS handshake keys)',
    ja: 'TLS の鍵交換から作る Handshake の鍵（TLS のハンドシェイク用の鍵と同じ考え方）',
  },
  '0-RTT': {
    en: 'Early keys from the session ticket of an earlier connection',
    ja: '前の接続のセッションチケットから作る早期の鍵',
  },
  '1-RTT': {
    en: 'Application keys, derived from the handshake as soon as the server’s Finished is sent; the server can already use them for 0.5-RTT data',
    ja: 'サーバーの Finished が出た時点でハンドシェイクから作るアプリケーションの鍵。サーバーはすぐに 0.5-RTT のデータにも使える',
  },
}

const SPACE_TEXT: Readonly<Record<PacketType, LocalizedText>> = {
  Initial: { en: 'Initial space', ja: 'Initial の空間' },
  Handshake: { en: 'Handshake space', ja: 'Handshake の空間' },
  '0-RTT': {
    en: 'Application space (shared by 0-RTT and 1-RTT)',
    ja: 'アプリケーションの空間（0-RTT と 1-RTT で共有）',
  },
  '1-RTT': {
    en: 'Application space (shared by 0-RTT and 1-RTT)',
    ja: 'アプリケーションの空間（0-RTT と 1-RTT で共有）',
  },
}

interface PacketSpec {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly type: PacketType
  readonly pn: number
  readonly frames: string
  readonly status?: Message['status']
  readonly retransmitOf?: string
  readonly extra?: readonly PacketField[]
  /** クライアントの最初の Initial（と同じデータグラムの 0-RTT）だけ、Initial の鍵のもとになる DCID を示す */
  readonly showDcid?: boolean
}

function packet(spec: PacketSpec): Message {
  const long = spec.type !== '1-RTT'
  const message: Message = {
    id: spec.id,
    from: spec.from,
    to: spec.to,
    label: `${spec.type}[${String(spec.pn)}]: ${spec.frames}`,
    status: spec.status ?? 'delivered',
    encrypted: spec.type !== 'Initial',
    fields: [
      {
        name: 'Header',
        value: long ? `long (${spec.type})` : 'short (1-RTT)',
        description: long
          ? {
              en: 'Long headers carry the version and both connection IDs; they are used until the handshake ends',
              ja: 'ロングヘッダーはバージョンと両方の接続 ID を持ち、ハンドシェイクが終わるまで使う',
            }
          : {
              en: 'After the handshake, packets use a short header with only the destination connection ID',
              ja: 'ハンドシェイクのあとは、宛先の接続 ID だけの短いヘッダーを使う',
            },
      },
      ...(spec.showDcid === true
        ? [
            {
              name: 'Destination Connection ID',
              value: DCID,
              description: {
                en: 'Chosen at random by the client for its first Initial. The Initial keys are derived from it; later packets use the IDs the two sides picked for each other',
                ja: 'クライアントが最初の Initial のためにランダムに選ぶ。Initial の鍵はここから作る。以降のパケットは、両者がお互いのために選んだ ID を使う',
              },
            },
          ]
        : []),
      {
        name: 'Packet number',
        value: String(spec.pn),
        highlight: spec.retransmitOf !== undefined,
        description: SPACE_TEXT[spec.type],
      },
      { name: 'Frames', value: spec.frames },
      { name: 'Protection', value: `${spec.type} keys`, description: PROTECTION[spec.type] },
      ...(spec.extra ?? []),
    ],
  }
  return spec.retransmitOf === undefined ? message : { ...message, retransmitOf: spec.retransmitOf }
}

/** 送ったパケット番号の表（空間ごと。捨てた空間は discarded） */
/** 呼ぶのは、そのステップの next(...) をすべて済ませたあと（その時点の番号を写す） */
function pnTable(
  initial: readonly number[] | null,
  handshake: readonly number[] | null,
  application: readonly number[],
): StateTable {
  const list = (numbers: readonly number[]) => (numbers.length === 0 ? '-' : numbers.join(', '))
  return {
    columns: PN_COLUMNS,
    rows: [
      ['Initial', initial === null ? 'discarded' : list(initial)],
      ['Handshake', handshake === null ? 'discarded' : list(handshake)],
      ['Application', list(application)],
    ],
  }
}

function streamTable(states: readonly [string, string]): StateTable {
  return {
    columns: STREAM_COLUMNS,
    rows: [
      ['0', 'GET /', states[0]],
      ['4', 'GET /style.css', states[1]],
    ],
  }
}

/** ACK フレームの範囲の表記（0-2, 4 のように連続した番号をまとめる） */
export function ackRanges(numbers: readonly number[]): string {
  const ranges: [number, number][] = []
  for (const n of [...numbers].sort((x, y) => x - y)) {
    const last = ranges.at(-1)
    if (last !== undefined && n === last[1] + 1) {
      last[1] = n
    } else {
      ranges.push([n, n])
    }
  }
  return ranges
    .map(([start, end]) => (start === end ? String(start) : `${String(start)}-${String(end)}`))
    .join(', ')
}

const REQUEST_FRAMES = 'STREAM 0 (HEADERS: GET /, FIN), STREAM 4 (HEADERS: GET /style.css, FIN)'

function buildSteps(options: QuicOptions): readonly Step[] {
  const { earlyData, loss } = options
  const early = earlyData !== 'none'
  const accepted = earlyData === 'accepted'
  const steps: Step[] = []
  const handshakeSection: LocalizedText =
    loss === 'handshake' ? { en: 'Handshake', ja: 'ハンドシェイク' } : SECTIONS.handshake

  // クライアントが送ったパケット番号（空間ごと）
  const cInitial: number[] = []
  const cHandshake: number[] = []
  const cApp: number[] = []
  /** サーバーが受け取って処理した、クライアントのアプリケーションの空間のパケット */
  const serverGotApp: number[] = []
  const next = (list: number[]) => {
    const pn = list.length === 0 ? 0 : (list.at(-1) ?? 0) + 1
    list.push(pn)
    return pn
  }

  // ---------- 1. ClientHello（と 0-RTT） ----------
  const firstFlight = (retransmit: boolean): Message[] => {
    const initialPn = next(cInitial)
    const messages = [
      packet({
        id: retransmit ? 'client-initial-rtx' : 'client-initial',
        from: CLIENT,
        to: SERVER,
        type: 'Initial',
        pn: initialPn,
        frames: 'CRYPTO (ClientHello), PADDING',
        showDcid: true,
        status: loss === 'handshake' && !retransmit ? 'lost' : 'delivered',
        ...(retransmit ? { retransmitOf: 'client-initial' } : {}),
        extra: [
          {
            name: 'ClientHello',
            value: `ALPN h3, key_share, quic_transport_parameters${early ? ', pre_shared_key, early_data' : ''}`,
            description: {
              en: 'The same TLS 1.3 ClientHello as in the TLS theme, carried in a CRYPTO frame instead of a TLS record',
              ja: 'TLS のテーマと同じ TLS 1.3 の ClientHello。TLS のレコードではなく CRYPTO フレームで運ぶ',
            },
          },
          {
            name: 'Datagram size',
            value: '1,200 bytes',
            description: {
              en: 'A datagram with an Initial packet from the client is padded to at least 1,200 bytes, so that the server cannot be used to amplify attacks and the path is known to carry datagrams this large',
              ja: 'クライアントの Initial を運ぶデータグラムは 1,200 バイト以上に埋める。サーバーが攻撃の増幅に使われないようにし、経路がこの大きさのデータグラムを通せることを確かめるため',
            },
          },
        ],
      }),
    ]
    if (early) {
      const pn = next(cApp)
      if (accepted && !(loss === 'handshake' && !retransmit)) {
        serverGotApp.push(pn)
      }
      messages.push(
        packet({
          id: retransmit ? 'client-0rtt-rtx' : 'client-0rtt',
          from: CLIENT,
          to: SERVER,
          type: '0-RTT',
          pn,
          frames: REQUEST_FRAMES,
          showDcid: true,
          status:
            loss === 'handshake' && !retransmit
              ? 'lost'
              : earlyData === 'rejected'
                ? 'rejected'
                : 'delivered',
          ...(retransmit ? { retransmitOf: 'client-0rtt' } : {}),
        }),
      )
    }
    return messages
  }

  const flight1 = firstFlight(false)
  steps.push({
    id: 'client-initial',
    section: handshakeSection,
    title: early
      ? { en: 'ClientHello and 0-RTT requests', ja: 'ClientHello と 0-RTT の要求' }
      : {
          en: 'The browser sends ClientHello over UDP',
          ja: 'ブラウザーが UDP で ClientHello を送る',
        },
    description: early
      ? {
          en: 'The browser visited this server before and kept a session ticket. Next to the Initial packet with ClientHello, the same UDP datagram carries a 0-RTT packet with the two requests, encrypted with keys from that ticket: the requests leave before any answer.',
          ja: 'ブラウザーは以前このサーバーに接続していて、セッションチケットを持っている。ClientHello の Initial パケットと同じ UDP データグラムに、そのチケットの鍵で暗号化した 0-RTT パケットで 2 つの要求を入れる。答えを待つ前に要求が出ていく。',
        }
      : {
          en: 'There is no TCP handshake: the first UDP datagram already starts TLS. The Initial packet carries the TLS ClientHello in a CRYPTO frame. It is protected with Initial keys, which anyone can compute, so it is effectively readable.',
          ja: 'TCP のハンドシェイクはなく、最初の UDP データグラムで TLS が始まる。Initial パケットは TLS の ClientHello を CRYPTO フレームで運ぶ。Initial の鍵で保護しているが、この鍵は誰でも計算できるので、実質的には読める。',
        },
    events: [
      ...flight1.map(send),
      set(CLIENT, KEYS, early ? 'Initial, 0-RTT' : 'Initial'),
      set(CLIENT, HANDSHAKE, 'in progress'),
      set(CLIENT, PACKET_NUMBERS, pnTable(cInitial, cHandshake, cApp)),
      ...(early ? [set(CLIENT, STREAMS, streamTable(['sent (0-RTT)', 'sent (0-RTT)']))] : []),
    ],
  })

  if (loss === 'handshake') {
    const flight1b = firstFlight(true)
    steps.push({
      id: 'client-pto',
      section: handshakeSection,
      title: {
        en: 'No answer: the browser resends after the PTO',
        ja: '答えがない: ブラウザーが PTO のあとで送り直す',
      },
      description: {
        en: `The first datagram was lost. The browser has no RTT sample yet, so it assumes 333 ms and waits one probe timeout (PTO) of about 1 second. Then it sends the ClientHello again${early ? ' and the 0-RTT requests' : ''}. The data is the same, but the packet gets a new packet number: QUIC never reuses one.`,
        ja: `最初のデータグラムが失われた。ブラウザーはまだ RTT を測れていないので 333 ミリ秒とみなし、約 1 秒のプローブタイムアウト（PTO）を待つ。そして ClientHello ${early ? 'と 0-RTT の要求' : ''}をもう一度送る。中身は同じだが、パケットには新しいパケット番号を付ける。QUIC はパケット番号を使い回さない。`,
      },
      events: [
        { kind: 'timer', actorId: CLIENT, name: 'PTO', durationMs: PTO_MS },
        ...flight1b.map(send),
        set(CLIENT, PACKET_NUMBERS, pnTable(cInitial, cHandshake, cApp)),
      ],
    })
  }

  // ---------- 2. サーバーの応答（ServerHello … Finished、受理した 0-RTT への応答） ----------
  const sInitialPn = 0
  const sHandshakePn = 0
  let sAppPn = 0
  /** クライアントが受け取ったサーバーの 1-RTT パケットの番号 */
  const sAppReceived: number[] = []

  /** サーバーが送る応答のパケット。loss=stream なら stream 0 の最初の部分が失われる */
  const responsePackets = (ack: string | null): { messages: Message[]; firstPn: number } => {
    const firstPn = sAppPn
    const parts: [string, string][] = [
      ['response-0-1', 'STREAM 0 (HEADERS 200, DATA / 1/3)'],
      ['response-4', 'STREAM 4 (HEADERS 200, DATA /style.css, FIN)'],
      ['response-0-2', 'STREAM 0 (DATA / 2/3)'],
      ['response-0-3', 'STREAM 0 (DATA / 3/3, FIN)'],
    ]
    const messages = parts.map(([id, frames], i) => {
      const pn = sAppPn++
      const lost = loss === 'stream' && id === 'response-0-1'
      if (!lost) {
        sAppReceived.push(pn)
      }
      return packet({
        id,
        from: SERVER,
        to: CLIENT,
        type: '1-RTT',
        pn,
        frames: i === 0 && ack !== null ? `ACK ${ack}, ${frames}` : frames,
        status: lost ? 'lost' : 'delivered',
      })
    })
    return { messages, firstPn }
  }

  const serverFlight: Message[] = [
    packet({
      id: 'server-initial',
      from: SERVER,
      to: CLIENT,
      type: 'Initial',
      pn: sInitialPn,
      frames: `ACK ${String(cInitial.at(-1) ?? 0)}, CRYPTO (ServerHello)`,
    }),
    packet({
      id: 'server-handshake',
      from: SERVER,
      to: CLIENT,
      type: 'Handshake',
      pn: sHandshakePn,
      frames: 'CRYPTO (EncryptedExtensions, Certificate, CertificateVerify, Finished)',
      extra: early
        ? [
            {
              name: 'EncryptedExtensions',
              value: accepted ? 'early_data (0-RTT accepted)' : '(no early_data: 0-RTT rejected)',
              highlight: true,
            },
          ]
        : [],
    }),
  ]
  let responseStart = -1
  if (accepted) {
    // 受け付けた 0-RTT のパケットは、最初の応答のパケットで確認応答する（RFC 9000 §13.2.1、図 6）
    const response = responsePackets(ackRanges(serverGotApp))
    responseStart = response.firstPn
    serverFlight.push(...response.messages)
  }
  steps.push({
    id: 'server-flight',
    section: handshakeSection,
    title: accepted
      ? {
          en: 'The server answers the handshake and the 0-RTT requests',
          ja: 'サーバーがハンドシェイクと 0-RTT の要求に答える',
        }
      : { en: 'The server’s handshake flight', ja: 'サーバーのハンドシェイクの応答' },
    description: accepted
      ? loss === 'stream'
        ? {
            en: 'In one go the server sends ServerHello (Initial), the rest of its TLS handshake (Handshake), and already the responses to the 0-RTT requests in 1-RTT packets. The first packet of stream 0 is lost, but style.css on stream 4 arrives complete and can be used right away: QUIC delivers each stream on its own.',
            ja: 'サーバーは一度に、ServerHello（Initial）、残りの TLS のハンドシェイク（Handshake）、そして 0-RTT の要求への応答を 1-RTT パケットで送る。ストリーム 0 の最初のパケットは失われるが、ストリーム 4 の style.css は全部届き、すぐに使える。QUIC はストリームごとに別々に渡す。',
          }
        : {
            en: 'In one go the server sends ServerHello (Initial), the rest of its TLS handshake (Handshake), and already the responses to the 0-RTT requests in 1-RTT packets (in reality, until the client’s address is confirmed, the server may send only three times what it received). The requests were answered in the very first round trip.',
            ja: 'サーバーは一度に、ServerHello（Initial）、残りの TLS のハンドシェイク（Handshake）、そして 0-RTT の要求への応答を 1-RTT パケットで送る（実際には、クライアントのアドレスを確かめるまでは、受け取った量の 3 倍までしか送れない）。最初の 1 往復で要求に答えが返った。',
          }
      : earlyData === 'rejected'
        ? {
            en: 'The server does not accept early data this time (for example, its ticket key changed), so it leaves early_data out of EncryptedExtensions and discards the 0-RTT packet. Otherwise the handshake goes on normally.',
            ja: 'サーバーは今回は早期データを受け付けない（チケットの鍵が変わった場合など）ので、EncryptedExtensions に early_data を入れず、0-RTT パケットを捨てる。ハンドシェイクはそのまま続く。',
          }
        : {
            en: 'The server answers with ServerHello in an Initial packet and the rest of the TLS handshake (EncryptedExtensions, Certificate, CertificateVerify, Finished) in a Handshake packet, encrypted with the new handshake keys. Several packets can share one UDP datagram.',
            ja: 'サーバーは ServerHello を Initial パケットで、残りの TLS のハンドシェイク（EncryptedExtensions、Certificate、CertificateVerify、Finished）を新しい Handshake の鍵で暗号化した Handshake パケットで返す。複数のパケットを 1 つの UDP データグラムにまとめられる。',
          },
    events: [
      ...serverFlight.map(send),
      set(
        SERVER,
        KEYS,
        accepted ? 'Initial, 0-RTT, Handshake, 1-RTT' : 'Initial, Handshake, 1-RTT',
      ),
      set(SERVER, HANDSHAKE, 'in progress'),
      ...(early
        ? [
            set(
              CLIENT,
              STREAMS,
              streamTable(
                accepted
                  ? [loss === 'stream' ? '1 packet missing' : 'closed', 'closed']
                  : ['0-RTT rejected', '0-RTT rejected'],
              ),
            ),
          ]
        : []),
    ],
  })

  // ---------- 3. クライアントの Finished（と 1-RTT の要求） ----------
  const clientFinished: Message[] = [
    packet({
      id: 'client-initial-ack',
      from: CLIENT,
      to: SERVER,
      type: 'Initial',
      pn: next(cInitial),
      frames: 'ACK 0',
    }),
    packet({
      id: 'client-handshake',
      from: CLIENT,
      to: SERVER,
      type: 'Handshake',
      pn: next(cHandshake),
      frames: 'ACK 0, CRYPTO (Finished)',
    }),
  ]
  if (accepted) {
    // 0.5-RTT の応答をすぐに確認応答する
    clientFinished.push(
      packet({
        id: 'client-early-ack',
        from: CLIENT,
        to: SERVER,
        type: '1-RTT',
        pn: next(cApp),
        frames: `ACK ${ackRanges(sAppReceived)}`,
      }),
    )
  } else {
    const requestPn = next(cApp)
    serverGotApp.push(requestPn)
    clientFinished.push(
      packet({
        id: 'client-requests',
        from: CLIENT,
        to: SERVER,
        type: '1-RTT',
        pn: requestPn,
        frames: REQUEST_FRAMES,
      }),
    )
  }
  steps.push({
    id: 'client-finished',
    section: handshakeSection,
    title: accepted
      ? { en: 'The browser finishes the handshake', ja: 'ブラウザーがハンドシェイクを終える' }
      : {
          en: 'Finished and the requests, after one round trip',
          ja: '1 往復で Finished と要求を送る',
        },
    description: accepted
      ? {
          en: 'The browser checks the certificate and sends its Finished. It no longer needs the Initial keys and discards them.',
          ja: 'ブラウザーは証明書を確かめて Finished を送る。Initial の鍵はもう要らないので捨てる。',
        }
      : earlyData === 'rejected'
        ? {
            en: 'The 0-RTT requests were not processed, so the browser sends them again in a 1-RTT packet together with its Finished. Note the packet number: it continues after the 0-RTT one, because 0-RTT and 1-RTT share the application space.',
            ja: '0-RTT の要求は処理されなかったので、ブラウザーは Finished と一緒に、1-RTT パケットで要求を送り直す。パケット番号に注目。0-RTT と 1-RTT はアプリケーションの空間を共有するので、0-RTT の続きの番号になる。',
          }
        : {
            en: `After a single round trip the browser completes the handshake and sends its requests in the same datagram as Finished, one request per stream (0 and 4). Over TCP and TLS 1.3 the request would leave only after two round trips (see the HTTPS theme). The Initial keys are discarded.`,
            ja: `1 往復でハンドシェイクが終わり、ブラウザーは Finished と同じデータグラムで要求を送る。要求ごとに 1 つのストリーム（0 と 4）を使う。TCP と TLS 1.3 なら、要求が出ていくのは 2 往復のあと（HTTPS のテーマを参照）。Initial の鍵は捨てる。`,
          },
    events: [
      ...clientFinished.map(send),
      set(CLIENT, KEYS, 'Handshake, 1-RTT'),
      set(CLIENT, HANDSHAKE, 'complete'),
      // サーバーは Finished を受け取るとハンドシェイクが完了し、同時に確定する（RFC 9001 §4.1.2）。Initial と Handshake の鍵を捨てる
      set(SERVER, KEYS, '1-RTT'),
      set(SERVER, HANDSHAKE, 'confirmed'),
      set(CLIENT, PACKET_NUMBERS, pnTable(null, cHandshake, cApp)),
      ...(accepted ? [] : [set(CLIENT, STREAMS, streamTable(['sent', 'sent']))]),
    ],
  })

  // ---------- 4. HANDSHAKE_DONE と応答 ----------
  const donePn = sAppPn++
  sAppReceived.push(donePn)
  const done = packet({
    id: 'handshake-done',
    from: SERVER,
    to: CLIENT,
    type: '1-RTT',
    pn: donePn,
    frames: `HANDSHAKE_DONE, ACK ${ackRanges(serverGotApp)}`,
  })
  const responses: Message[] = []
  if (!accepted) {
    const response = responsePackets(null)
    responseStart = response.firstPn
    responses.push(...response.messages)
  }
  steps.push({
    id: 'server-response',
    section: SECTIONS.application,
    title: accepted
      ? { en: 'The handshake is confirmed', ja: 'ハンドシェイクが確定する' }
      : { en: 'The responses arrive on their streams', ja: '応答がストリームごとに届く' },
    description: accepted
      ? {
          en: 'The server confirms the handshake with HANDSHAKE_DONE. Now both sides drop the Handshake keys and use only 1-RTT keys.',
          ja: 'サーバーは HANDSHAKE_DONE でハンドシェイクを確定させる。両者は Handshake の鍵を捨て、1-RTT の鍵だけを使う。',
        }
      : loss === 'stream'
        ? {
            en: 'The server confirms the handshake with HANDSHAKE_DONE and sends the responses. The first packet of stream 0 is lost, but the style.css response on stream 4 arrives complete and can be used right away: QUIC delivers each stream on its own, so a gap in stream 0 does not hold back stream 4.',
            ja: 'サーバーは HANDSHAKE_DONE でハンドシェイクを確定させ、応答を送る。ストリーム 0 の最初のパケットは失われるが、ストリーム 4 の style.css の応答は全部届き、すぐに使える。QUIC はストリームごとに別々に渡すので、ストリーム 0 の抜けがストリーム 4 を止めない。',
          }
        : {
            en: 'The server confirms the handshake with HANDSHAKE_DONE and sends the responses as HTTP/3 HEADERS and DATA frames inside STREAM frames. Both sides now drop the Handshake keys.',
            ja: 'サーバーは HANDSHAKE_DONE でハンドシェイクを確定させ、応答を HTTP/3 の HEADERS と DATA のフレームとして STREAM フレームに入れて送る。両者は Handshake の鍵を捨てる。',
          },
    events: [
      send(done),
      ...responses.map(send),
      set(CLIENT, KEYS, '1-RTT'),
      set(CLIENT, HANDSHAKE, 'confirmed'),
      set(CLIENT, PACKET_NUMBERS, pnTable(null, null, cApp)),
      ...(accepted
        ? []
        : [
            set(
              CLIENT,
              STREAMS,
              streamTable([loss === 'stream' ? '1 packet missing' : 'closed', 'closed']),
            ),
          ]),
    ],
  })

  // ---------- 5. ACK（とロスの回復） ----------
  const ackPn = next(cApp)
  if (loss === 'stream') {
    steps.push({
      id: 'client-ack-gap',
      section: SECTIONS.application,
      title: { en: 'The ACK shows a gap', ja: 'ACK に抜けがある' },
      description: {
        en: `The browser acknowledges packets ${ackRanges(sAppReceived)}. Packet ${String(responseStart)} is missing from the list.`,
        ja: `ブラウザーはパケット ${ackRanges(sAppReceived)} を確認応答する。${String(responseStart)} 番が抜けている。`,
      },
      events: [
        send(
          packet({
            id: 'client-ack-gap',
            from: CLIENT,
            to: SERVER,
            type: '1-RTT',
            pn: ackPn,
            frames: `ACK ${ackRanges(sAppReceived)}`,
          }),
        ),
        set(CLIENT, PACKET_NUMBERS, pnTable(null, null, cApp)),
      ],
    })
    const rtxPn = sAppPn++
    const finalAck = next(cApp)
    steps.push({
      id: 'stream-retransmit',
      section: SECTIONS.application,
      title: {
        en: 'The lost data is resent in a new packet',
        ja: '失われたデータを新しいパケットで送り直す',
      },
      description: {
        en: `A packet numbered at least 3 higher than packet ${String(responseStart)} has been acknowledged, so the server declares it lost without waiting for a timer. It resends the lost STREAM data in a new packet, number ${String(rtxPn)}. Only stream 0 had to wait.`,
        ja: `パケット ${String(responseStart)} より 3 以上大きい番号のパケットが確認されたので、サーバーはタイマーを待たずに ${String(responseStart)} を失われたとみなす。失われた STREAM のデータを、新しい ${String(rtxPn)} 番のパケットで送り直す。待たされたのはストリーム 0 だけ。`,
      },
      events: [
        send(
          packet({
            id: 'response-0-1-rtx',
            from: SERVER,
            to: CLIENT,
            type: '1-RTT',
            pn: rtxPn,
            frames: 'STREAM 0 (HEADERS 200, DATA / 1/3)',
            retransmitOf: 'response-0-1',
          }),
        ),
        send(
          packet({
            id: 'client-ack-final',
            from: CLIENT,
            to: SERVER,
            type: '1-RTT',
            pn: finalAck,
            frames: `ACK ${ackRanges([...sAppReceived, rtxPn])}`,
          }),
        ),
        set(CLIENT, STREAMS, streamTable(['closed', 'closed'])),
        set(CLIENT, PACKET_NUMBERS, pnTable(null, null, cApp)),
      ],
    })
    return steps
  }

  steps.push({
    id: 'client-ack',
    section: SECTIONS.application,
    title: { en: 'The browser acknowledges', ja: 'ブラウザーが確認応答する' },
    description: {
      en: 'The browser acknowledges the server’s packets. The page has both files. Unlike TCP, the acknowledgment is a frame inside an encrypted packet, so observers cannot read it.',
      ja: 'ブラウザーはサーバーのパケットを確認応答する。ページには 2 つのファイルがそろった。TCP と違い、確認応答も暗号化したパケットの中のフレームなので、途中で見る人には読めない。',
    },
    events: [
      send(
        packet({
          id: 'client-ack',
          from: CLIENT,
          to: SERVER,
          type: '1-RTT',
          pn: ackPn,
          frames: `ACK ${ackRanges(sAppReceived)}`,
        }),
      ),
      set(CLIENT, PACKET_NUMBERS, pnTable(null, null, cApp)),
    ],
  })
  return steps
}

export const quicScenario: Scenario<QuicOptions> = {
  id: 'quic',
  title: {
    en: 'QUIC and HTTP/3: handshake, 0-RTT, and loss',
    ja: 'QUIC と HTTP/3: ハンドシェイク、0-RTT、ロス',
  },
  actors,
  optionDefs: {
    earlyData: {
      kind: 'select',
      label: { en: 'Returning visit (0-RTT)', ja: '再訪問（0-RTT）' },
      choices: [
        {
          value: 'none',
          label: { en: 'First visit (no 0-RTT)', ja: '初めての訪問（0-RTT なし）' },
        },
        { value: 'accepted', label: { en: '0-RTT accepted', ja: '0-RTT が受け付けられる' } },
        { value: 'rejected', label: { en: '0-RTT rejected', ja: '0-RTT が断られる' } },
      ],
      defaultValue: 'none',
    },
    loss: {
      kind: 'select',
      label: { en: 'A packet is lost', ja: 'パケットのロス' },
      choices: [
        { value: 'none', label: { en: 'No loss', ja: 'ロスなし' } },
        {
          value: 'handshake',
          label: { en: 'The first datagram', ja: '最初のデータグラム' },
        },
        {
          value: 'stream',
          label: { en: 'A packet of stream 0', ja: 'ストリーム 0 のパケット' },
        },
      ],
      defaultValue: 'none',
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
