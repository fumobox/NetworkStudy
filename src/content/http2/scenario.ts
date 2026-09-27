/**
 * HTTP/1.1 と HTTP/2: 1 つの接続でたくさんの要求
 *
 * 根拠:
 * - RFC 9112 §9.3（持続的な接続）、§9.3.2（パイプライン。ほとんど使われない）、§9.4（同時に開く接続の数）
 * - RFC 9113 §3.1（TLS の ALPN で "h2" を選ぶ）、§3.4（接続の序文と SETTINGS。クライアントは相手の SETTINGS を待たずに要求してよい）、
 *   §4.1（フレームの形式）、§5.1（ストリームの状態: HEADERS に END_STREAM を付けて送ると half-closed (local)）、
 *   §5.1.1（クライアントが開くストリームは奇数）、§5.2・§6.9（フロー制御。初期のウィンドウは 65,535 バイト）、
 *   §6.1（DATA）、§6.2（HEADERS）、§6.5・§6.5.2（SETTINGS。フレームの最大の長さの初期値は 16,384 バイト）、
 *   §8.3.1（要求の疑似ヘッダー :method・:scheme・:authority・:path）、§8.3.2（応答の :status）
 * - RFC 7541 §2.3（静的テーブルと動的テーブル。動的テーブルの最初の番号は 62）、付録 A（静的テーブル: :method GET = 2、
 *   :scheme https = 7、:status 200 = 8、:authority = 1）
 * - RFC 6298 §2.4、§5（RTO。最小 1 秒、満了したら最も古い未確認のセグメントを再送する）
 * - RFC 9000 §1、RFC 9114 §1（TCP の上の HTTP/2 では、1 つのパケットのロスがすべてのストリームを止める）
 *
 * 学習用の単純化: 1 つのメッセージを 1 つのフレームとして描く（実際のフレームは複数の TCP セグメントに分かれ、
 * 再送されるのは失われたセグメントだけ）。TCP と TLS の接続はすでにできているものとし、ALPN は描かない。
 * WINDOW_UPDATE、SETTINGS の ACK、PRIORITY、PUSH_PROMISE、GOAWAY は省く。HPACK は表の番号だけを示し、
 * ハフマン符号とバイト数は省く。ロスは RTO（1 秒）で再送し、高速再送は描かない（TCP の輻輳制御のテーマを参照）。
 * HTTP は読めるよう暗号化せずに描く（実際は HTTPS）
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
  version: z.enum(['http2', 'http1']).catch('http2'),
  loss: z.stringbool().catch(false),
})
export type Http2Options = z.infer<typeof optionsSchema>

const CLIENT = 'client'
const SERVER = 'server'
const PROTOCOL: StateKey = 'protocol'
const REQUESTS: StateKey = 'requests'
const TCP: StateKey = 'tcp'
const HPACK: StateKey = 'hpack'

export const REQUEST_COLUMNS = ['ID', 'Path', 'State', 'Received'] as const
export const RTO_MS = 1000
/** 1 つの DATA フレームの最大の長さ（SETTINGS_MAX_FRAME_SIZE の初期値） */
export const MAX_FRAME = 16_384

interface Resource {
  readonly path: string
  readonly name: string
  readonly type: string
  readonly size: number
  /** HTTP/2 のストリーム ID（クライアントが開くので奇数） */
  readonly stream: number
}
export const RESOURCES: readonly Resource[] = [
  { path: '/style.css', name: 'style.css', type: 'text/css', size: 2_000, stream: 1 },
  { path: '/app.js', name: 'app.js', type: 'text/javascript', size: 40_000, stream: 3 },
  { path: '/hero.jpg', name: 'hero.jpg', type: 'image/jpeg', size: 20_000, stream: 5 },
]

/** リソースを MAX_FRAME ごとに分けた長さ */
function chunks(size: number): number[] {
  const result: number[] = []
  for (let offset = 0; offset < size; offset += MAX_FRAME) {
    result.push(Math.min(MAX_FRAME, size - offset))
  }
  return result
}

const bytes = (n: number) => n.toLocaleString('en-US')
const percent = (received: number, size: number) =>
  `${String(Math.round((received / size) * 100))}%`

