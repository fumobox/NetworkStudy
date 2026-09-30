/**
 * リバースプロキシとロードバランサー
 *
 * 根拠:
 * - RFC 9110 §3.7（仲介者。リバースプロキシは「ゲートウェイ」で、要求を内側のサーバーに転送し、負荷分散にも使われる）、
 *   §7.2（Host）、§7.4（信頼できるゲートウェイからの接続なら、https の要求を平文で受けてよい）、
 *   §7.6.1（Connection と区間ごとのフィールドを外す）、§7.6.3（ゲートウェイは内側への要求に Via を付けなければならない）、
 *   §9.2.2（プロキシはべき等でない要求を自動で再試行してはならない。クライアントは SHOULD NOT）、§10.2.3（Retry-After）、§15.3.1 / §15.3.2（200、201）、
 *   §15.6.3〜§15.6.5（502: 内側のサーバーから正しい応答を得られない、503: 一時的に応じられない、504: 時間内に応答がない）
 * - RFC 9112 §3.2（Host）、§3.3（再構成する URI のスキームは、接続が保護されていなければ http）、§9.2（応答は要求の順に対応づく）、
 *   §9.3（持続的な接続が既定）
 * - RFC 9113 §8.2（フィールド名は小文字）、§8.2.2（接続に固有のフィールドを HTTP/2 に入れない）、
 *   §8.3.1（:authority から Host を作る。HTTP/2 の版は "2.0"）
 * - RFC 7239 §4〜§7（Forwarded。IPv6 やポート付きの値は引用符で囲む）、§5.2・§8.3（既定では難読化した識別子を使うべきだが、
 *   アドレスが必要なら IP アドレスを送ってよい）、§8.1（値は偽れる）。§1 は X-Forwarded-For / -Proto を標準でないと書く
 * - RFC 9209 §2（Proxy-Status）、§2.3.4（destination_unavailable → 503）、§2.3.8（connection_terminated → 502）、
 *   §2.3.26（http_response_timeout → 504）
 * - RFC 9111 §3、§3.5、§4.2.1、§5.1、§5.2.2.7、§5.2.2.10（共有キャッシュ、Authorization、s-maxage、Age、private）
 * - RFC 9211 §2（Cache-Status: hit、fwd=uri-miss、ttl、stored）、RFC 9651（Structured Field の Token と String）
 * - RFC 6265 §4.1（Set-Cookie の Path・Secure・HttpOnly）、RFC 9846（TLS 1.3。RFC 8446 を置き換えた）、RFC 7301（ALPN）、RFC 6066 §3（SNI）
 * - RFC 9293 §3.5（3 ウェイハンドシェイク）、§3.10.7.1（待ち受けのないポートへの SYN には RST, ACK）、RFC 1122 §4.2.2.13（閉じたあとに届いたデータには RST）
 * - RFC 5737（説明用のアドレス）、RFC 2606（example.com）
 * - HAProxy Technologies, "The PROXY protocol Versions 1 & 2"（2020/03/05 版）§2.1（RFC ではない）
 * - 標準でないもの: バックエンドの選び方、ヘルスチェック、スティッキーセッションの Cookie、プロキシの待ち時間と再試行の方針は
 *   製品の設定で決まる。本文では「例えば nginx や HAProxy では」と書き、数値は例の値とする
 *
 * 学習用の単純化: ブラウザーは 1 台、バックエンドは同じ重みの 2 台で、ラウンドロビンで選ぶ。ヘルスチェックは 5 秒ごと、
 * 続けて 2 回失敗したら外す（例の値。受動的な失敗と能動的な失敗を同じ回数で数えるが、製品によって数え方は違う）。Forwarded と X-Forwarded-For にはクライアントの IP アドレスをそのまま入れる。
 * ブラウザーは Forwarded も X-Forwarded-For も送らない。Host は :authority のまま渡す（製品によっては既定で書き換える）。
 * Via は両方向に付ける。TCP のハンドシェイクと ACK、HPACK、SETTINGS は L4 の場合を除いて描かず、TLS のハンドシェイクは
 * 3 つにまとめる。Date は省き、Age はプロキシのキャッシュにあった時間だけとする。本文は「…」で縮めて示し、Content-Length は示した本文のバイト数とする。ブラウザー自身のキャッシュは描かない。
 * バックエンドにも説明用のアドレスを使う（実際はプライベートアドレスのことが多い）。PROXY protocol は文字列の版 1 で示す
 */
import { z } from 'zod'
import type {
  Actor,
  ActorId,
  Message,
  MessageId,
  MessageStatus,
  PacketField,
  Scenario,
  StateKey,
  StateTable,
  Step,
  StepEvent,
} from '@/engine/types'
import type { LocalizedText } from '@/lib/i18n/locale'
import {
  ERROR_STATUS,
  nextHealth,
  pickRoundRobin,
  pickSticky,
  type HealthState,
  type PoolEntry,
  type ProxyError,
} from './balancer'
import {
  appendForwarded,
  appendXForwardedFor,
  formatCacheStatus,
  formatProxyStatus,
  forwardedNode,
  stripHopByHop,
  viaMember,
  type HeaderField,
} from './headers'
import { proxyV1Line } from './proxyProtocol'
import { freshnessLifetime, mayStore, parseCacheControl, remainingTtl } from './sharedCache'

const SITUATIONS = ['normal', 'backendDown', 'slowBackend', 'sticky', 'l4', 'sharedCache'] as const

const optionsSchema = z.object({
  situation: z.enum(SITUATIONS).catch('normal'),
})
export type ReverseProxyOptions = z.infer<typeof optionsSchema>

const BROWSER: ActorId = 'browser'
const PROXY: ActorId = 'proxy'
const BACKEND_A = 'backendA'
const BACKEND_B = 'backendB'
type BackendId = typeof BACKEND_A | typeof BACKEND_B

const CONNECTION: StateKey = 'connection'
const RESPONSE: StateKey = 'response'
const COOKIE: StateKey = 'cookie'
const TLS: StateKey = 'tls'
const POOL: StateKey = 'pool'
const ROTATION: StateKey = 'rotation'
const UPSTREAM: StateKey = 'upstream'
const CACHE: StateKey = 'cache'
const PROCESS: StateKey = 'process'
const SEEN: StateKey = 'seen'
const HANDLED: StateKey = 'handled'
export const POOL_COLUMNS = ['Backend', 'Address', 'Health', 'Fails'] as const
export const UPSTREAM_COLUMNS = ['Conn', 'Backend', 'Requests', 'State'] as const
export const CACHE_COLUMNS = ['URL', 'Cache-Control', 'Age', 'Status'] as const
export const SEEN_COLUMNS = ['Field', 'Value'] as const

/** 説明用のアドレス（RFC 5737）と名前（RFC 2606） */
export const ADDR = {
  browser: '203.0.113.50',
  browserPort: 51514,
  proxy: '192.0.2.10',
  proxyInside: '198.51.100.1',
  site: 'www.example.com',
} as const
export const BACKENDS = {
  backendA: { letter: 'A', ip: '198.51.100.11', port: 8080, localPort: 40001 },
  backendB: { letter: 'B', ip: '198.51.100.12', port: 8080, localPort: 40002 },
} as const
/** L4 のときにバックエンドが TLS を待ち受けるポート */
const TLS_PORT = 443
/** Via と Proxy-Status・Cache-Status でのプロキシの名前 */
export const PROXY_NAME = 'proxy1'
export const HEALTH_INTERVAL_MS = 5_000
export const THRESHOLDS = { rise: 2, fall: 2 } as const
export const RESPONSE_TIMEOUT_MS = 30_000
/** 遅いバックエンドの処理時間 */
export const SLOW_PROCESSING_S = 45
export const REVISIT_MS = 20_000
export const ITEMS_CACHE_CONTROL = 'max-age=0, s-maxage=60'
export const ME_CACHE_CONTROL = 'private, max-age=60'

const backendAddress = (id: BackendId) => `${BACKENDS[id].ip}:${String(BACKENDS[id].port)}`

/** プロキシがバックエンドへの要求に付ける Forwarded と X-Forwarded-* */
export const FORWARDED = appendForwarded(null, {
  for: forwardedNode(ADDR.browser),
  proto: 'https',
  host: ADDR.site,
})
export const X_FORWARDED_FOR = appendXForwardedFor(null, ADDR.browser)
/** 内側への要求は HTTP/2 で受けたので 2.0、外側への応答は HTTP/1.1 で受けたので 1.1（RFC 9113 §8.3.1、RFC 9110 §7.6.3） */
export const VIA_INBOUND = viaMember('2.0', PROXY_NAME)
export const VIA_OUTBOUND = viaMember('1.1', PROXY_NAME)
export const PROXY_V1 = proxyV1Line({
  family: 'TCP4',
  source: ADDR.browser,
  destination: ADDR.proxy,
  sourcePort: ADDR.browserPort,
  destinationPort: 443,
})

