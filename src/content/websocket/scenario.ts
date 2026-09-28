/**
 * WebSocket: ハンドシェイク、フレーム、接続の終了
 *
 * 根拠:
 * - RFC 6455 §1.3（Sec-WebSocket-Accept の計算。101 以外は失敗）、§3（ws は 80、wss は 443）、§4.1（クライアントの要求: 項目 4〜9、
 *   応答の検証 1〜6。Accept が違えば Fail the WebSocket Connection）、§4.2.2（101 を送ると OPEN。Origin を拒むなら 403、版が違えば 426）、
 *   §5.1（クライアントは TLS の上でもマスクする。サーバーはマスクしない）、§5.2（FIN・RSV・opcode・長さの 7 / 16 / 64 ビット、最小の表現）、
 *   §5.3（フレームごとに新しいマスクキー）、§5.4（フラグメント化。制御フレームは途中に挟めるが分割しない）、§5.5（制御フレームは 125 バイト以下）、
 *   §5.5.1（Close。応答では同じコードを返す。両方を送受信したらサーバーはすぐに TCP を閉じる）、§5.5.2、§5.5.3（Ping と Pong。Pong は同じ
 *   データを返す）、§5.7（例のバイト列）、§6.2（メッセージの組み立て）、§7.1.1（サーバーが先に TCP を閉じ、TIME_WAIT を持つ）、§7.1.5（Close を
 *   受け取らずに閉じたら 1006）、§7.1.7（確立する前の失敗では Close を送らない。届かないと思えば省いてよい）、§7.2.1（トランスポートを失ったら
 *   接続を失敗にする）、§7.4.1、§7.4.2（ステータスコード。1005・1006・1015 は送らない）、§10.1、§10.2（Origin。ブラウザー以外は偽れる）、
 *   §10.3（マスクの理由）、§10.8（SHA-1 の安全性には頼らない）
 * - WHATWG WebSockets Standard（節の名前で引く）: readyState、close() の code は 1000 か 3000〜4999、credentials mode "include"、
 *   失敗の理由をスクリプトに伝えない（1006）、error と close のイベント、binaryType の既定は "blob"、ping を送る API はない
 * - RFC 9110 §7.6.1、§7.8、§15.2.2（Connection、Upgrade、101 Switching Protocols）
 * - 触れるだけ: RFC 8441、RFC 9220（HTTP/2・HTTP/3 の上の WebSocket）、RFC 7692（permessage-deflate、RSV1）、HTML Standard の Server-sent events
 *
 * 学習用の単純化: Sec-WebSocket-Key は RFC 6455 §1.3 の例（本当は接続ごとに新しい 16 バイトの乱数）。マスクキーは例の値（1 つ目は §5.7 の例。
 * 本当はフレームごとに強い乱数）。TCP と TLS の接続はできているものとし、フレームは暗号化せずに描く（実際は wss:// で TLS の上）。
 * permessage-deflate の提案と Sec-WebSocket-Protocol は省く。TCP の終了は FIN だけを描き、ACK は省く（TCP の接続の終了のテーマを参照）。
 * Ping の間隔 30 秒と Pong の待ち時間 10 秒は例（RFC 6455 は決めていない）。1 つのフレームを 1 つのメッセージとして描く
 * （実際は複数の TCP セグメントに分かれることがある）
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
import {
  closePayload,
  frameHeader,
  hex,
  lengthEncoding,
  maskPayload,
  OPCODES,
  utf8,
  type MaskingKey,
  type Opcode,
} from './frame'

const optionsSchema = z.object({
  problem: z.enum(['none', 'badAccept', 'noPong']).catch('none'),
  fragment: z.stringbool().catch(false),
})
export type WebSocketOptions = z.infer<typeof optionsSchema>

const BROWSER: ActorId = 'browser'
const SERVER: ActorId = 'server'

const READY_STATE: StateKey = 'readyState'
const HANDSHAKE: StateKey = 'handshake'
const REASSEMBLY: StateKey = 'reassembly'
const EVENT: StateKey = 'event'
const TCP: StateKey = 'tcp'
const CONNECTION: StateKey = 'connection'
const ORIGIN: StateKey = 'origin'
const ACCEPT: StateKey = 'accept'
const HEARTBEAT: StateKey = 'heartbeat'

export const ACCEPT_COLUMNS = ['Stage', 'Value'] as const

/** RFC 6455 §1.3 の例 */
export const KEY = 'dGhlIHNhbXBsZSBub25jZQ=='
export const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
export const ACCEPT_SHA1 = 'b37a4f2cc0624f1690f64606cf385945b2bec4ea'
export const ACCEPT_VALUE = 's3pPLMBiTxaQ9kYGzzhZRbK+xOo='
/** GUID を付け忘れたときの値: base64(SHA-1(キーだけ)) */
export const WRONG_SHA1 = '8472ed7f657593c6834197cd8f0dc86b5842c2dd'
export const WRONG_ACCEPT = 'hHLtf2V1k8aDQZfNjw3Ia1hCwt0='