const actors: readonly Actor[] = [
  {
    id: CLIENT,
    kind: 'client',
    name: { en: 'Browser', ja: 'ブラウザー' },
    stateSlots: [
      { key: PROTOCOL, label: { en: 'Protocol', ja: 'プロトコル' }, initial: '-' },
      {
        key: REQUESTS,
        label: { en: 'Requests', ja: '要求' },
        initial: { columns: REQUEST_COLUMNS, rows: [] },
      },
      {
        key: TCP,
        label: { en: 'TCP receive buffer', ja: 'TCP の受信バッファー' },
        initial: 'in order',
      },
    ],
  },
  {
    id: SERVER,
    kind: 'server',
    name: { en: 'www.example.com (192.0.2.10)', ja: 'www.example.com（192.0.2.10）' },
    shortName: { en: 'Server', ja: 'サーバー' },
    stateSlots: [
      {
        key: HPACK,
        label: { en: 'HPACK dynamic table', ja: 'HPACK の動的テーブル' },
        initial: '-',
      },
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

/** 要求の表。progress はリソースごとの [状態, 受け取ったバイト数] */
function requestTable(
  idOf: (resource: Resource, index: number) => string,
  progress: readonly (readonly [string, number])[],
): StateTable {
  return {
    columns: REQUEST_COLUMNS,
    rows: RESOURCES.map((resource, i) => {
      const [state, received] = progress[i] ?? ['-', 0]
      return [idOf(resource, i), resource.path, state, percent(received, resource.size)]
    }),
  }
}

const RTO_TEXT: LocalizedText = {
  en: 'The server does not get an acknowledgment for the lost data before the retransmission timer (RTO) expires, so it sends the data again.',
  ja: '失われたデータの確認応答が来ないまま再送タイマー（RTO）が満了したので、サーバーはデータを送り直す。',
}

// ---------- HTTP/2 ----------

const STREAM_TEXT: LocalizedText = {
  en: 'Which stream (request) this frame belongs to. Streams opened by the client have odd numbers',
  ja: 'このフレームが属するストリーム（要求）。クライアントが開くストリームは奇数',
}

function frame(
  id: string,
  from: string,
  to: string,
  type: 'HEADERS' | 'DATA',
  stream: number,
  label: string,
  fields: readonly PacketField[],
  status: Message['status'] = 'delivered',
): Message {
  return {
    id,
    from,
    to,
    label: `${type} [stream ${String(stream)}] ${label}`,
    status,
    fields: [
      { name: 'Frame', value: type },
      { name: 'Stream ID', value: String(stream), highlight: true, description: STREAM_TEXT },
      ...fields,
    ],
  }
}

function dataFrame(
  resource: Resource,
  part: number,
  status: Message['status'] = 'delivered',
  retransmitOf?: string,
): Message {
  const parts = chunks(resource.size)
  const length = parts[part] ?? 0
  const last = part === parts.length - 1
  const label =
    parts.length === 1
      ? resource.name
      : `${resource.name} ${String(part + 1)}/${String(parts.length)}`
  const message = frame(
    `data-${String(resource.stream)}-${String(part)}${retransmitOf === undefined ? '' : '-rtx'}`,
    SERVER,
    CLIENT,
    'DATA',
    resource.stream,
    label,
    [
      { name: 'Length', value: `${bytes(length)} bytes` },
      {
        name: 'Flags',
        value: last ? 'END_STREAM' : '-',
        highlight: last,
        ...(last
          ? {
              description: {
                en: 'The last frame of this response: the stream is closed',
                ja: 'この応答の最後のフレーム。ストリームは閉じる',
              },
            }
          : {}),
      },
    ],
    status,
  )
  return retransmitOf === undefined ? message : { ...message, retransmitOf }
}

function http2Steps(loss: boolean): Step[] {
  const [css, js, jpg] = RESOURCES
  if (css === undefined || js === undefined || jpg === undefined) {
    return []
  }
  const table = (progress: readonly (readonly [string, number])[]) =>
    requestTable((resource) => String(resource.stream), progress)
  const round1 = Math.min(MAX_FRAME, js.size)
  const round1Jpg = Math.min(MAX_FRAME, jpg.size)

  const steps: Step[] = [
    {
      id: 'h2-preface',
      title: { en: 'The browser starts HTTP/2', ja: 'ブラウザーが HTTP/2 を始める' },
      description: {
        en: 'The TCP connection and TLS are already set up, and in the TLS handshake both sides chose "h2" with ALPN. The browser sends the fixed connection preface and its SETTINGS frame. From now on, everything on this connection is binary frames.',
        ja: 'TCP の接続と TLS はすでにできていて、TLS のハンドシェイクで ALPN により "h2" を選んだ。ブラウザーは決まった序文と SETTINGS フレームを送る。ここからこの接続を流れるのは、すべてバイナリのフレーム。',
      },
      events: [
        send({
          id: 'preface',
          from: CLIENT,
          to: SERVER,
          label: 'Preface + SETTINGS',
          status: 'delivered',
          fields: [
            {
              name: 'Preface',
              value: 'PRI * HTTP/2.0\\r\\n\\r\\nSM\\r\\n\\r\\n',
              description: {
                en: 'A fixed 24-byte string that confirms both sides speak HTTP/2',
                ja: '両者が HTTP/2 を話すことを確かめる、決まった 24 バイトの文字列',
              },
            },
            { name: 'Frame', value: 'SETTINGS' },
            { name: 'SETTINGS', value: 'ENABLE_PUSH = 0' },
          ],
        }),
        set(CLIENT, PROTOCOL, 'h2 (ALPN)'),
      ],
    },
    {
      id: 'h2-server-settings',
      title: { en: 'The server sends its SETTINGS', ja: 'サーバーが SETTINGS を送る' },
      description: {
        en: 'The server announces its own limits, such as how many streams may be open at once. The browser does not have to wait for this before sending requests. (Both sides also acknowledge each other’s SETTINGS; that is left out.)',
        ja: 'サーバーは、同時に開けるストリームの数など、自分の上限を伝える。ブラウザーはこれを待たずに要求を送ってよい（お互いの SETTINGS への確認応答は省いた）。',
      },
      events: [
        send({
          id: 'server-settings',
          from: SERVER,
          to: CLIENT,
          label: 'SETTINGS',
          status: 'delivered',
          fields: [
            { name: 'Frame', value: 'SETTINGS' },
            { name: 'SETTINGS', value: 'MAX_CONCURRENT_STREAMS = 100' },
          ],
        }),
      ],
    },
    {
      id: 'h2-requests',
      title: {
        en: 'Three requests at once, on three streams',
        ja: '3 つの要求を、3 つのストリームで同時に送る',
      },
      description: {
        en: 'The browser sends a HEADERS frame for each file without waiting for any answer: streams 1, 3 and 5. The headers are compressed with HPACK. Common ones like :method GET are numbers in a static table, and :authority is added to a dynamic table the first time so that later requests send only its number.',
        ja: 'ブラウザーは答えを待たずに、ファイルごとに HEADERS フレームを送る。ストリームは 1、3、5。ヘッダーは HPACK で圧縮する。:method GET のようなよく使うものは静的テーブルの番号になり、:authority は最初に動的テーブルに入れて、次からは番号だけを送る。',
      },
      events: [
        ...RESOURCES.map((resource, i) =>
          send(
            frame(
              `headers-${String(resource.stream)}`,
              CLIENT,
              SERVER,
              'HEADERS',
              resource.stream,
              `GET ${resource.path}`,
              [
                { name: 'Flags', value: 'END_HEADERS | END_STREAM' },
                { name: ':method', value: 'GET (static index 2)' },
                { name: ':scheme', value: 'https (static index 7)' },
                {
                  name: ':authority',
                  value:
                    i === 0
                      ? 'www.example.com (added to the dynamic table as 62)'
                      : 'dynamic index 62',
                  highlight: true,
                  description:
                    i === 0
                      ? {
                          en: 'Sent in full once and remembered by both sides',
                          ja: '一度だけ全部送り、両者が覚えておく',
                        }
                      : {
                          en: 'Only the number of the remembered entry is sent',
                          ja: '覚えている項目の番号だけを送る',
                        },
                },
                { name: ':path', value: resource.path },
              ],
            ),
          ),
        ),
        set(CLIENT, REQUESTS, table(RESOURCES.map(() => ['half-closed (local)', 0] as const))),
        set(SERVER, HPACK, '62: :authority www.example.com'),
      ],
    },
    {
      id: 'h2-response-headers',
      title: { en: 'The server answers on each stream', ja: 'サーバーがストリームごとに答える' },
      description: {
        en: 'Each response starts with its own HEADERS frame on the same stream as the request. :status 200 is number 8 in the static table.',
        ja: 'それぞれの応答は、要求と同じストリームの HEADERS フレームから始まる。:status 200 は静的テーブルの 8 番。',
      },
      events: RESOURCES.map((resource) =>
        send(
          frame(
            `response-${String(resource.stream)}`,
            SERVER,
            CLIENT,
            'HEADERS',
            resource.stream,
            ':status 200',
            [
              { name: 'Flags', value: 'END_HEADERS' },
              { name: ':status', value: '200 (static index 8)' },
              { name: 'content-type', value: resource.type },
              { name: 'content-length', value: String(resource.size) },
            ],
          ),
        ),
      ),
    },
    {
      id: 'h2-data-1',
      title: {
        en: 'Frames of different streams are interleaved',
        ja: 'ストリームの違うフレームが混ざって届く',
      },
      description: loss
        ? {
            en: 'The server sends a frame of each file in turn. style.css arrives complete, but the segment carrying the first frame of app.js is lost. The frame of hero.jpg behind it does arrive, yet TCP must hand data to HTTP/2 in order, so it waits in the receive buffer: stream 5 cannot move either.',
            ja: 'サーバーはファイルのフレームを順に送る。style.css は全部届くが、app.js の最初のフレームを運ぶセグメントが失われる。その後ろの hero.jpg のフレームは届いているのに、TCP はデータを順番どおりにしか HTTP/2 に渡せないので、受信バッファーで待つ。ストリーム 5 も進めない。',
          }
        : {
            en: 'The server sends a frame of each file in turn on the same connection. style.css is small and arrives complete right away; app.js and hero.jpg each get their first 16,384-byte frame. No response has to wait for another to finish.',
            ja: 'サーバーは同じ接続で、ファイルのフレームを順に送る。style.css は小さいのですぐに全部届き、app.js と hero.jpg はそれぞれ最初の 16,384 バイトのフレームが届く。どの応答も、ほかの応答が終わるのを待たない。',
          },
      events: [
        send(dataFrame(css, 0)),
        send(dataFrame(js, 0, loss ? 'lost' : 'delivered')),
        send(dataFrame(jpg, 0)),
        set(
          CLIENT,
          REQUESTS,
          table(
            loss
              ? [
                  ['closed', css.size],
                  ['half-closed (local)', 0],
                  ['half-closed (local)', 0],
                ]
              : [
                  ['closed', css.size],
                  ['half-closed (local)', round1],
                  ['half-closed (local)', round1Jpg],
                ],
          ),
        ),
        ...(loss ? [set(CLIENT, TCP, 'waiting: 1 segment missing, later data held')] : []),
      ],
    },
  ]

  if (loss) {
    steps.push({
      id: 'h2-retransmit',
      title: {
        en: 'The lost data is resent, and every stream moves again',
        ja: '失われたデータが再送され、すべてのストリームがまた進む',
      },
      description: {
        en: `${RTO_TEXT.en} Now TCP has everything in order and hands both frames to HTTP/2 at once. One lost packet stalled streams 3 and 5 together: this is TCP head-of-line blocking, which QUIC removes.`,
        ja: `${RTO_TEXT.ja}これで TCP は順番どおりにそろい、2 つのフレームをまとめて HTTP/2 に渡す。1 つのパケットのロスで、ストリーム 3 と 5 が一緒に止まった。これが TCP のヘッドオブラインブロッキングで、QUIC はこれをなくす。`,
      },
      events: [
        { kind: 'timer', actorId: SERVER, name: 'RTO', durationMs: RTO_MS },
        send(dataFrame(js, 0, 'delivered', `data-${String(js.stream)}-0`)),
        set(CLIENT, TCP, 'in order'),
        set(
          CLIENT,
          REQUESTS,
          table([
            ['closed', css.size],
            ['half-closed (local)', round1],
            ['half-closed (local)', round1Jpg],
          ]),
        ),
      ],
    })
  }

  steps.push(
    {
      id: 'h2-data-2',
      title: { en: 'hero.jpg finishes', ja: 'hero.jpg が届き終わる' },
      description: {
        en: 'The second frame of app.js and the last frame of hero.jpg arrive. hero.jpg’s frame has END_STREAM, so stream 5 is closed.',
        ja: 'app.js の 2 つ目のフレームと、hero.jpg の最後のフレームが届く。hero.jpg のフレームには END_STREAM が付いているので、ストリーム 5 は閉じる。',
      },
      events: [
        send(dataFrame(js, 1)),
        send(dataFrame(jpg, 1)),
        set(
          CLIENT,
          REQUESTS,
          table([
            ['closed', css.size],
            ['half-closed (local)', round1 * 2],
            ['closed', jpg.size],
          ]),
        ),
      ],
    },
    {
      id: 'h2-data-3',
      title: { en: 'app.js finishes', ja: 'app.js が届き終わる' },
      description: {
        en: 'The last frame of app.js arrives and all three streams are closed. Everything came over one connection, and the small file did not wait behind the big ones.',
        ja: 'app.js の最後のフレームが届き、3 つのストリームがすべて閉じる。すべてが 1 つの接続で届き、小さなファイルは大きなファイルの後ろで待たなかった。',
      },
      events: [
        send(dataFrame(js, 2)),
        set(
          CLIENT,
          REQUESTS,
          table(RESOURCES.map((resource) => ['closed', resource.size] as const)),
        ),
      ],
    },
  )
  return steps
}

// ---------- HTTP/1.1 ----------

function http1Response(
  resource: Resource,
  part: number,
  status: Message['status'] = 'delivered',
  retransmitOf?: string,
): Message {
  const parts = chunks(resource.size)
  const label =
    parts.length === 1
      ? `200 OK (${resource.name})`
      : `200 OK (${resource.name} ${String(part + 1)}/${String(parts.length)})`
  const fields: PacketField[] =
    part === 0
      ? [
          { name: 'Status line', value: 'HTTP/1.1 200 OK' },
          { name: 'Content-Type', value: resource.type },
          { name: 'Content-Length', value: String(resource.size) },
          { name: 'Body', value: `${bytes(parts[0] ?? 0)} bytes` },
        ]
      : [{ name: 'Body (continued)', value: `${bytes(parts[part] ?? 0)} bytes` }]
  const message: Message = {
    id: `h1-response-${resource.name}-${String(part)}${retransmitOf === undefined ? '' : '-rtx'}`,
    from: SERVER,
    to: CLIENT,
    label,
    status,
    fields,
  }
  return retransmitOf === undefined ? message : { ...message, retransmitOf }
}

function http1Steps(loss: boolean): Step[] {
  const table = (progress: readonly (readonly [string, number])[]) =>
    requestTable((_, i) => String(i + 1), progress)
  const steps: Step[] = []
  const progress: [string, number][] = RESOURCES.map(() => ['waiting', 0])

  RESOURCES.forEach((resource, i) => {
    progress[i] = ['in flight', 0]
    steps.push({
      id: `h1-request-${resource.name}`,
      title: {
        en: `The browser requests ${resource.name}`,
        ja: `ブラウザーが ${resource.name} を要求する`,
      },
      description:
        i === 0
          ? {
              en: 'On an HTTP/1.1 connection, the browser sends one request and waits for the whole response before sending the next. (Pipelining would allow more, but browsers do not use it.) Every request repeats all its headers in full text.',
              ja: 'HTTP/1.1 の接続では、ブラウザーは要求を 1 つ送り、その応答が全部届くまで次を送らない（パイプラインを使えば送れるが、ブラウザーは使わない）。要求のたびに、すべてのヘッダーを文字のまま送る。',
            }
          : {
              en: `Only now, after the previous response is complete, can the browser send the request for ${resource.name} on this connection.`,
              ja: `前の応答が全部届いたので、ようやくこの接続で ${resource.name} の要求を送れる。`,
            },
      events: [
        send({
          id: `h1-request-${resource.name}`,
          from: CLIENT,
          to: SERVER,
          label: `GET ${resource.path}`,
          status: 'delivered',
          fields: [
            { name: 'Request line', value: `GET ${resource.path} HTTP/1.1` },
            { name: 'Host', value: 'www.example.com' },
            {
              name: 'User-Agent',
              value: 'Mozilla/5.0 (…)',
              description: {
                en: 'The same long headers are sent again with every request',
                ja: '同じ長いヘッダーを、要求のたびにまた送る',
              },
            },
            { name: 'Accept', value: '*/*' },
          ],
        }),
        ...(i === 0 ? [set(CLIENT, PROTOCOL, 'HTTP/1.1 (keep-alive)')] : []),
        set(CLIENT, REQUESTS, table(progress)),
      ],
    })

    const parts = chunks(resource.size)
    const lostHere = loss && resource.name === 'app.js'
    if (lostHere) {
      steps.push({
        id: `h1-response-${resource.name}-lost`,
        title: {
          en: 'Part of the app.js response is lost',
          ja: 'app.js の応答の一部が失われる',
        },
        description: {
          en: 'The segment carrying the start of the app.js response is lost. The rest cannot be used until it is resent, and the next request cannot be sent on this connection either.',
          ja: 'app.js の応答の最初を運ぶセグメントが失われる。再送されるまで残りは使えず、この接続では次の要求も送れない。',
        },
        events: [
          send(http1Response(resource, 0, 'lost')),
          set(CLIENT, TCP, 'waiting: 1 segment missing, later data held'),
        ],
      })
      steps.push({
        id: `h1-retransmit`,
        title: { en: 'The lost data is resent', ja: '失われたデータが再送される' },
        description: {
          en: `${RTO_TEXT.en} Browsers open up to about six connections per server to work around this waiting, but each of them still carries one response at a time.`,
          ja: `${RTO_TEXT.ja}この待ちを避けるため、ブラウザーは 1 つのサーバーに 6 本ほどの接続を開くが、それぞれの接続で運べる応答は 1 つずつ。`,
        },
        events: [
          { kind: 'timer', actorId: SERVER, name: 'RTO', durationMs: RTO_MS },
          send(http1Response(resource, 0, 'delivered', `h1-response-${resource.name}-0`)),
          set(CLIENT, TCP, 'in order'),
        ],
      })
    }
    progress[i] = ['done', resource.size]
    steps.push({
      id: `h1-response-${resource.name}`,
      title: {
        en: `The response for ${resource.name} arrives`,
        ja: `${resource.name} の応答が届く`,
      },
      description:
        parts.length === 1
          ? {
              en: `${resource.name} fits in one piece. Only now is the connection free for the next request.`,
              ja: `${resource.name} は 1 回で届く。ここでようやく、接続が次の要求に使えるようになる。`,
            }
          : {
              en: `${resource.name} (${bytes(resource.size)} bytes) arrives in ${String(parts.length)} pieces. Until the last one arrives, the connection is busy with this response alone.`,
              ja: `${resource.name}（${bytes(resource.size)} バイト）は ${String(parts.length)} 回に分かれて届く。最後が届くまで、接続はこの応答だけで埋まっている。`,
            },
      events: [
        ...parts.flatMap((_, part) =>
          lostHere && part === 0 ? [] : [send(http1Response(resource, part))],
        ),
        set(CLIENT, REQUESTS, table(progress)),
      ],
    })
  })
  return steps
}

function buildSteps(options: Http2Options): readonly Step[] {
  return options.version === 'http2' ? http2Steps(options.loss) : http1Steps(options.loss)
}

export const http2Scenario: Scenario<Http2Options> = {
  id: 'http2',
  title: {
    en: 'HTTP/1.1 vs HTTP/2: many requests on one connection',
    ja: 'HTTP/1.1 と HTTP/2: 1 つの接続でたくさんの要求',
  },
  actors,
  optionDefs: {
    version: {
      kind: 'select',
      label: { en: 'HTTP version', ja: 'HTTP のバージョン' },
      choices: [
        { value: 'http2', label: { en: 'HTTP/2', ja: 'HTTP/2' } },
        { value: 'http1', label: { en: 'HTTP/1.1', ja: 'HTTP/1.1' } },
      ],
      defaultValue: 'http2',
    },
    loss: {
      kind: 'toggle',
      label: {
        en: 'A packet of app.js is lost',
        ja: 'app.js のパケットが 1 つ失われる',
      },
      defaultValue: false,
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