const actors: readonly Actor[] = [
  {
    id: BROWSER,
    kind: 'client',
    name: { en: `Browser (${ADDR.browser})`, ja: `ブラウザー（${ADDR.browser}）` },
    shortName: { en: 'Browser', ja: 'ブラウザー' },
    stateSlots: [
      {
        key: CONNECTION,
        label: { en: 'Connection to the site', ja: 'サイトへの接続' },
        initial: '-',
      },
      { key: RESPONSE, label: { en: 'Last response', ja: '最後の応答' }, initial: '-' },
      { key: COOKIE, label: { en: 'Cookies', ja: 'Cookie' }, initial: '-' },
    ],
  },
  {
    id: PROXY,
    // 転送する中継の機器なので、ファイアウォールのテーマと同じくルーターの色で描く。バックエンド（server）と見分けられる
    kind: 'router',
    name: { en: `Reverse proxy / LB (${ADDR.proxy})`, ja: `リバースプロキシ／LB（${ADDR.proxy}）` },
    shortName: { en: 'Proxy / LB', ja: 'プロキシ／LB' },
    stateSlots: [
      { key: TLS, label: { en: 'Browser-side TLS', ja: 'ブラウザー側の TLS' }, initial: '-' },
      {
        key: POOL,
        label: { en: 'Backend pool', ja: 'バックエンドの一覧' },
        initial: {
          columns: POOL_COLUMNS,
          rows: [
            ['A', backendAddress(BACKEND_A), 'unknown', '0'],
            ['B', backendAddress(BACKEND_B), 'unknown', '0'],
          ],
        },
      },
      {
        key: ROTATION,
        label: { en: 'Next in rotation', ja: '次に選ぶバックエンド' },
        initial: 'A',
      },
      {
        key: UPSTREAM,
        label: { en: 'Connections to backends', ja: 'バックエンドへの接続' },
        initial: { columns: UPSTREAM_COLUMNS, rows: [] },
      },
      {
        key: CACHE,
        label: { en: 'Shared cache', ja: '共有キャッシュ' },
        initial: { columns: CACHE_COLUMNS, rows: [] },
      },
    ],
  },
  ...([BACKEND_A, BACKEND_B] as const).map((id): Actor => ({
    id,
    kind: 'server',
    name: {
      en: `Backend ${BACKENDS[id].letter} (${BACKENDS[id].ip})`,
      ja: `バックエンド ${BACKENDS[id].letter}（${BACKENDS[id].ip}）`,
    },
    shortName: {
      en: `Backend ${BACKENDS[id].letter}`,
      ja: `バックエンド ${BACKENDS[id].letter}`,
    },
    stateSlots: [
      { key: PROCESS, label: { en: 'App process', ja: 'アプリのプロセス' }, initial: 'running' },
      {
        key: SEEN,
        label: { en: 'What the app sees', ja: 'アプリから見える値' },
        initial: { columns: SEEN_COLUMNS, rows: [] },
      },
      { key: HANDLED, label: { en: 'Requests handled', ja: '処理した要求' }, initial: '0' },
    ],
  })),
]

const set = (actorId: ActorId, key: StateKey, value: string | StateTable): StepEvent => ({
  kind: 'stateChange',
  actorId,
  key,
  value,
})
const send = (message: Message): StepEvent => ({ kind: 'message', message })
const timer = (actorId: ActorId, name: string, durationMs: number): StepEvent => ({
  kind: 'timer',
  actorId,
  name,
  durationMs,
})

const FIELD_TEXT = {
  host: {
    en: 'Made from :authority (RFC 9113 §8.3.1), so the backend knows which site was asked for',
    ja: ':authority から作る（RFC 9113 §8.3.1）。バックエンドは、どのサイトへの要求かがわかる',
  },
  forwarded: {
    en: 'The standard header (RFC 7239): who asked (for), with which scheme (proto) and for which host',
    ja: '標準のヘッダー（RFC 7239）。誰が（for）、どのスキームで（proto）、どのホストに求めたか',
  },
  xff: {
    en: 'Not a standard, but widely used. Trust only the entries your own proxies added: a client can write anything to the left',
    ja: '標準ではないが広く使われる。信じてよいのは自分のプロキシが足した値だけ。左側にはクライアントが何でも書ける',
  },
  xfp: {
    en: 'The backend receives plain http, so this tells it that the browser used https',
    ja: 'バックエンドは平文の http で受けるので、ブラウザーが https を使ったことをこれで伝える',
  },
  viaIn: {
    en: 'A gateway must add Via to requests it forwards (RFC 9110 §7.6.3). 2.0: the request arrived over HTTP/2',
    ja: 'ゲートウェイは転送する要求に Via を付けなければならない（RFC 9110 §7.6.3）。2.0 は HTTP/2 で受けたという意味',
  },
  viaOut: {
    en: '1.1: the response arrived from the backend over HTTP/1.1',
    ja: '1.1 は、応答をバックエンドから HTTP/1.1 で受けたという意味',
  },
  removed: {
    en: 'Not a header: hop-by-hop fields the proxy removed (RFC 9110 §7.6.1). HTTP/2 does not allow them (except TE: trailers)',
    ja: 'ヘッダーではない。プロキシが外した区間ごとのフィールド（RFC 9110 §7.6.1）。HTTP/2 では、TE: trailers を除いて使えない',
  },
  healthz: {
    en: 'The path, interval and thresholds of health checks are product settings, not part of HTTP',
    ja: 'ヘルスチェックのパス、間隔、しきい値は製品の設定で、HTTP の一部ではない',
  },
  frames: {
    en: 'HTTP/2 frames that carry this message, inside the TLS connection',
    ja: 'このメッセージを運ぶ HTTP/2 のフレーム。TLS の接続の中を通る',
  },
  proxyStatus: {
    en: 'Which proxy produced this error and why (RFC 9209). Only intermediaries send it',
    ja: 'どのプロキシが、なぜこのエラーを返したか（RFC 9209）。送るのは仲介者だけ',
  },
  cacheStatus: {
    en: 'How the proxy’s cache handled this response (RFC 9211)',
    ja: 'プロキシのキャッシュがこの応答をどう扱ったか（RFC 9211）',
  },
  private: {
    en: 'private: only the browser’s own cache may store this response (RFC 9111 §5.2.2.7)',
    ja: 'private: この応答を保存してよいのはブラウザー自身のキャッシュだけ（RFC 9111 §5.2.2.7）',
  },
  contentLength: {
    en: 'The size of the body in bytes. On a persistent HTTP/1.1 connection, this is how the receiver knows where the message ends (RFC 9112 §6.3)',
    ja: '本文のバイト数。持続する HTTP/1.1 の接続では、受け手はこれでメッセージの終わりを知る（RFC 9112 §6.3）',
  },
  sMaxage: {
    en: 's-maxage applies only to shared caches such as this proxy; the browser’s own cache uses max-age=0',
    ja: 's-maxage はこのプロキシのような共有キャッシュにだけ効く。ブラウザー自身のキャッシュは max-age=0 を使う',
  },
} satisfies Record<string, LocalizedText>

// ---------- メッセージの形 ----------

interface Exchange {
  readonly method: 'GET' | 'POST'
  readonly path: string
  readonly stream: number
  readonly body?: string
  readonly cookie?: string
  readonly authorization?: boolean
}

const GET_ITEMS = (stream: number): Exchange => ({ method: 'GET', path: '/api/items', stream })
const POST_ORDER: Exchange = {
  method: 'POST',
  path: '/api/orders',
  stream: 3,
  body: '{"item":42}',
}
const ORDER_LOCATION = '/api/orders/1001'
const byteLength = (body: string) => String(new TextEncoder().encode(body).length)

function h2Request(id: MessageId, exchange: Exchange): Message {
  return {
    id,
    from: BROWSER,
    to: PROXY,
    label: `${exchange.method} ${exchange.path} [h2 stream ${String(exchange.stream)}]`,
    status: 'delivered',
    encrypted: true,
    fields: [
      {
        name: 'Frames',
        value: exchange.body === undefined ? 'HEADERS' : 'HEADERS, DATA',
        description: FIELD_TEXT.frames,
      },
      { name: ':method', value: exchange.method },
      { name: ':scheme', value: 'https' },
      { name: ':authority', value: ADDR.site, highlight: true },
      { name: ':path', value: exchange.path },
      ...(exchange.cookie === undefined
        ? []
        : [{ name: 'cookie', value: exchange.cookie, highlight: true } satisfies PacketField]),
      ...(exchange.authorization === true
        ? [{ name: 'authorization', value: 'Bearer …', highlight: true } satisfies PacketField]
        : []),
      ...(exchange.body === undefined
        ? []
        : [
            { name: 'content-type', value: 'application/json' } satisfies PacketField,
            { name: 'Body', value: exchange.body } satisfies PacketField,
          ]),
    ],
  }
}

/** プロキシがバックエンドに転送する HTTP/1.1 の要求 */
function h1Forward(id: MessageId, to: BackendId, exchange: Exchange): Message {
  return {
    id,
    from: PROXY,
    to,
    label: `${exchange.method} ${exchange.path} HTTP/1.1`,
    status: 'delivered',
    fields: [
      { name: 'Request line', value: `${exchange.method} ${exchange.path} HTTP/1.1` },
      { name: 'Host', value: ADDR.site, description: FIELD_TEXT.host },
      { name: 'Forwarded', value: FORWARDED, highlight: true, description: FIELD_TEXT.forwarded },
      { name: 'X-Forwarded-For', value: X_FORWARDED_FOR, description: FIELD_TEXT.xff },
      { name: 'X-Forwarded-Proto', value: 'https', description: FIELD_TEXT.xfp },
      { name: 'Via', value: VIA_INBOUND, description: FIELD_TEXT.viaIn },
      ...(exchange.authorization === true
        ? [{ name: 'Authorization', value: 'Bearer …' } satisfies PacketField]
        : []),
      ...(exchange.body === undefined
        ? []
        : [
            { name: 'Content-Type', value: 'application/json' } satisfies PacketField,
            {
              name: 'Content-Length',
              value: byteLength(exchange.body),
              description: FIELD_TEXT.contentLength,
            } satisfies PacketField,
            { name: 'Body', value: exchange.body } satisfies PacketField,
          ]),
    ],
  }
}

interface BackendResponse {
  readonly status: '200 OK' | '201 Created'
  readonly body: string
  readonly cacheControl?: string
  /** Cache-Control のフィールドの説明 */
  readonly cacheControlNote?: LocalizedText
  readonly location?: string
}