const ORIGIN_VALUE = 'https://www.example.com'
export const PING_INTERVAL_MS = 30_000
export const PONG_TIMEOUT_MS = 10_000
export const PHOTO_BYTES = 100_000
export const FRAGMENTS = [40_000, 40_000, 20_000] as const

/** クライアントのマスクキー（1 つ目は RFC 6455 §5.7 の例。ほかは例の値） */
export const MASKING_KEYS = {
  text: [0x37, 0xfa, 0x21, 0x3d],
  pong: [0x9a, 0x3c, 0x51, 0x07],
  close: [0x5b, 0x8e, 0x1f, 0x42],
} as const satisfies Record<string, MaskingKey>

const actors: readonly Actor[] = [
  {
    id: BROWSER,
    kind: 'client',
    name: {
      en: 'Browser (page on https://www.example.com)',
      ja: 'ブラウザー（https://www.example.com のページ）',
    },
    shortName: { en: 'Browser', ja: 'ブラウザー' },
    stateSlots: [
      {
        key: READY_STATE,
        label: { en: 'readyState (WebSocket object)', ja: 'readyState（WebSocket オブジェクト）' },
        initial: '-',
      },
      {
        key: HANDSHAKE,
        label: { en: 'Handshake check', ja: 'ハンドシェイクの確認' },
        initial: '-',
      },
      {
        key: REASSEMBLY,
        label: { en: 'Message being reassembled', ja: '組み立て中のメッセージ' },
        initial: '-',
      },
      {
        key: EVENT,
        label: { en: 'Last event to the page', ja: 'ページに届いた最後のイベント' },
        initial: '-',
      },
      { key: TCP, label: { en: 'TCP state', ja: 'TCP の状態' }, initial: 'ESTABLISHED' },
    ],
  },
  {
    id: SERVER,
    kind: 'server',
    name: { en: 'chat.example.com (192.0.2.20)', ja: 'chat.example.com（192.0.2.20）' },
    shortName: { en: 'Server', ja: 'サーバー' },
    stateSlots: [
      {
        key: CONNECTION,
        label: { en: 'WebSocket connection', ja: 'WebSocket の接続' },
        initial: '-',
      },
      { key: ORIGIN, label: { en: 'Origin check', ja: 'Origin の確認' }, initial: '-' },
      {
        key: ACCEPT,
        label: {
          en: 'Sec-WebSocket-Accept computation',
          ja: 'Sec-WebSocket-Accept の計算',
        },
        initial: { columns: ACCEPT_COLUMNS, rows: [] },
      },
      { key: HEARTBEAT, label: { en: 'Heartbeat', ja: 'ハートビート' }, initial: '-' },
      { key: TCP, label: { en: 'TCP state', ja: 'TCP の状態' }, initial: 'ESTABLISHED' },
    ],
  },
]

const set = (actorId: ActorId, key: StateKey, value: string | StateTable): StepEvent => ({
  kind: 'stateChange',
  actorId,
  key,
  value,
})
const send = (message: Message): StepEvent => ({ kind: 'message', message })
const timer = (name: string, durationMs: number): StepEvent => ({
  kind: 'timer',
  actorId: SERVER,
  name,
  durationMs,
})

const TEXT = {
  fin: {
    en: 'FIN = 1: the last (or only) frame of the message. FIN = 0: more frames of this message follow',
    ja: 'FIN = 1: メッセージの最後の（または唯一の）フレーム。FIN = 0: このメッセージのフレームがまだ続く',
  },
  opcode: {
    en: '0x0 continuation, 0x1 text, 0x2 binary, 0x8 close, 0x9 ping, 0xA pong',
    ja: '0x0 継続、0x1 テキスト、0x2 バイナリー、0x8 Close、0x9 Ping、0xA Pong',
  },
  masked: {
    en: 'MASK = 1: every frame from the client is masked, even over TLS, so that a script cannot choose the exact bytes on the wire (which could confuse proxies). Masking is not encryption: the key is in the frame',
    ja: 'MASK = 1: クライアントからのフレームは、TLS の上でもすべてマスクする。スクリプトが通信路のバイト列を思いどおりに作れないようにするため（プロキシを混乱させうる）。マスクは暗号化ではない。キーはフレームの中にある',
  },
  unmasked: {
    en: 'MASK = 0: frames from the server are never masked',
    ja: 'MASK = 0: サーバーからのフレームはマスクしない',
  },
  maskingKey: {
    en: 'A new 4-byte key for every frame. Byte i of the payload is XORed with byte i mod 4 of the key',
    ja: 'フレームごとに新しい 4 バイトのキー。ペイロードの i 番目のバイトを、キーの i mod 4 番目のバイトと XOR する',
  },
  length: {
    en: '0–125: the length itself. 126: the next 2 bytes hold it. 127: the next 8 bytes hold it. The shortest form must be used',
    ja: '0〜125: その値が長さ。126: 次の 2 バイトが長さ。127: 次の 8 バイトが長さ。いちばん短い表し方を使う',
  },
} satisfies Record<string, LocalizedText>