/** バックエンドが返すヘッダー（区間ごとの Connection と Keep-Alive を含む） */
function responseHeaders(response: BackendResponse): HeaderField[] {
  return [
    { name: 'Content-Type', value: 'application/json' },
    { name: 'Content-Length', value: byteLength(response.body) },
    ...(response.location === undefined ? [] : [{ name: 'Location', value: response.location }]),
    ...(response.cacheControl === undefined
      ? []
      : [{ name: 'Cache-Control', value: response.cacheControl }]),
    { name: 'Connection', value: 'keep-alive' },
    { name: 'Keep-Alive', value: 'timeout=5' },
  ]
}

function h1Response(
  id: MessageId,
  from: BackendId,
  response: BackendResponse,
  options: { readonly label?: string; readonly status?: MessageStatus } = {},
): Message {
  return {
    id,
    from,
    to: PROXY,
    label: options.label ?? response.status,
    status: options.status ?? 'delivered',
    fields: [
      { name: 'Status line', value: `HTTP/1.1 ${response.status}` },
      ...responseHeaders(response).map((field) =>
        field.name === 'Cache-Control' && response.cacheControlNote !== undefined
          ? { ...field, highlight: true, description: response.cacheControlNote }
          : field,
      ),
      { name: 'Body', value: response.body },
    ],
  }
}

/** プロキシがブラウザーに返す HTTP/2 の応答。バックエンドのヘッダーから区間ごとのものを外す */
function h2Relay(
  id: MessageId,
  stream: number,
  response: BackendResponse,
  extra: readonly PacketField[] = [],
  options: { readonly fromCache?: boolean } = {},
): Message {
  const { forwarded, removed } = stripHopByHop(responseHeaders(response))
  return {
    id,
    from: PROXY,
    to: BROWSER,
    label: `${response.status} [h2 stream ${String(stream)}]`,
    status: 'delivered',
    encrypted: true,
    fields: [
      { name: 'Frames', value: 'HEADERS, DATA', description: FIELD_TEXT.frames },
      { name: ':status', value: response.status.slice(0, 3) },
      // HTTP/2 のフィールド名は小文字（RFC 9113 §8.2）
      ...forwarded.map((field) => ({ name: field.name.toLowerCase(), value: field.value })),
      { name: 'via', value: VIA_OUTBOUND, description: FIELD_TEXT.viaOut },
      ...extra,
      // キャッシュから返すときは、保存するときに外してある（RFC 9111 §3.1）ので、この交換では何も外さない
      ...(options.fromCache === true
        ? []
        : [{ name: 'Removed', value: removed.join(', '), description: FIELD_TEXT.removed }]),
      { name: 'Body', value: response.body },
    ],
  }
}

const REASON_PHRASES = {
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
} as const

/** Proxy-Status の error から、RFC 9209 が推奨する状態コードの状態行（例: 502 Bad Gateway）を作る */
export function errorStatus(error: ProxyError): string {
  const code = ERROR_STATUS[error]
  return `${String(code)} ${REASON_PHRASES[code]}`
}

/** プロキシが自分で作るエラーの応答（バックエンドの応答ではないので Cache-Status は付けない） */
function h2Error(id: MessageId, stream: number, error: ProxyError, nextHop?: string): Message {
  const status = errorStatus(error)
  const proxyStatus = formatProxyStatus(PROXY_NAME, error, nextHop)
  return {
    id,
    from: PROXY,
    to: BROWSER,
    label: `${status} [h2 stream ${String(stream)}]`,
    status: 'delivered',
    encrypted: true,
    fields: [
      { name: 'Frames', value: 'HEADERS, DATA', description: FIELD_TEXT.frames },
      { name: ':status', value: status.slice(0, 3), highlight: true },
      {
        name: 'proxy-status',
        value: proxyStatus,
        highlight: true,
        description: FIELD_TEXT.proxyStatus,
      },
      { name: 'content-type', value: 'text/html' },
    ],
  }
}

const ITEMS = (letter: string): BackendResponse => ({
  status: '200 OK',
  body: `{"items":[…],"served_by":"${letter}"}`,
})
const CREATED = (letter: string): BackendResponse => ({
  status: '201 Created',
  body: `{"order":1001,"served_by":"${letter}"}`,
  location: ORDER_LOCATION,
})

function healthCheck(id: MessageId, to: BackendId): Message {
  return {
    id,
    from: PROXY,
    to,
    label: 'GET /healthz HTTP/1.1',
    status: 'delivered',
    fields: [
      { name: 'Request line', value: 'GET /healthz HTTP/1.1', description: FIELD_TEXT.healthz },
      { name: 'Host', value: backendAddress(to) },
    ],
  }
}

function healthOk(id: MessageId, from: BackendId): Message {
  return {
    id,
    from,
    to: PROXY,
    label: '200 OK',
    status: 'delivered',
    fields: [
      { name: 'Status line', value: 'HTTP/1.1 200 OK' },
      { name: 'Content-Length', value: byteLength('ok') },
      { name: 'Body', value: 'ok' },
    ],
  }
}

const tcp = (
  id: MessageId,
  from: ActorId,
  to: ActorId,
  label: string,
  fields: readonly PacketField[],
  status: MessageStatus = 'delivered',
): Message => ({ id, from, to, label, status, fields })

// ---------- 状態の表 ----------

/** プロキシの状態（バックエンドの一覧、ラウンドロビンの位置、接続）を持ち、表を作る */
class ProxyModel {
  health: Record<BackendId, HealthState> = {
    backendA: { health: 'unknown', fails: 0, passes: 0 },
    backendB: { health: 'unknown', fails: 0, passes: 0 },
  }
  cursor = 0
  connections: { conn: string; backend: BackendId; requests: number; state: string }[] = []
  handled: Record<BackendId, number> = { backendA: 0, backendB: 0 }

  entries(): PoolEntry[] {
    return ([BACKEND_A, BACKEND_B] as const).map((id) => ({ id, health: this.health[id].health }))
  }

  pool(): StepEvent {
    return set(PROXY, POOL, {
      columns: POOL_COLUMNS,
      rows: ([BACKEND_A, BACKEND_B] as const).map((id) => [
        BACKENDS[id].letter,
        backendAddress(id),
        this.health[id].health,
        String(this.health[id].fails),
      ]),
    })
  }

  probe(id: BackendId, ok: boolean): StepEvent {
    this.health[id] = nextHealth(this.health[id], ok, THRESHOLDS)
    return this.pool()
  }

  /** 次に選ぶバックエンドを選び、位置を進める */
  pick(): BackendId {
    const pick = pickRoundRobin(this.entries(), this.cursor)
    if (pick === null) {
      throw new Error('no backend is up')
    }
    this.cursor = pick.cursor
    return pick.backend === BACKEND_A ? BACKEND_A : BACKEND_B
  }

  /** Cookie が指すバックエンドを、使えればそのまま選ぶ（ラウンドロビンの位置は進めない） */
  pickByCookie(pinned: BackendId): { readonly backend: BackendId; readonly byCookie: boolean } {
    const pick = pickSticky(this.entries(), pinned, this.cursor)
    if (pick === null) {
      throw new Error('no backend is up')
    }
    this.cursor = pick.cursor
    return { backend: pick.backend === BACKEND_A ? BACKEND_A : BACKEND_B, byCookie: pick.byCookie }
  }

  rotation(note?: string): StepEvent {
    const next = pickRoundRobin(this.entries(), this.cursor)
    const letter = next === null ? '-' : next.backend === BACKEND_A ? 'A' : 'B'
    return set(PROXY, ROTATION, note === undefined ? letter : `${letter} (${note})`)
  }

  /** 空いた接続があれば使い回し、なければ開く */
  use(backend: BackendId): StepEvent {
    const idle = this.connections.find((c) => c.backend === backend && c.state === 'idle')
    if (idle === undefined) {
      this.connections.push({
        conn: `#${String(this.connections.length + 1)}`,
        backend,
        requests: 1,
        state: 'in use',
      })
    } else {
      idle.requests += 1
      idle.state = 'in use'
    }
    return this.upstream()
  }

  setState(backend: BackendId, state: string): StepEvent {
    const connection = this.connections.find((c) => c.backend === backend && c.state !== 'closed')
    if (connection !== undefined) {
      connection.state = state
    }
    return this.upstream()
  }

  upstream(): StepEvent {
    return set(PROXY, UPSTREAM, {
      columns: UPSTREAM_COLUMNS,
      rows: this.connections.map((c) => [
        c.conn,
        BACKENDS[c.backend].letter,
        String(c.requests),
        c.state,
      ]),
    })
  }

  handle(backend: BackendId): StepEvent {
    this.handled[backend] += 1
    return set(backend, HANDLED, String(this.handled[backend]))
  }
}

const seenTable = (id: BackendId): StateTable => ({
  columns: SEEN_COLUMNS,
  rows: [
    ['TCP peer', `${ADDR.proxyInside}:${String(BACKENDS[id].localPort)}`],
    ['Scheme', 'http'],
    ['Host', ADDR.site],
    ['Forwarded for', ADDR.browser],
    ['Forwarded proto', 'https'],
  ],
})

const SECTIONS = {
  health: { en: 'Health checks', ja: 'ヘルスチェック' },
  tls: { en: 'TLS', ja: 'TLS' },
  request1: { en: 'Request 1', ja: '要求 1' },
  request2: { en: 'Request 2', ja: '要求 2' },
  request3: { en: 'Request 3', ja: '要求 3' },
  request4: { en: 'Request 4', ja: '要求 4' },
  tcp: { en: 'TCP connections', ja: 'TCP の接続' },
} satisfies Record<string, LocalizedText>

type StepBody = Omit<Step, 'section'>
const inSection = (section: LocalizedText, steps: readonly StepBody[]): Step[] =>
  steps.map((step) => ({ ...step, section }))

// ---------- L7（HTTP を見て転送する） ----------

/** ヘルスチェック、TLS、最初の要求をブラウザーが送るまで */
function openingPrelude(model: ProxyModel): Step[] {
  return [
    ...inSection(SECTIONS.health, [
      {
        id: 'health-check',
        title: { en: 'The proxy checks its backends', ja: 'プロキシがバックエンドを確かめる' },
        description: {
          en: `Before sending real traffic, the proxy probes each backend with a request to /healthz (an active health check). Here it does so every ${String(HEALTH_INTERVAL_MS / 1000)} seconds. How and how often to check is not part of HTTP: each product has its own settings, for example HAProxy’s “check” and “option httpchk”.`,
          ja: `本物の要求を送る前に、プロキシは各バックエンドに /healthz への要求を送って確かめる（能動的なヘルスチェック）。ここでは ${String(HEALTH_INTERVAL_MS / 1000)} 秒ごと。どう、どのくらいの間隔で確かめるかは HTTP では決まっておらず、製品ごとの設定になる（例えば HAProxy の「check」と「option httpchk」）。`,
        },
        events: [
          send(healthCheck('health-a', BACKEND_A)),
          send(healthCheck('health-b', BACKEND_B)),
        ],
      },
      {
        id: 'health-ok',
        title: { en: 'Both backends are up', ja: '両方のバックエンドが使える' },
        description: {
          en: 'Both answer 200 OK, so both are marked up and can receive requests.',
          ja: 'どちらも 200 OK で答えたので、両方を up として、要求を送れるようにする。',
        },
        events: [
          send(healthOk('health-a-ok', BACKEND_A)),
          send(healthOk('health-b-ok', BACKEND_B)),
          model.probe(BACKEND_A, true),
          model.probe(BACKEND_B, true),
        ],
      },
    ]),
    ...inSection(SECTIONS.tls, [
      {
        id: 'tls',
        title: { en: 'TLS ends at the proxy', ja: 'TLS はプロキシで終わる' },
        description: {
          en: `The browser connects to ${ADDR.site} (${ADDR.proxy}), which is the proxy. The proxy holds the certificate and private key and completes the TLS handshake itself (see the TLS theme); ALPN selects HTTP/2. The browser never talks to a backend directly and does not even know how many there are.`,
          ja: `ブラウザーは ${ADDR.site}（${ADDR.proxy}）、つまりプロキシにつなぐ。証明書と秘密鍵はプロキシにあり、TLS のハンドシェイクはプロキシが自分で行う（TLS のテーマを参照）。ALPN で HTTP/2 を選ぶ。ブラウザーはバックエンドと直接話すことはなく、何台あるかも知らない。`,
        },
        events: [
          send(
            tcp('client-hello', BROWSER, PROXY, 'ClientHello (SNI, ALPN h2)', [
              { name: 'server_name', value: ADDR.site },
              { name: 'ALPN', value: 'h2, http/1.1' },
            ]),
          ),
          send(
            tcp('server-hello', PROXY, BROWSER, 'ServerHello … Finished', [
              { name: 'ALPN', value: 'h2' },
              { name: 'Certificate', value: `${ADDR.site} (held by the proxy)`, highlight: true },
            ]),
          ),
          send({
            ...tcp('finished', BROWSER, PROXY, 'Finished', [
              { name: 'Handshake', value: 'Finished' },
            ]),
            encrypted: true,
          }),
          set(BROWSER, CONNECTION, `h2, TLS 1.3 to ${ADDR.proxy}:443`),
          set(PROXY, TLS, `terminated (cert ${ADDR.site})`),
        ],
      },
    ]),
    ...inSection(SECTIONS.request1, [
      {
        id: 'request-1',
        title: { en: 'The browser sends a request', ja: 'ブラウザーが要求を送る' },
        description: {
          en: 'The request is an HTTP/2 stream inside TLS. The site’s name is in the :authority pseudo-header; there is no Host header in HTTP/2.',
          ja: '要求は TLS の中の HTTP/2 のストリーム。サイトの名前は :authority の疑似ヘッダーにあり、HTTP/2 には Host ヘッダーがない。',
        },
        events: [send(h2Request('request-1', GET_ITEMS(1)))],
      },
    ]),
  ]
}

/**
 * openingPrelude に続けて、最初の要求をバックエンドに転送し、応答をブラウザーに返すまで。
 * sticky なら、応答にスティッキーセッションの Cookie を足す
 */
function opening(model: ProxyModel, options: { readonly sticky: boolean }): Step[] {
  const prelude = openingPrelude(model)
  const first = model.pick()
  const cookie = `SERVERID=${BACKENDS[first].letter.toLowerCase()}`
  const setCookie: PacketField[] = options.sticky
    ? [
        {
          name: 'set-cookie',
          value: `${cookie}; Path=/; Secure; HttpOnly`,
          highlight: true,
          description: {
            en: 'Added by the proxy, not the app (for example HAProxy’s “cookie SERVERID insert indirect secure httponly”)',
            ja: 'アプリではなくプロキシが足す（例えば HAProxy の「cookie SERVERID insert indirect secure httponly」）',
          },
        },
      ]
    : []
  return [
    ...prelude,
    ...inSection(SECTIONS.request1, [
      {
        id: 'forward-1',
        title: {
          en: `Round-robin picks backend ${BACKENDS[first].letter}`,
          ja: `ラウンドロビンでバックエンド ${BACKENDS[first].letter} を選ぶ`,
        },
        description: {
          en: 'The proxy decrypts the request, picks a backend in turn (round-robin; how to choose is a product setting, not HTTP) and forwards it as plain HTTP/1.1. It rewrites the request on the way: Host from :authority, Forwarded and X-Forwarded-For with the browser’s address, X-Forwarded-Proto: https, and Via. Without them, the backend would see only the proxy’s address and plain http.',
          ja: 'プロキシは要求を復号し、バックエンドを順番に選び（ラウンドロビン。選び方は HTTP ではなく製品の設定）、平文の HTTP/1.1 で転送する。途中で要求を書き換える。:authority から Host を作り、Forwarded と X-Forwarded-For にブラウザーのアドレスを、X-Forwarded-Proto に https を入れ、Via を付ける。これがなければ、バックエンドにはプロキシのアドレスと平文の http しか見えない。',
        },
        events: [
          send(h1Forward('forward-1', first, GET_ITEMS(1))),
          model.use(first),
          model.rotation(),
          set(first, SEEN, seenTable(first)),
        ],
      },
      {
        id: 'response-1',
        title: { en: 'The backend answers', ja: 'バックエンドが答える' },
        description: {
          en: 'The backend answers over the same HTTP/1.1 connection, which stays open for more requests: HTTP/1.1 connections are persistent by default, and this server also sends Connection: keep-alive.',
          ja: 'バックエンドは同じ HTTP/1.1 の接続で答える。接続は次の要求のために開いたまま。HTTP/1.1 の接続は既定で持続し、このサーバーは Connection: keep-alive も送る。',
        },
        events: [
          send(h1Response('response-1', first, ITEMS(BACKENDS[first].letter))),
          model.handle(first),
        ],
      },
      {
        id: 'relay-1',
        title: {
          en: options.sticky
            ? 'The proxy relays it and adds a cookie'
            : 'The proxy relays the response',
          ja: options.sticky ? 'プロキシが応答を中継し、Cookie を足す' : 'プロキシが応答を中継する',
        },
        description: options.sticky
          ? {
              en: `The proxy adds a cookie that names the backend (${cookie}). From now on the browser sends it with every request, and the proxy uses it to send the browser back to the same backend. This is a sticky session: not part of HTTP, but a feature of products such as HAProxy (“cookie … insert”) or NGINX Plus (“sticky cookie”).`,
              ja: `プロキシは、バックエンドを表す Cookie（${cookie}）を足す。以後ブラウザーはこれを毎回送り、プロキシはそれを見て同じバックエンドに送る。これがスティッキーセッションで、HTTP の仕組みではなく、HAProxy（「cookie … insert」）や NGINX Plus（「sticky cookie」）などの製品の機能。`,
            }
          : {
              en: 'The proxy sends the response back on the browser’s HTTP/2 stream. It removes the hop-by-hop fields Connection and Keep-Alive: they describe only the proxy’s connection to the backend, and HTTP/2 does not allow them. The connection to the backend becomes idle and can be reused.',
              ja: 'プロキシは応答を、ブラウザーの HTTP/2 のストリームで返す。区間ごとの Connection と Keep-Alive は外す。これはプロキシとバックエンドの間の接続だけのもので、HTTP/2 では使えない。バックエンドへの接続は空き（idle）になり、使い回せる。',
            },
        events: [
          send(h2Relay('relay-1', 1, ITEMS(BACKENDS[first].letter), setCookie)),
          model.setState(first, 'idle'),
          set(BROWSER, RESPONSE, '200 OK'),
          ...(options.sticky ? [set(BROWSER, COOKIE, cookie)] : []),
        ],
      },
    ]),
  ]
}