interface FrameMessage {
  readonly id: string
  readonly from: ActorId
  readonly label: string
  readonly fin: boolean
  readonly opcode: Opcode
  readonly payload?: readonly number[]
  /** payload を持たない大きなデータの長さ */
  readonly length?: number
  readonly payloadText: string
  readonly status?: Message['status']
}

function frame(spec: FrameMessage): Message {
  const fromBrowser = spec.from === BROWSER
  const key: MaskingKey | undefined = fromBrowser
    ? spec.opcode === 'pong'
      ? MASKING_KEYS.pong
      : spec.opcode === 'close'
        ? MASKING_KEYS.close
        : MASKING_KEYS.text
    : undefined
  const length = spec.payload?.length ?? spec.length ?? 0
  const header = frameHeader({
    fin: spec.fin,
    opcode: spec.opcode,
    length,
    ...(key === undefined ? {} : { maskingKey: key }),
  })
  const fields: PacketField[] = [
    { name: 'FIN', value: spec.fin ? '1' : '0', highlight: !spec.fin, description: TEXT.fin },
    { name: 'RSV1-3', value: '0 0 0' },
    {
      name: 'Opcode',
      value: `0x${OPCODES[spec.opcode].toString(16).toUpperCase()} (${spec.opcode})`,
      description: TEXT.opcode,
    },
    {
      name: 'MASK',
      value: key === undefined ? '0' : '1',
      highlight: fromBrowser,
      description: key === undefined ? TEXT.unmasked : TEXT.masked,
    },
    {
      name: 'Payload length',
      value: `${String(length)} (${lengthEncoding(length)})`,
      description: TEXT.length,
    },
  ]
  if (key !== undefined) {
    fields.push({ name: 'Masking key', value: hex(key), description: TEXT.maskingKey })
  }
  fields.push({ name: 'Header bytes', value: hex(header), highlight: true })
  if (key !== undefined && spec.payload !== undefined) {
    fields.push({ name: 'Payload (on the wire)', value: hex(maskPayload(spec.payload, key)) })
  }
  fields.push({ name: 'Payload', value: spec.payloadText })
  return {
    id: spec.id,
    from: spec.from,
    to: fromBrowser ? SERVER : BROWSER,
    label: spec.label,
    status: spec.status ?? 'delivered',
    fields,
  }
}

function tcpFin(id: string, from: ActorId, status: Message['status'] = 'delivered'): Message {
  return {
    id,
    from,
    to: from === BROWSER ? SERVER : BROWSER,
    label: 'TCP FIN',
    status,
    description: {
      en: 'A TCP segment with the FIN flag, not a WebSocket frame. The ACKs are left out (see the TCP closing theme).',
      ja: 'FIN フラグの立った TCP のセグメントで、WebSocket のフレームではない。ACK は省いている（TCP の接続の終了のテーマを参照）。',
    },
    fields: [{ name: 'TCP flags', value: 'FIN, ACK' }],
  }
}

const HANDSHAKE_SECTION: LocalizedText = { en: 'Opening handshake', ja: '開始のハンドシェイク' }
const MESSAGES_SECTION: LocalizedText = { en: 'Messages', ja: 'メッセージ' }
const HEARTBEAT_SECTION: LocalizedText = { en: 'Ping and Pong', ja: 'Ping と Pong' }
const CLOSE_SECTION: LocalizedText = { en: 'Closing handshake', ja: '終了のハンドシェイク' }

function acceptTable(wrong: boolean): StateTable {
  return {
    columns: ACCEPT_COLUMNS,
    rows: wrong
      ? [
          ['Sec-WebSocket-Key', KEY],
          ['+ GUID', '(forgotten)'],
          ['SHA-1 (hex)', WRONG_SHA1],
          ['base64', WRONG_ACCEPT],
        ]
      : [
          ['Sec-WebSocket-Key', KEY],
          ['+ GUID', GUID],
          ['SHA-1 (hex)', ACCEPT_SHA1],
          ['base64', ACCEPT_VALUE],
        ],
  }
}