function normalSteps(model: ProxyModel): Step[] {
  const steps = opening(model, { sticky: false })
  const second = model.pick()
  steps.push(
    ...inSection(SECTIONS.request2, [
      {
        id: 'request-2',
        title: { en: 'The next request, on the same connection', ja: '次の要求も同じ接続で' },
        description: {
          en: 'The browser posts an order on a new stream of the same TLS and HTTP/2 connection.',
          ja: 'ブラウザーは、同じ TLS と HTTP/2 の接続の新しいストリームで注文を送る。',
        },
        events: [send(h2Request('request-2', POST_ORDER))],
      },
      {
        id: 'forward-2',
        title: { en: 'This time backend B', ja: '今度はバックエンド B' },
        description: {
          en: 'Round-robin picks the next backend, B. The proxy has no connection to B yet, so it opens one. The browser still sees a single connection to the proxy.',
          ja: 'ラウンドロビンで次のバックエンドの B を選ぶ。B への接続はまだないので、プロキシが新しく開く。ブラウザーから見ると、プロキシへの接続は 1 本のまま。',
        },
        events: [
          send(h1Forward('forward-2', second, POST_ORDER)),
          model.use(second),
          model.rotation(),
          set(second, SEEN, seenTable(second)),
        ],
      },
      {
        id: 'response-2',
        title: { en: 'Backend B creates the order', ja: 'バックエンド B が注文を作る' },
        description: {
          en: 'Backend B stores the order and answers 201 Created. The proxy relays it on stream 3.',
          ja: 'バックエンド B は注文を保存し、201 Created で答える。プロキシはそれをストリーム 3 で中継する。',
        },
        events: [
          send(h1Response('response-2', second, CREATED('B'))),
          model.handle(second),
          send(h2Relay('relay-2', 3, CREATED('B'))),
          model.setState(second, 'idle'),
          set(second, PROCESS, 'order 1001 created'),
          set(BROWSER, RESPONSE, '201 Created'),
        ],
      },
    ]),
  )
  const third = model.pick()
  steps.push(
    ...inSection(SECTIONS.request3, [
      {
        id: 'request-3',
        title: { en: 'Back to A, reusing the connection', ja: 'A に戻り、接続を使い回す' },
        description: {
          en: 'The third request goes to A again. The proxy reuses its idle connection to A: no new TCP connection, which saves a round trip. HTTP/1.1 connections are persistent by default (RFC 9112 §9.3).',
          ja: '3 つ目の要求は、また A に送る。プロキシは A への空いた接続を使い回すので、新しい TCP の接続はいらず、往復が 1 回減る。HTTP/1.1 の接続は既定で持続する（RFC 9112 §9.3）。',
        },
        events: [
          send(h2Request('request-3', GET_ITEMS(5))),
          send(h1Forward('forward-3', third, GET_ITEMS(5))),
          model.use(third),
          model.rotation(),
        ],
      },
      {
        id: 'response-3',
        title: { en: 'Two backends, one site', ja: '2 台のバックエンド、1 つのサイト' },
        description: {
          en: 'A answers, and the load is shared between the two backends. The browser saw one site the whole time.',
          ja: 'A が答え、負荷は 2 台のバックエンドで分け合えた。ブラウザーには、ずっと 1 つのサイトに見えていた。',
        },
        events: [
          send(h1Response('response-3', third, ITEMS('A'))),
          model.handle(third),
          send(h2Relay('relay-3', 5, ITEMS('A'))),
          model.setState(third, 'idle'),
          set(BROWSER, RESPONSE, '200 OK'),
        ],
      },
    ]),
  )
  return steps
}

function backendDownSteps(model: ProxyModel): Step[] {
  const steps = opening(model, { sticky: false })
  const second = model.pick()
  steps.push(
    ...inSection(SECTIONS.request2, [
      {
        id: 'request-2',
        title: { en: 'An order goes to backend B', ja: '注文がバックエンド B に送られる' },
        description: {
          en: 'The browser posts an order, and round-robin sends it to B, which passed its last health check.',
          ja: 'ブラウザーが注文を送り、ラウンドロビンで B に送られる。B は前回のヘルスチェックに通っている。',
        },
        events: [
          send(h2Request('request-2', POST_ORDER)),
          send(h1Forward('forward-2', second, POST_ORDER)),
          model.use(second),
          model.rotation(),
          set(second, SEEN, seenTable(second)),
        ],
      },
      {
        id: 'crash',
        title: { en: 'Backend B crashes', ja: 'バックエンド B が落ちる' },
        description: {
          en: 'B’s app crashes while handling the request, and the operating system closes the connection without a response. The proxy cannot know whether B stored the order before crashing. So it must not simply send the POST again to A: POST is not idempotent, and a retry could create a second order (RFC 9110 §9.2.2). A GET could safely be retried on A. The proxy counts the failure (a passive health check).',
          ja: 'B のアプリが要求の処理中に落ち、OS が応答なしで接続を閉じる。落ちる前に B が注文を保存したかどうか、プロキシにはわからない。だから POST をそのまま A に送り直してはいけない。POST はべき等でなく、再試行すると注文が 2 つできかねない（RFC 9110 §9.2.2）。GET なら A に再試行してよい。プロキシは失敗を数える（受動的なヘルスチェック）。',
        },
        events: [
          set(second, PROCESS, 'crashed'),
          send(
            tcp('crash-fin', second, PROXY, 'FIN (no response)', [
              { name: 'Flags', value: 'FIN, ACK', highlight: true },
            ]),
          ),
          model.setState(second, 'closed'),
          model.probe(second, false),
        ],
      },
      {
        id: 'bad-gateway',
        title: { en: '502 Bad Gateway', ja: '502 Bad Gateway' },
        description: {
          en: 'The proxy answers with 502 Bad Gateway: it did not get a valid response from the backend. The Proxy-Status field (RFC 9209) says which proxy failed and why: connection_terminated, for which RFC 9209 recommends 502.',
          ja: 'プロキシは 502 Bad Gateway で答える。バックエンドから正しい応答を得られなかったという意味。Proxy-Status のフィールド（RFC 9209）は、どのプロキシがなぜ失敗したかを示す。connection_terminated で、RFC 9209 が推奨する状態コードは 502。',
        },
        events: [
          send(h2Error('bad-gateway', 3, 'connection_terminated', backendAddress(second))),
          set(BROWSER, RESPONSE, errorStatus('connection_terminated')),
        ],
      },
    ]),
  )
  steps.push(
    ...inSection(SECTIONS.health, [
      {
        id: 'health-check-2',
        title: { en: 'The next health check', ja: '次のヘルスチェック' },
        description: {
          en: `${String(HEALTH_INTERVAL_MS / 1000)} seconds later, the proxy probes again. For B, nothing listens on port 8080 any more, so B’s TCP answers the SYN with RST, ACK (RFC 9293 §3.10.7.1).`,
          ja: `${String(HEALTH_INTERVAL_MS / 1000)} 秒後、プロキシはまた確かめる。B ではもうポート 8080 で誰も待ち受けていないので、B の TCP は SYN に RST, ACK で答える（RFC 9293 §3.10.7.1）。`,
        },
        events: [
          timer(PROXY, 'health check', HEALTH_INTERVAL_MS),
          send(healthCheck('health-a-2', BACKEND_A)),
          send(
            tcp('health-b-syn', PROXY, second, 'SYN', [
              { name: 'Flags', value: 'SYN' },
              { name: 'Dst port', value: String(BACKENDS[second].port) },
            ]),
          ),
        ],
      },
      {
        id: 'health-result-2',
        title: { en: 'B is taken out of the pool', ja: 'B を一覧から外す' },
        description: {
          en: `A is fine. B has now failed ${String(THRESHOLDS.fall)} times in a row, the threshold in this example, so the proxy marks it down and stops sending it requests. B comes back only after passing ${String(THRESHOLDS.rise)} checks in a row.`,
          ja: `A は問題ない。B は続けて ${String(THRESHOLDS.fall)} 回失敗し、この例のしきい値に達したので、プロキシは down として、要求を送らなくなる。B が戻るのは、続けて ${String(THRESHOLDS.rise)} 回確認に通ってから。`,
        },
        events: [
          send(healthOk('health-a-2-ok', BACKEND_A)),
          send(
            tcp('health-b-rst', second, PROXY, 'RST, ACK', [
              { name: 'Flags', value: 'RST, ACK', highlight: true },
            ]),
          ),
          model.probe(BACKEND_A, true),
          model.probe(second, false),
          model.rotation('B is down'),
        ],
      },
    ]),
  )
  for (const [index, section, stream] of [
    [3, SECTIONS.request3, 5],
    [4, SECTIONS.request4, 7],
  ] as const) {
    const backend = model.pick()
    const skip = index === 4
    steps.push(
      ...inSection(section, [
        {
          id: `request-${String(index)}`,
          title: skip
            ? { en: 'B’s turn, but B is down: A again', ja: 'B の番だが down なので、また A' }
            : { en: 'A’s turn', ja: 'A の番' },
          description: skip
            ? {
                en: 'Round-robin would pick B now, but B is down, so the proxy skips it. If no backend were up, the proxy would answer 503 Service Unavailable itself, perhaps with Retry-After and Proxy-Status error=destination_unavailable (RFC 9209 recommends 503).',
                ja: 'ラウンドロビンでは今度は B の番だが、B は down なので飛ばす。使えるバックエンドが 1 台もなければ、プロキシは自分で 503 Service Unavailable を返す。Retry-After と、Proxy-Status の error=destination_unavailable を付けることもある（RFC 9209 が推奨するのは 503）。',
              }
            : {
                en: 'The next request goes to A, as round-robin would pick anyway.',
                ja: '次の要求は A に送る。ラウンドロビンでもともと A の番。',
              },
          events: [
            send(h2Request(`request-${String(index)}`, GET_ITEMS(stream))),
            send(h1Forward(`forward-${String(index)}`, backend, GET_ITEMS(stream))),
            model.use(backend),
            model.rotation('B is down'),
          ],
        },
        {
          id: `response-${String(index)}`,
          title: { en: 'A answers', ja: 'A が答える' },
          description: skip
            ? {
                en: 'Until B recovers, all requests go to A. Users see no errors, only possibly slower responses.',
                ja: 'B が戻るまで、要求はすべて A に送る。利用者にはエラーは見えず、応答が遅くなるかもしれないだけ。',
              }
            : {
                en: 'A answers over its reused connection.',
                ja: 'A は、使い回した接続で答える。',
              },
          events: [
            send(h1Response(`response-${String(index)}`, backend, ITEMS('A'))),
            model.handle(backend),
            send(h2Relay(`relay-${String(index)}`, stream, ITEMS('A'))),
            model.setState(backend, 'idle'),
            set(BROWSER, RESPONSE, '200 OK'),
          ],
        },
      ]),
    )
  }
  return steps
}

function slowBackendSteps(model: ProxyModel): Step[] {
  const steps = opening(model, { sticky: false })
  const second = model.pick()
  steps.push(
    ...inSection(SECTIONS.request2, [
      {
        id: 'request-2',
        title: { en: 'An order goes to backend B', ja: '注文がバックエンド B に送られる' },
        description: {
          en: `The browser posts an order, and round-robin sends it to B. B is overloaded: this request will take ${String(SLOW_PROCESSING_S)} seconds.`,
          ja: `ブラウザーが注文を送り、ラウンドロビンで B に送られる。B は混み合っていて、この要求には ${String(SLOW_PROCESSING_S)} 秒かかる。`,
        },
        events: [
          send(h2Request('request-2', POST_ORDER)),
          send(h1Forward('forward-2', second, POST_ORDER)),
          model.use(second),
          model.rotation(),
          set(second, SEEN, seenTable(second)),
          set(second, PROCESS, `busy (${String(SLOW_PROCESSING_S)} s)`),
        ],
      },
      {
        id: 'timeout',
        title: { en: 'The proxy stops waiting', ja: 'プロキシが待つのをやめる' },
        description: {
          en: `The proxy waits at most ${String(RESPONSE_TIMEOUT_MS / 1000)} seconds for a response (an example value; the limit is a product setting). Then it gives up and closes the connection: an HTTP/1.1 connection whose response is still pending cannot be reused, because responses are matched to requests only by their order (RFC 9112 §9.2).`,
          ja: `プロキシは応答を最大 ${String(RESPONSE_TIMEOUT_MS / 1000)} 秒待つ（例の値。上限は製品の設定）。それを過ぎるとあきらめ、接続を閉じる。応答が来ていない HTTP/1.1 の接続は使い回せない。応答は順番でしか要求と対応づかないから（RFC 9112 §9.2）。`,
        },
        events: [
          timer(PROXY, 'response timeout', RESPONSE_TIMEOUT_MS),
          send(
            tcp('give-up-fin', PROXY, second, 'FIN (gave up waiting)', [
              { name: 'Flags', value: 'FIN, ACK' },
            ]),
          ),
          model.setState(second, 'closed'),
        ],
      },
      {
        id: 'gateway-timeout',
        title: { en: '504 Gateway Timeout', ja: '504 Gateway Timeout' },
        description: {
          en: 'The proxy answers 504 Gateway Timeout: the backend did not respond in time. The Proxy-Status error is http_response_timeout, for which RFC 9209 recommends 504. Compare: 502 means the backend’s answer was missing or invalid, 504 that it was too slow.',
          ja: 'プロキシは 504 Gateway Timeout で答える。バックエンドが時間内に応答しなかったという意味。Proxy-Status の error は http_response_timeout で、RFC 9209 が推奨するのは 504。502 は、バックエンドの応答がない、または正しくない場合で、504 は遅すぎた場合。',
        },
        events: [
          send(h2Error('gateway-timeout', 3, 'http_response_timeout')),
          set(BROWSER, RESPONSE, errorStatus('http_response_timeout')),
        ],
      },
      {
        id: 'too-late',
        title: { en: 'The order was created anyway', ja: '注文はそれでも作られた' },
        description: {
          en: `${String(SLOW_PROCESSING_S - RESPONSE_TIMEOUT_MS / 1000)} seconds later, B finishes: the order exists. But the proxy has closed the connection, and its TCP answers with RST. So a 504 does not mean the request failed, only that nobody knows. Resending the order blindly could create it twice. Note also that B’s /healthz may still pass: an active health check does not notice a slow endpoint.`,
          ja: `${String(SLOW_PROCESSING_S - RESPONSE_TIMEOUT_MS / 1000)} 秒後、B が処理を終え、注文はできている。しかしプロキシは接続を閉じたので、プロキシの TCP は RST で答える。つまり 504 は要求が失敗したという意味ではなく、どうなったか誰にもわからないという意味。やみくもに注文を送り直すと、2 つできかねない。また、B の /healthz は通るかもしれない。能動的なヘルスチェックは、遅いエンドポイントに気づかない。`,
        },
        events: [
          timer(second, 'processing', (SLOW_PROCESSING_S - RESPONSE_TIMEOUT_MS / 1000) * 1000),
          set(second, PROCESS, 'order 1001 created'),
          model.handle(second),
          send(
            h1Response('too-late', second, CREATED('B'), {
              label: '201 Created (too late)',
              status: 'rejected',
            }),
          ),
          send(tcp('too-late-rst', PROXY, second, 'RST', [{ name: 'Flags', value: 'RST' }])),
        ],
      },
    ]),
  )
  return steps
}

function stickySteps(model: ProxyModel): Step[] {
  const steps = opening(model, { sticky: true })
  // opening の最初の要求を受けたバックエンド（A）が Cookie に入っている
  const { backend: pinned, byCookie } = model.pickByCookie(BACKEND_A)
  const letter = BACKENDS[pinned].letter
  const cookie = `SERVERID=${letter.toLowerCase()}`
  steps.push(
    ...inSection(SECTIONS.request2, [
      {
        id: 'request-2',
        title: { en: 'The browser sends the cookie back', ja: 'ブラウザーが Cookie を送り返す' },
        description: {
          en: 'The next request carries the cookie the proxy set.',
          ja: '次の要求には、プロキシが設定した Cookie が付いている。',
        },
        events: [send(h2Request('request-2', { ...POST_ORDER, cookie }))],
      },
      {
        id: 'forward-2',
        title: {
          en: 'The cookie wins over the rotation',
          ja: '順番より Cookie が優先する',
        },
        description: {
          en: 'Round-robin would pick B, but the cookie says A, so the proxy sends the request to A. In HAProxy’s “insert indirect” mode, the proxy removes its own cookie before forwarding, so the app never sees it.',
          ja: 'ラウンドロビンなら B の番だが、Cookie は A を指すので、プロキシは A に送る。HAProxy の「insert indirect」では、プロキシは転送する前に自分の Cookie を外すので、アプリはそれを見ない。',
        },
        events: [
          send(h1Forward('forward-2', pinned, POST_ORDER)),
          model.use(pinned),
          model.rotation(byCookie ? `${letter} by cookie` : undefined),
        ],
      },
      {
        id: 'response-2',
        title: { en: 'A handles everything', ja: 'A がすべてを処理する' },
        description: {
          en: 'A creates the order. This is useful when the app keeps sessions in memory: the browser always reaches the same process. The costs: the load can become uneven, and when A fails its sessions are lost (the proxy then picks another backend). A common alternative is to keep sessions in a shared store so that any backend can serve any request.',
          ja: 'A が注文を作る。アプリがセッションをメモリーに持つときに役立つ。ブラウザーは常に同じプロセスに届くから。代わりに、負荷が偏ることがあり、A が落ちればそのセッションは失われる（そのときプロキシは別のバックエンドを選ぶ）。よくある別の方法は、セッションを共有のストアに置き、どのバックエンドでもどの要求にも応じられるようにすること。',
        },
        events: [
          send(h1Response('response-2', pinned, CREATED(letter))),
          model.handle(pinned),
          send(h2Relay('relay-2', 3, CREATED(letter))),
          model.setState(pinned, 'idle'),
          set(pinned, PROCESS, 'order 1001 created'),
          set(BROWSER, RESPONSE, '201 Created'),
        ],
      },
    ]),
  )
  return steps
}