function handshakeSteps(badAccept: boolean): Step[] {
  return [
    {
      id: 'handshake-request',
      section: HANDSHAKE_SECTION,
      title: {
        en: 'The browser asks to upgrade to WebSocket',
        ja: 'ブラウザーが WebSocket へのアップグレードを頼む',
      },
      description: {
        en: 'The page calls new WebSocket("wss://chat.example.com/chat"). The browser sends an ordinary HTTP/1.1 GET with Upgrade: websocket and Connection: Upgrade, a random key, version 13, and the page’s Origin. Cookies for chat.example.com are sent too. There is no same-origin check and no CORS: the server has to check Origin itself.',
        ja: 'ページが new WebSocket("wss://chat.example.com/chat") を呼ぶ。ブラウザーは、Upgrade: websocket と Connection: Upgrade、乱数のキー、版の 13、ページの Origin を付けた、ふつうの HTTP/1.1 の GET を送る。chat.example.com の Cookie も送る。同一オリジンの確認も CORS もないので、Origin はサーバーが自分で確かめる。',
      },
      events: [
        send({
          id: 'handshake-request',
          from: BROWSER,
          to: SERVER,
          label: 'GET /chat (Upgrade: websocket)',
          status: 'delivered',
          fields: [
            { name: 'Request line', value: 'GET /chat HTTP/1.1' },
            { name: 'Host', value: 'chat.example.com' },
            {
              name: 'Upgrade',
              value: 'websocket',
              highlight: true,
              description: {
                en: 'The protocol to switch to',
                ja: '切り替えたいプロトコル',
              },
            },
            {
              name: 'Connection',
              value: 'Upgrade',
              description: {
                en: 'Upgrade is a hop-by-hop header, so it must be listed in Connection',
                ja: 'Upgrade は区間ごとのヘッダーなので、Connection に並べなければならない',
              },
            },
            {
              name: 'Sec-WebSocket-Key',
              value: KEY,
              highlight: true,
              description: {
                en: 'Base64 of 16 random bytes, new for every connection (this page uses the example from RFC 6455)',
                ja: '16 バイトの乱数の base64 で、接続ごとに新しくする（このページでは RFC 6455 の例を使う）',
              },
            },
            { name: 'Sec-WebSocket-Version', value: '13' },
            {
              name: 'Origin',
              value: ORIGIN_VALUE,
              description: {
                en: 'The page that opened the connection. Browsers must send it; other clients can write anything',
                ja: '接続を開いたページ。ブラウザーは必ず送る。ブラウザー以外のクライアントは何でも書ける',
              },
            },
            { name: 'Cookie', value: 'session=…' },
          ],
        }),
        set(BROWSER, READY_STATE, 'CONNECTING'),
        set(BROWSER, HANDSHAKE, 'waiting for 101'),
      ],
    },
    {
      id: 'handshake-response',
      section: HANDSHAKE_SECTION,
      title: badAccept
        ? {
            en: '101, but with the wrong Sec-WebSocket-Accept',
            ja: '101 だが、Sec-WebSocket-Accept が違う',
          }
        : { en: '101 Switching Protocols', ja: '101 Switching Protocols' },
      description: badAccept
        ? {
            en: 'The server forgot to append the GUID, so its Accept value is the hash of the key alone. The server thinks the connection is open. The browser computes the value itself, and it does not match: the browser must fail the connection.',
            ja: 'サーバーは GUID を付け忘れたので、Accept の値はキーだけのハッシュになった。サーバーは接続が開いたと思っている。ブラウザーも自分で値を計算するが、一致しない。ブラウザーは接続を失敗にしなければならない。',
          }
        : {
            en: 'The server accepts the Origin, appends the fixed GUID to the key as a string (it does not decode it), takes the SHA-1 hash and encodes it in base64. The browser does the same and compares: they match, so the connection is open. The value only proves that the server understood a WebSocket handshake; it is not authentication, and SHA-1’s security does not matter here. 101 is the only status that means success.',
            ja: 'サーバーは Origin を認め、キーに決まった GUID を文字列のままつなげ（base64 を戻さない）、SHA-1 のハッシュを取って base64 にする。ブラウザーも同じ計算をして比べる。一致するので接続が開く。この値は、サーバーが WebSocket のハンドシェイクを理解したことを示すだけで、認証ではない。SHA-1 の安全性もここでは関係ない。成功を表すのは 101 だけ。',
          },
      events: [
        send({
          id: 'handshake-response',
          from: SERVER,
          to: BROWSER,
          label: '101 Switching Protocols',
          status: badAccept ? 'rejected' : 'delivered',
          fields: [
            { name: 'Status line', value: 'HTTP/1.1 101 Switching Protocols' },
            { name: 'Upgrade', value: 'websocket' },
            { name: 'Connection', value: 'Upgrade' },
            {
              name: 'Sec-WebSocket-Accept',
              value: badAccept ? WRONG_ACCEPT : ACCEPT_VALUE,
              highlight: true,
              description: {
                en: 'base64(SHA-1(key + 258EAFA5-E914-47DA-95CA-C5AB0DC85B11))',
                ja: 'base64(SHA-1(キー + 258EAFA5-E914-47DA-95CA-C5AB0DC85B11))',
              },
            },
          ],
        }),
        set(SERVER, ORIGIN, `allowed: ${ORIGIN_VALUE}`),
        set(SERVER, ACCEPT, acceptTable(badAccept)),
        set(SERVER, CONNECTION, 'OPEN'),
        ...(badAccept
          ? [set(BROWSER, HANDSHAKE, 'Accept mismatch')]
          : [
              set(BROWSER, HANDSHAKE, 'Accept OK'),
              set(BROWSER, READY_STATE, 'OPEN'),
              set(BROWSER, EVENT, 'open'),
            ]),
      ],
    },
  ]
}