function sharedCacheSteps(model: ProxyModel): Step[] {
  const steps = openingPrelude(model)
  const first = model.pick()
  const items: BackendResponse = {
    ...ITEMS('A'),
    cacheControl: ITEMS_CACHE_CONTROL,
    cacheControlNote: FIELD_TEXT.sMaxage,
  }
  const itemsCc = parseCacheControl(ITEMS_CACHE_CONTROL)
  const lifetime = freshnessLifetime(itemsCc, true) ?? 0
  const age = REVISIT_MS / 1000
  const me: BackendResponse = {
    status: '200 OK',
    body: '{"user":"alice"}',
    cacheControl: ME_CACHE_CONTROL,
    cacheControlNote: FIELD_TEXT.private,
  }
  const meStorable = mayStore({
    shared: true,
    requestHasAuthorization: true,
    cc: parseCacheControl(ME_CACHE_CONTROL),
  })
  const cacheRow = (ageS: number): StateTable => ({
    columns: CACHE_COLUMNS,
    rows: [['/api/items', ITEMS_CACHE_CONTROL, String(ageS), ageS < lifetime ? 'fresh' : 'stale']],
  })
  steps.push(
    ...inSection(SECTIONS.request1, [
      {
        id: 'miss',
        title: {
          en: 'Not in the cache: ask backend A',
          ja: 'キャッシュにない。バックエンド A に聞く',
        },
        description: {
          en: 'The proxy also acts as a shared cache. It has nothing for /api/items yet, so it forwards the request to A as usual.',
          ja: 'プロキシは共有キャッシュも兼ねている。/api/items はまだないので、いつもどおり A に転送する。',
        },
        events: [
          send(h1Forward('forward-1', first, GET_ITEMS(1))),
          model.use(first),
          model.rotation(),
          set(first, SEEN, seenTable(first)),
        ],
      },
      {
        id: 'response-1',
        title: {
          en: 'A marks the response as cacheable',
          ja: 'A が応答をキャッシュしてよいと示す',
        },
        description: {
          en: `A answers with Cache-Control: ${ITEMS_CACHE_CONTROL}. s-maxage applies only to shared caches such as this proxy (RFC 9111 §5.2.2.10): the proxy may reuse the response for ${String(lifetime)} seconds, while the browser’s own cache must revalidate at once (max-age=0).`,
          ja: `A は Cache-Control: ${ITEMS_CACHE_CONTROL} で答える。s-maxage はこのプロキシのような共有キャッシュにだけ効く（RFC 9111 §5.2.2.10）。プロキシはこの応答を ${String(lifetime)} 秒使い回せるが、ブラウザー自身のキャッシュはすぐに再検証しなければならない（max-age=0）。`,
        },
        events: [send(h1Response('response-1', first, items)), model.handle(first)],
      },
      {
        id: 'store',
        title: { en: 'The proxy stores and relays it', ja: 'プロキシが保存して中継する' },
        description: {
          en: 'The proxy stores the response and relays it. Cache-Status (RFC 9211) tells what happened: fwd=uri-miss (it was not in the cache, so it went to the backend) and stored.',
          ja: 'プロキシは応答を保存し、中継する。Cache-Status（RFC 9211）が何が起きたかを示す。fwd=uri-miss（キャッシュになかったのでバックエンドに行った）と stored（保存した）。',
        },
        events: [
          send(
            h2Relay('relay-1', 1, items, [
              {
                name: 'cache-status',
                value: formatCacheStatus(PROXY_NAME, { fwd: 'uri-miss', stored: true }),
                highlight: true,
                description: FIELD_TEXT.cacheStatus,
              },
            ]),
          ),
          model.setState(first, 'idle'),
          set(PROXY, CACHE, cacheRow(0)),
          set(BROWSER, RESPONSE, '200 OK'),
        ],
      },
    ]),
    ...inSection(SECTIONS.request2, [
      {
        id: 'revisit',
        title: {
          en: `${String(age)} seconds later, the same URL`,
          ja: `${String(age)} 秒後、同じ URL`,
        },
        description: {
          en: 'The browser asks for /api/items again (its own copy is already stale).',
          ja: 'ブラウザーがまた /api/items を求める（自分の持つ写しはもう古い）。',
        },
        events: [
          timer(BROWSER, 'revisit', REVISIT_MS),
          set(PROXY, CACHE, cacheRow(age)),
          send(h2Request('request-2', GET_ITEMS(3))),
        ],
      },
      {
        id: 'hit',
        title: {
          en: 'A cache hit: no backend involved',
          ja: 'キャッシュに当たる。バックエンドは関わらない',
        },
        description: {
          en: `The stored response is ${String(age)} seconds old, less than s-maxage=${String(lifetime)}, so the proxy answers from its cache without contacting any backend. Age: ${String(age)} tells how long it has been stored, and Cache-Status says hit with ${String(remainingTtl(lifetime, age))} seconds of freshness left. The rotation does not move.`,
          ja: `保存した応答は ${String(age)} 秒前のもので、s-maxage=${String(lifetime)} より新しいので、プロキシはどのバックエンドにも聞かずにキャッシュから答える。Age: ${String(age)} は保存してからの時間、Cache-Status は hit と、新しさがあと ${String(remainingTtl(lifetime, age))} 秒残ることを示す。次に選ぶバックエンドは変わらない。`,
        },
        events: [
          send(
            h2Relay(
              'hit',
              3,
              items,
              [
                { name: 'age', value: String(age), highlight: true },
                {
                  name: 'cache-status',
                  value: formatCacheStatus(PROXY_NAME, {
                    hit: true,
                    ttl: remainingTtl(lifetime, age),
                  }),
                  highlight: true,
                  description: FIELD_TEXT.cacheStatus,
                },
              ],
              { fromCache: true },
            ),
          ),
          set(BROWSER, RESPONSE, '200 OK'),
        ],
      },
    ]),
  )
  // キャッシュに当たった要求はバックエンドを選ばないので、ここで次を選ぶ
  const secondBackend = model.pick()
  steps.push(
    ...inSection(SECTIONS.request3, [
      {
        id: 'personal',
        title: { en: 'A personal page', ja: '利用者ごとのページ' },
        description: {
          en: 'Now the browser asks for /api/me with an Authorization header. The answer depends on the user, so it must never be served to someone else. The proxy has nothing stored for it and forwards it, to B this time.',
          ja: '次にブラウザーは Authorization ヘッダーを付けて /api/me を求める。答えは利用者ごとに違うので、ほかの人に返してはならない。保存したものはないので、プロキシは転送する。今度は B に。',
        },
        events: [
          send(
            h2Request('request-3', {
              method: 'GET',
              path: '/api/me',
              stream: 5,
              authorization: true,
            }),
          ),
          send(
            h1Forward('forward-3', secondBackend, {
              method: 'GET',
              path: '/api/me',
              stream: 5,
              authorization: true,
            }),
          ),
          model.use(secondBackend),
          model.rotation(),
          set(secondBackend, SEEN, seenTable(secondBackend)),
        ],
      },
      {
        id: 'private',
        title: {
          en: 'private: the proxy must not store it',
          ja: 'private: プロキシは保存してはならない',
        },
        description: {
          en: `B answers with Cache-Control: ${ME_CACHE_CONTROL}. A shared cache must not store a private response (RFC 9111 §5.2.2.7); even without private, a response to a request with Authorization may be reused only with public, must-revalidate or s-maxage (§3.5). So the proxy only relays it: Cache-Status has fwd=uri-miss but no stored. The browser’s own cache may keep it for 60 seconds.`,
          ja: `B は Cache-Control: ${ME_CACHE_CONTROL} で答える。共有キャッシュは private の応答を保存してはならない（RFC 9111 §5.2.2.7）。private がなくても、Authorization の付いた要求への応答を使い回せるのは、public、must-revalidate、s-maxage のどれかがあるときだけ（§3.5）。そのためプロキシは中継するだけで、Cache-Status は fwd=uri-miss で、stored はない。ブラウザー自身のキャッシュは 60 秒持っていてよい。`,
        },
        events: [
          send(h1Response('response-3', secondBackend, me)),
          model.handle(secondBackend),
          send(
            h2Relay('relay-3', 5, me, [
              {
                name: 'cache-status',
                value: formatCacheStatus(PROXY_NAME, {
                  fwd: 'uri-miss',
                  stored: meStorable,
                }),
                highlight: true,
                description: FIELD_TEXT.cacheStatus,
              },
            ]),
          ),
          model.setState(secondBackend, 'idle'),
          set(BROWSER, RESPONSE, '200 OK'),
        ],
      },
    ]),
  )
  return steps
}

// ---------- L4（TCP をそのまま流す） ----------

function l4Steps(model: ProxyModel): Step[] {
  const backend = model.pick()
  const tlsData = (id: MessageId, from: ActorId, to: ActorId, inner: string): Message => ({
    id,
    from,
    to,
    label: 'TLS application data',
    status: 'delivered',
    encrypted: true,
    fields: [
      {
        name: 'Visible to the LB',
        value: 'IP and TCP headers only',
        highlight: true,
        description: {
          en: 'The load balancer sees addresses and ports. The HTTP inside is shown here only for learning',
          ja: 'ロードバランサーに見えるのはアドレスとポートだけ。中の HTTP は学習のために表示している',
        },
      },
      { name: 'Inside (encrypted)', value: inner },
    ],
  })
  const seenL4: StateTable = {
    columns: SEEN_COLUMNS,
    rows: [
      ['TCP peer', `${ADDR.proxyInside}:${String(BACKENDS[backend].localPort)}`],
      ['PROXY src', `${ADDR.browser}:${String(ADDR.browserPort)}`],
      ['TLS', 'TLS 1.3 (cert on A)'],
    ],
  }
  // L4 では、接続の中の要求の数は見えない
  const conn = (): StepEvent =>
    set(PROXY, UPSTREAM, {
      columns: UPSTREAM_COLUMNS,
      rows: [['#1', BACKENDS[backend].letter, 'not visible', 'in use']],
    })
  return [
    ...inSection(SECTIONS.tcp, [
      {
        id: 'tcp-front',
        title: { en: 'The browser opens a TCP connection', ja: 'ブラウザーが TCP の接続を開く' },
        description: {
          en: 'A layer-4 load balancer works with TCP connections, not HTTP requests. It accepts the browser’s connection to port 443. (Health checks work as in the other options, often as plain TCP connection attempts; they are not drawn here.)',
          ja: 'L4 のロードバランサーが扱うのは HTTP の要求ではなく、TCP の接続。ブラウザーのポート 443 への接続を受ける（ヘルスチェックはほかの選択肢と同じ。TCP の接続を試すだけのことも多い。ここでは描かない）。',
        },
        events: [
          send(tcp('syn', BROWSER, PROXY, 'SYN', [{ name: 'Dst', value: `${ADDR.proxy}:443` }])),
          send(tcp('syn-ack', PROXY, BROWSER, 'SYN, ACK', [{ name: 'Flags', value: 'SYN, ACK' }])),
          send(tcp('ack', BROWSER, PROXY, 'ACK', [{ name: 'Flags', value: 'ACK' }])),
          set(BROWSER, CONNECTION, `TCP to ${ADDR.proxy}:443`),
          // L4 では TLS をそのまま流すので、バックエンドのポートは 443（ヘルスチェックは描かないが、通っているものとする）
          set(PROXY, POOL, {
            columns: POOL_COLUMNS,
            rows: ([BACKEND_A, BACKEND_B] as const).map((id) => [
              BACKENDS[id].letter,
              `${BACKENDS[id].ip}:${String(TLS_PORT)}`,
              'up',
              '0',
            ]),
          }),
        ],
      },
      {
        id: 'tcp-back',
        title: {
          en: `One backend for the whole connection: ${BACKENDS[backend].letter}`,
          ja: `接続全体で 1 台: ${BACKENDS[backend].letter}`,
        },
        description: {
          en: 'The load balancer picks a backend once per TCP connection and opens its own connection to it. Everything the browser sends on this connection will go to that backend.',
          ja: 'ロードバランサーは TCP の接続ごとに 1 回だけバックエンドを選び、そこへ自分の接続を開く。この接続でブラウザーが送るものは、すべてそのバックエンドに行く。',
        },
        events: [
          send(
            tcp('back-syn', PROXY, backend, 'SYN', [
              { name: 'Dst', value: `${BACKENDS[backend].ip}:${String(TLS_PORT)}` },
            ]),
          ),
          send(
            tcp('back-syn-ack', backend, PROXY, 'SYN, ACK', [{ name: 'Flags', value: 'SYN, ACK' }]),
          ),
          send(tcp('back-ack', PROXY, backend, 'ACK', [{ name: 'Flags', value: 'ACK' }])),
          conn(),
          model.rotation(),
        ],
      },
      {
        id: 'proxy-header',
        title: { en: 'The PROXY protocol header', ja: 'PROXY protocol のヘッダー' },
        description: {
          en: 'The backend’s TCP peer is the load balancer, and nobody can add an HTTP header to encrypted traffic. So the load balancer first writes one line with the original addresses and ports: the PROXY protocol, a HAProxy specification rather than an RFC. The backend must be configured to expect it, and should accept it only from the load balancer; a client could otherwise send a fake one.',
          ja: 'バックエンドから見た TCP の相手はロードバランサーで、暗号化された通信に HTTP のヘッダーを足すことは誰にもできない。そこでロードバランサーは最初に、元のアドレスとポートを書いた 1 行を送る。PROXY protocol で、RFC ではなく HAProxy の仕様。バックエンドはこれを受け取るよう設定しておかなければならず、受け入れるのはロードバランサーからだけにすべき。そうしないと、クライアントが偽の行を送れてしまう。',
        },
        events: [
          send(
            tcp('proxy-header', PROXY, backend, 'PROXY header (v1)', [
              {
                name: 'Line',
                value: PROXY_V1.replace('\r\n', '\\r\\n'),
                highlight: true,
              },
            ]),
          ),
          set(backend, SEEN, {
            columns: SEEN_COLUMNS,
            rows: seenL4.rows.slice(0, 2),
          }),
        ],
      },
    ]),
    ...inSection(SECTIONS.tls, [
      {
        id: 'client-hello',
        title: { en: 'TLS passes through', ja: 'TLS はそのまま通る' },
        description: {
          en: 'The ClientHello is relayed to the backend unchanged. The load balancer does not terminate TLS: it has no certificate for the site.',
          ja: 'ClientHello は変えずにバックエンドへ流す。ロードバランサーは TLS を終端しない。サイトの証明書を持っていない。',
        },
        events: [
          send(
            tcp('client-hello', BROWSER, PROXY, 'ClientHello (SNI, ALPN h2)', [
              { name: 'server_name', value: ADDR.site },
            ]),
          ),
          send(
            tcp('client-hello-relay', PROXY, backend, 'ClientHello (SNI, ALPN h2)', [
              { name: 'server_name', value: ADDR.site },
            ]),
          ),
          set(PROXY, TLS, 'passthrough (ciphertext only)'),
        ],
      },
      {
        id: 'server-hello',
        title: { en: 'The backend completes TLS', ja: 'バックエンドが TLS を終える' },
        description: {
          en: 'Backend A answers with its own certificate for the site. With TLS passthrough, every backend needs the certificate and private key.',
          ja: 'バックエンド A が、自分の持つサイトの証明書で答える。TLS をそのまま通すなら、どのバックエンドにも証明書と秘密鍵が要る。',
        },
        events: [
          send(
            tcp('server-hello', backend, PROXY, 'ServerHello … Finished', [
              { name: 'Certificate', value: `${ADDR.site} (held by backend A)`, highlight: true },
            ]),
          ),
          send(
            tcp('server-hello-relay', PROXY, BROWSER, 'ServerHello … Finished', [
              { name: 'Certificate', value: `${ADDR.site} (held by backend A)` },
            ]),
          ),
          send({ ...tcp('finished', BROWSER, PROXY, 'Finished', []), encrypted: true }),
          send({ ...tcp('finished-relay', PROXY, backend, 'Finished', []), encrypted: true }),
          set(BROWSER, CONNECTION, `h2, TLS 1.3 to ${ADDR.proxy}:443 (ends at A)`),
          set(backend, SEEN, seenL4),
        ],
      },
    ]),
    ...inSection(SECTIONS.request1, [
      {
        id: 'request-1',
        title: {
          en: 'The load balancer sees only bytes',
          ja: 'ロードバランサーにはバイト列しか見えない',
        },
        description: {
          en: 'The request is encrypted end to end between the browser and A. The load balancer cannot read the path, cannot add Forwarded, Via or X-Forwarded-Proto, and cannot cache.',
          ja: '要求はブラウザーと A の間で端から端まで暗号化されている。ロードバランサーはパスを読めず、Forwarded、Via、X-Forwarded-Proto を足せず、キャッシュもできない。',
        },
        events: [
          send(tlsData('request-1', BROWSER, PROXY, 'GET /api/items [h2 stream 1]')),
          send(tlsData('request-1-relay', PROXY, backend, 'GET /api/items [h2 stream 1]')),
        ],
      },
      {
        id: 'response-1',
        title: { en: 'The response comes back the same way', ja: '応答も同じ道を戻る' },
        description: {
          en: 'A answers, and the load balancer copies the bytes back.',
          ja: 'A が答え、ロードバランサーはバイト列をそのまま戻す。',
        },
        events: [
          send(tlsData('response-1', backend, PROXY, '200 OK [h2 stream 1]')),
          send(tlsData('response-1-relay', PROXY, BROWSER, '200 OK [h2 stream 1]')),
          model.handle(backend),
          set(BROWSER, RESPONSE, '200 OK'),
        ],
      },
    ]),
    ...inSection(SECTIONS.request2, [
      {
        id: 'request-2',
        title: { en: 'The next request also goes to A', ja: '次の要求も A に行く' },
        description: {
          en: 'The order goes on the same TCP connection, so it also reaches A. The load balancer cannot tell the requests apart; only a new connection could go to B.',
          ja: '注文も同じ TCP の接続で送るので、やはり A に届く。ロードバランサーには要求を区別できない。B に行けるのは新しい接続だけ。',
        },
        events: [
          send(tlsData('request-2', BROWSER, PROXY, 'POST /api/orders [h2 stream 3]')),
          send(tlsData('request-2-relay', PROXY, backend, 'POST /api/orders [h2 stream 3]')),
        ],
      },
      {
        id: 'response-2',
        title: { en: 'L4 versus L7', ja: 'L4 と L7' },
        description: {
          en: 'A creates the order. A layer-4 load balancer is simple and fast and leaves TLS to the backends, but it balances connections, not requests, and cannot look inside. Other ways to keep the client’s address: DSR (direct server return, where replies bypass the load balancer) or none at all with SNAT, where the backend sees only the load balancer’s address.',
          ja: 'A が注文を作る。L4 のロードバランサーは単純で速く、TLS はバックエンドに任せるが、振り分けるのは要求ではなく接続で、中身も見られない。クライアントのアドレスを残すほかの方法には DSR（応答がロードバランサーを通らない）がある。SNAT だけなら、バックエンドに見えるのはロードバランサーのアドレスだけになる。',
        },
        events: [
          send(tlsData('response-2', backend, PROXY, '201 Created [h2 stream 3]')),
          send(tlsData('response-2-relay', PROXY, BROWSER, '201 Created [h2 stream 3]')),
          model.handle(backend),
          set(backend, PROCESS, 'order 1001 created'),
          set(BROWSER, RESPONSE, '201 Created'),
        ],
      },
    ]),
  ]
}

function buildSteps({ situation }: ReverseProxyOptions): readonly Step[] {
  const model = new ProxyModel()
  switch (situation) {
    case 'normal':
      return normalSteps(model)
    case 'backendDown':
      return backendDownSteps(model)
    case 'slowBackend':
      return slowBackendSteps(model)
    case 'sticky':
      return stickySteps(model)
    case 'l4':
      return l4Steps(model)
    case 'sharedCache':
      return sharedCacheSteps(model)
  }
}

export const reverseProxyScenario: Scenario<ReverseProxyOptions> = {
  id: 'reverse-proxy',
  title: {
    en: 'Reverse proxies and load balancers',
    ja: 'リバースプロキシとロードバランサー',
  },
  actors,
  optionDefs: {
    situation: {
      kind: 'select',
      label: { en: 'Situation', ja: '状況' },
      choices: [
        { value: 'normal', label: { en: 'Everything works', ja: 'すべて正常' } },
        { value: 'backendDown', label: { en: 'Backend B crashes', ja: 'バックエンド B が落ちる' } },
        {
          value: 'slowBackend',
          label: { en: 'Backend B is too slow', ja: 'バックエンド B の応答が遅い' },
        },
        {
          value: 'sticky',
          label: { en: 'Sticky sessions (cookie)', ja: 'スティッキーセッション（Cookie）' },
        },
        {
          value: 'l4',
          label: {
            en: 'Layer-4 load balancer (TLS passthrough)',
            ja: 'L4 のロードバランサー（TLS のパススルー）',
          },
        },
        {
          value: 'sharedCache',
          label: { en: 'The proxy caches (s-maxage)', ja: 'プロキシがキャッシュする（s-maxage）' },
        },
      ],
      defaultValue: 'normal',
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