function failStep(): Step {
  return {
    id: 'fail',
    section: HANDSHAKE_SECTION,
    title: {
      en: 'The browser fails the connection: no Close frame',
      ja: 'ブラウザーが接続を失敗にする: Close フレームはない',
    },
    description: {
      en: 'Because the connection was never established, the browser does not send a Close frame; it just closes TCP. readyState goes straight from CONNECTING to CLOSED, and the page gets an error event and then a close event with code 1006 (closed abnormally). For security, the browser does not tell the script why; only the developer console shows it. The server learns nothing except that TCP was closed.',
      ja: '接続は一度も確立していないので、ブラウザーは Close フレームを送らず、TCP を閉じるだけ。readyState は CONNECTING からそのまま CLOSED になり、ページには error、続いてコード 1006（異常な終了）の close のイベントが届く。安全のため、ブラウザーはスクリプトに理由を伝えない。開発者ツールのコンソールにだけ出る。サーバーにわかるのは、TCP が閉じたことだけ。',
    },
    events: [
      send(tcpFin('fail-fin-browser', BROWSER)),
      send(tcpFin('fail-fin-server', SERVER)),
      set(BROWSER, READY_STATE, 'CLOSED'),
      set(BROWSER, EVENT, 'error, close: 1006'),
      set(BROWSER, TCP, 'TIME-WAIT'),
      set(SERVER, CONNECTION, 'CLOSED (1006)'),
      set(SERVER, TCP, 'CLOSED'),
    ],
  }
}

function messageSteps(fragment: boolean): Step[] {
  const steps: Step[] = [
    {
      id: 'client-text',
      section: MESSAGES_SECTION,
      title: {
        en: 'The browser sends "Hello" (masked)',
        ja: 'ブラウザーが "Hello" を送る（マスクあり）',
      },
      description: {
        en: 'ws.send("Hello") becomes one text frame: FIN = 1, opcode 0x1, MASK = 1 and a length of 5 in the second byte (0x85 = mask bit + 5), then the 4-byte masking key and the masked payload. These are exactly the bytes of the example in RFC 6455.',
        ja: 'ws.send("Hello") は 1 つのテキストフレームになる。FIN = 1、opcode 0x1、2 バイト目に MASK = 1 と長さ 5（0x85 = マスクのビット + 5）、続いて 4 バイトのマスクキーと、マスクしたペイロード。RFC 6455 の例とまったく同じバイト列。',
      },
      events: [
        send(
          frame({
            id: 'client-text',
            from: BROWSER,
            label: 'Text "Hello" (masked)',
            fin: true,
            opcode: 'text',
            payload: utf8('Hello'),
            payloadText: '"Hello"',
          }),
        ),
      ],
    },
    {
      id: 'server-push',
      section: MESSAGES_SECTION,
      title: {
        en: 'The server sends whenever it wants',
        ja: 'サーバーは好きなときに送れる',
      },
      description: {
        en: 'Once the connection is open, either side can send at any time. The server pushes a chat message without being asked: something plain HTTP can only imitate with polling. Frames from the server are not masked, so the header is just 2 bytes.',
        ja: '接続が開いたら、どちらの側もいつでも送れる。サーバーは頼まれずにチャットのメッセージを送る。ふつうの HTTP では、ポーリングでまねるしかない。サーバーからのフレームはマスクしないので、ヘッダーは 2 バイトだけ。',
      },
      events: [
        send(
          frame({
            id: 'server-push',
            from: SERVER,
            label: 'Text "Hi, Alice!"',
            fin: true,
            opcode: 'text',
            payload: utf8('Hi, Alice!'),
            payloadText: '"Hi, Alice!"',
          }),
        ),
        set(BROWSER, EVENT, 'message: "Hi, Alice!"'),
      ],
    },
  ]
  if (!fragment) {
    steps.push({
      id: 'binary',
      section: MESSAGES_SECTION,
      title: {
        en: 'A 100,000-byte photo in one frame',
        ja: '100,000 バイトの写真を 1 つのフレームで',
      },
      description: {
        en: 'The photo is a binary frame (opcode 0x2). 100,000 does not fit in 7 bits or in 16 bits, so the length byte is 127 and the next 8 bytes hold the real length. The page gets one message event with a Blob (the default binaryType).',
        ja: '写真はバイナリーのフレーム（opcode 0x2）。100,000 は 7 ビットにも 16 ビットにも入らないので、長さのバイトは 127 で、次の 8 バイトに本当の長さが入る。ページには、Blob（binaryType の既定）の message のイベントが 1 回届く。',
      },
      events: [
        send(
          frame({
            id: 'binary',
            from: SERVER,
            label: 'Binary (100,000 bytes)',
            fin: true,
            opcode: 'binary',
            length: PHOTO_BYTES,
            payloadText: '(photo, 100,000 bytes)',
          }),
        ),
        set(BROWSER, EVENT, 'message: Blob (100,000 bytes)'),
      ],
    })
    return steps
  }

  let received = 0
  FRAGMENTS.forEach((size, i) => {
    const last = i === FRAGMENTS.length - 1
    received += size
    const label =
      i === 0
        ? `Binary FIN=0 (${size.toLocaleString('en-US')} bytes)`
        : `Continuation FIN=${last ? '1' : '0'} (${size.toLocaleString('en-US')} bytes)`
    steps.push({
      id: `binary-${String(i + 1)}`,
      section: MESSAGES_SECTION,
      title:
        i === 0
          ? {
              en: 'The photo in fragments: the first frame',
              ja: '写真をフラグメントで: 最初のフレーム',
            }
          : last
            ? { en: 'The last fragment: FIN = 1', ja: '最後のフラグメント: FIN = 1' }
            : { en: 'A continuation frame', ja: '継続フレーム' },
      description:
        i === 0
          ? {
              en: 'The server sends the photo as it reads it, in pieces. The first frame carries the real opcode (0x2 binary) with FIN = 0. 40,000 fits in 16 bits, so the length byte is 126 and the next 2 bytes hold it. The page gets nothing yet.',
              ja: 'サーバーは写真を読みながら、分けて送る。最初のフレームは本当の opcode（0x2 バイナリー）で、FIN = 0。40,000 は 16 ビットに入るので、長さのバイトは 126 で、次の 2 バイトに長さが入る。ページにはまだ何も届かない。',
            }
          : last
            ? {
                en: 'The last piece has FIN = 1. Only now does the browser put the pieces together and fire a single message event. Fragments of different messages are never interleaved, but a control frame such as Ping may come between them.',
                ja: '最後の部分は FIN = 1。ここで初めてブラウザーは部分を組み立て、message のイベントを 1 回だけ出す。別のメッセージのフラグメントが混ざることはないが、Ping のような制御フレームは間に入ってよい。',
              }
            : {
                en: 'The next piece is a continuation frame: opcode 0x0, FIN = 0. The browser keeps collecting.',
                ja: '次の部分は継続フレーム。opcode 0x0、FIN = 0。ブラウザーは集め続ける。',
              },
      events: [
        send(
          frame({
            id: `binary-${String(i + 1)}`,
            from: SERVER,
            label,
            fin: last,
            opcode: i === 0 ? 'binary' : 'continuation',
            length: size,
            payloadText: `(photo, bytes ${String(received - size + 1)}–${String(received)})`,
          }),
        ),
        set(
          BROWSER,
          REASSEMBLY,
          last
            ? '-'
            : `${received.toLocaleString('en-US')} bytes (${String(i + 1)} fragment${i === 0 ? '' : 's'})`,
        ),
        ...(last ? [set(BROWSER, EVENT, 'message: Blob (100,000 bytes)')] : []),
      ],
    })
  })
  return steps
}

const PING_PAYLOAD = utf8('hb-1')

function pingStep(lost: boolean): Step {
  return {
    id: 'ping',
    section: HEARTBEAT_SECTION,
    title: lost
      ? {
          en: 'The server pings, but the path is broken',
          ja: 'サーバーが Ping を送るが、経路が切れている',
        }
      : { en: 'The server checks the connection: Ping', ja: 'サーバーが接続を確かめる: Ping' },
    description: lost
      ? {
          en: 'The browser’s Wi-Fi went out of range. Nothing tells either side: TCP only notices when it tries to send. The server’s Ping is lost on the way.',
          ja: 'ブラウザーの Wi-Fi が届かなくなった。どちらの側にも知らせは来ない。TCP は送ろうとしたときにしか気づかない。サーバーの Ping は途中で失われる。',
        }
      : {
          en: 'The connection has been quiet for 30 seconds, so the server sends a Ping (a control frame, opcode 0x9) with a short payload. Control frames carry at most 125 bytes and are never fragmented. The interval is up to the application; RFC 6455 does not set one.',
          ja: '接続が 30 秒黙っていたので、サーバーは短いペイロードの Ping（制御フレーム、opcode 0x9）を送る。制御フレームは 125 バイト以下で、分割しない。間隔はアプリケーションが決める。RFC 6455 は決めていない。',
        },
    events: [
      timer('Ping interval', PING_INTERVAL_MS),
      send(
        frame({
          id: 'ping',
          from: SERVER,
          label: 'Ping "hb-1"',
          fin: true,
          opcode: 'ping',
          payload: PING_PAYLOAD,
          payloadText: '"hb-1"',
          ...(lost ? { status: 'lost' as const } : {}),
        }),
      ),
      set(SERVER, HEARTBEAT, 'Ping sent (hb-1)'),
    ],
  }
}

function pongStep(): Step {
  return {
    id: 'pong',
    section: HEARTBEAT_SECTION,
    title: { en: 'The browser answers by itself: Pong', ja: 'ブラウザーが自動で答える: Pong' },
    description: {
      en: 'The browser answers the Ping with a Pong carrying the same payload, masked like every frame it sends. The page is not involved and sees no event: the WebSocket API in browsers cannot send or observe Ping and Pong.',
      ja: 'ブラウザーは Ping に、同じペイロードの Pong で答える。送るフレームはどれも同じくマスクする。ページはかかわらず、イベントも届かない。ブラウザーの WebSocket の API では、Ping と Pong を送ることも見ることもできない。',
    },
    events: [
      send(
        frame({
          id: 'pong',
          from: BROWSER,
          label: 'Pong "hb-1" (masked)',
          fin: true,
          opcode: 'pong',
          payload: PING_PAYLOAD,
          payloadText: '"hb-1" (the same as the Ping)',
        }),
      ),
      set(SERVER, HEARTBEAT, 'Pong received (hb-1)'),
    ],
  }
}

function pongTimeoutStep(): Step {
  return {
    id: 'pong-timeout',
    section: HEARTBEAT_SECTION,
    title: {
      en: 'No Pong: the server gives up',
      ja: 'Pong が来ない: サーバーはあきらめる',
    },
    description: {
      en: 'No Pong arrives within 10 seconds (the timeout is the application’s choice). The server decides the connection is dead and closes it without a Close frame, since the browser probably cannot receive one; for the server the result is 1006. The browser still shows OPEN: nothing reached it. It only finds out when its own TCP gives up or it notices the network change, then fails the connection (error, then close with 1006), and the page should reconnect.',
      ja: '10 秒待っても Pong が来ない（待ち時間はアプリケーションが決める）。サーバーは接続が切れたと判断し、ブラウザーは受け取れないだろうから、Close フレームなしで閉じる。サーバーにとっての結果は 1006。ブラウザーは OPEN のまま。何も届いていないから。自分の TCP があきらめるか、ネットワークの変化に気づいたときに初めて接続を失敗にし（error、続いて 1006 の close）、ページはつなぎ直すべき。',
    },
    events: [
      timer('Pong timeout', PONG_TIMEOUT_MS),
      send(tcpFin('timeout-fin-server', SERVER, 'lost')),
      set(SERVER, HEARTBEAT, 'Pong timeout'),
      set(SERVER, CONNECTION, 'CLOSED (1006)'),
      set(SERVER, TCP, 'FIN-WAIT-1'),
    ],
  }
}

function closeSteps(): Step[] {
  const close = closePayload(1000)
  return [
    {
      id: 'close-client',
      section: CLOSE_SECTION,
      title: {
        en: 'The browser starts closing: Close 1000',
        ja: 'ブラウザーが閉じ始める: Close 1000',
      },
      description: {
        en: 'The user leaves the chat and the page calls ws.close(1000). The browser sends a Close frame (opcode 0x8) whose payload is the 2-byte status code 1000, normal closure. After sending Close it sends no more data. (A page may only use 1000 or 3000–4999; close() with no code sends a Close with no body.)',
        ja: 'ユーザーがチャットを離れ、ページが ws.close(1000) を呼ぶ。ブラウザーは、ペイロードが 2 バイトのステータスコード 1000（正常な終了）の Close フレーム（opcode 0x8）を送る。Close を送った後は、もうデータを送らない（ページが使えるのは 1000 か 3000〜4999 だけ。コードなしの close() は、本文のない Close を送る）。',
      },
      events: [
        send(
          frame({
            id: 'close-client',
            from: BROWSER,
            label: 'Close 1000 (masked)',
            fin: true,
            opcode: 'close',
            payload: close,
            payloadText: '1000 (normal closure)',
          }),
        ),
        set(BROWSER, READY_STATE, 'CLOSING'),
        set(SERVER, CONNECTION, 'CLOSING'),
      ],
    },
    {
      id: 'close-server',
      section: CLOSE_SECTION,
      title: { en: 'The server answers: Close 1000', ja: 'サーバーが答える: Close 1000' },
      description: {
        en: 'The server answers with its own Close, echoing the code 1000. It has now both sent and received a Close, so the WebSocket connection is closed from its point of view, and it must close the TCP connection right away.',
        ja: 'サーバーは、コード 1000 をそのまま返す自分の Close で答える。これで Close を送りも受け取りもしたので、サーバーから見て WebSocket の接続は閉じた。すぐに TCP の接続を閉じなければならない。',
      },
      events: [
        send(
          frame({
            id: 'close-server',
            from: SERVER,
            label: 'Close 1000',
            fin: true,
            opcode: 'close',
            payload: close,
            payloadText: '1000 (normal closure)',
          }),
        ),
      ],
    },
    {
      id: 'tcp-close',
      section: CLOSE_SECTION,
      title: {
        en: 'The server closes TCP first',
        ja: 'サーバーが先に TCP を閉じる',
      },
      description: {
        en: 'The server sends the first TCP FIN, so it is the server that waits in TIME-WAIT, not the browser. The browser answers with its own FIN. The page gets a close event with code 1000 and wasClean true. Codes such as 1005, 1006 and 1015 are never sent in a Close frame; they only describe what happened locally.',
        ja: 'サーバーが最初の TCP の FIN を送るので、TIME-WAIT で待つのはブラウザーではなくサーバー。ブラウザーは自分の FIN で答える。ページには、コード 1000、wasClean が true の close のイベントが届く。1005、1006、1015 のようなコードは Close フレームで送らない。手元で起きたことを表すだけ。',
      },
      events: [
        send(tcpFin('close-fin-server', SERVER)),
        send(tcpFin('close-fin-browser', BROWSER)),
        set(SERVER, TCP, 'TIME-WAIT'),
        set(SERVER, CONNECTION, 'CLOSED (1000)'),
        set(BROWSER, TCP, 'CLOSED'),
        set(BROWSER, READY_STATE, 'CLOSED'),
        set(BROWSER, EVENT, 'close: 1000, wasClean true'),
      ],
    },
  ]
}

function buildSteps(options: WebSocketOptions): readonly Step[] {
  if (options.problem === 'badAccept') return [...handshakeSteps(true), failStep()]
  const common = [...handshakeSteps(false), ...messageSteps(options.fragment)]
  if (options.problem === 'noPong') return [...common, pingStep(true), pongTimeoutStep()]
  return [...common, pingStep(false), pongStep(), ...closeSteps()]
}

export const webSocketScenario: Scenario<WebSocketOptions> = {
  id: 'websocket',
  title: {
    en: 'WebSocket: handshake, frames, and closing',
    ja: 'WebSocket: ハンドシェイク、フレーム、接続の終了',
  },
  actors,
  optionDefs: {
    problem: {
      kind: 'select',
      label: { en: 'What goes wrong', ja: 'うまくいかないこと' },
      choices: [
        { value: 'none', label: { en: 'Nothing (normal)', ja: 'なし（正常）' } },
        {
          value: 'badAccept',
          label: {
            en: 'The server returns a wrong Sec-WebSocket-Accept',
            ja: 'サーバーが誤った Sec-WebSocket-Accept を返す',
          },
        },
        {
          value: 'noPong',
          label: {
            en: 'The connection is lost: no Pong',
            ja: '接続が切れて Pong が返らない',
          },
        },
      ],
      defaultValue: 'none',
    },
    fragment: {
      kind: 'toggle',
      label: { en: 'Send the photo in fragments', ja: '写真をフラグメントに分けて送る' },
      description: {
        en: 'Has no effect when the handshake fails.',
        ja: 'ハンドシェイクが失敗するときは影響しない。',
      },
      defaultValue: false,
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
