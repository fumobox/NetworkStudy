/**
 * プロキシが付ける・外すヘッダーの値を作る純関数
 *
 * - RFC 9110 §5.6.2（token と tchar）、§5.6.4（quoted-string と、" と \ のエスケープ）
 * - RFC 7239 §4（Forwarded = forwarded-element の並び。forwarded-pair は token "=" value、value は token か quoted-string）、
 *   §6（IPv6 のアドレスは [] で囲み、ポートを付けたノードや IPv6 のノードは引用符で囲まなければならない）、
 *   §7.4（X-Forwarded-For からの書き換え）。§1 は X-Forwarded-For / -By / -Proto を標準でないヘッダーと呼ぶ
 * - RFC 9110 §7.6.1（Connection に並んだフィールドと Connection 自体は、転送する前に外さなければならない。Proxy-Connection、
 *   Keep-Alive、TE、Transfer-Encoding、Upgrade も外すべき）、§7.6.3（Via = received-protocol RWS received-by。
 *   プロトコルが HTTP なら名前を省き、版だけ書く）
 * - RFC 9651 §3.3.3（Structured Field の String）、§3.3.4（Token: 最初の文字は英字か *）。
 *   RFC 9209（Proxy-Status）と RFC 9211（Cache-Status）は Structured Field の List
 */

const TCHAR = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

export const isToken = (value: string): boolean => TCHAR.test(value)

const escapeQuoted = (value: string) => `"${value.replace(/["\\]/g, (c) => `\\${c}`)}"`

/** token でなければ quoted-string にする */
export const quoteIfNeeded = (value: string): string =>
  isToken(value) ? value : escapeQuoted(value)

/** Forwarded の for / by の値。IPv6 は [] で囲み、ポートを付ける。token でなくなれば引用符で囲む */
export function forwardedNode(ip: string, port?: number): string {
  const host = ip.includes(':') ? `[${ip}]` : ip
  return quoteIfNeeded(port === undefined ? host : `${host}:${String(port)}`)
}

export interface ForwardedElement {
  /** forwardedNode で作った値 */
  readonly for?: string
  readonly by?: string
  readonly host?: string
  readonly proto?: string
}

// RFC 7239 §7.5 の例と同じ並び
const FORWARDED_PARAMS = ['for', 'by', 'proto', 'host'] as const

export function formatForwardedElement(element: ForwardedElement): string {
  return FORWARDED_PARAMS.flatMap((name) => {
    const value = element[name]
    if (value === undefined) {
      return []
    }
    // for と by は forwardedNode で引用符まで付けてある
    return [`${name}=${name === 'for' || name === 'by' ? value : quoteIfNeeded(value)}`]
  }).join(';')
}

/** 前のプロキシが付けた Forwarded があれば、その後ろに足す（RFC 7239 §4） */
export function appendForwarded(existing: string | null, element: ForwardedElement): string {
  const added = formatForwardedElement(element)
  return existing === null ? added : `${existing}, ${added}`
}

/** X-Forwarded-For は IP アドレスをそのまま並べる（IPv6 も [] で囲まない） */
export function appendXForwardedFor(existing: string | null, ip: string): string {
  return existing === null ? ip : `${existing}, ${ip}`
}

const splitList = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')

/** RFC 7239 §7.4: X-Forwarded-For を Forwarded に書き換える */
export function xffToForwarded(value: string): string {
  return splitList(value)
    .map((ip) => `for=${forwardedNode(ip)}`)
    .join(', ')
}

/**
 * X-Forwarded-For からクライアントの IP アドレスを取る。信頼できるプロキシが trustedHops 台あるなら、右から
 * trustedHops 番目の値（信頼できるプロキシのうち、いちばん外側が付けた値）を使う。それより左はクライアントが自由に書ける
 */
export function clientIpFromXForwardedFor(value: string, trustedHops: number): string | undefined {
  const entries = splitList(value)
  return entries[entries.length - trustedHops]
}

/** Via の 1 つの値（例: "1.1 proxy1"。HTTP なのでプロトコル名は省く） */
export const viaMember = (version: string, receivedBy: string): string => `${version} ${receivedBy}`

export function appendVia(existing: string | null, member: string): string {
  return existing === null ? member : `${existing}, ${member}`
}

export interface HeaderField {
  readonly name: string
  readonly value: string
}

/** Connection に並べなくても外すフィールド（RFC 9110 §7.6.1、RFC 9113 §8.2.2） */
const HOP_BY_HOP = [
  'connection',
  'proxy-connection',
  'keep-alive',
  'te',
  'transfer-encoding',
  'upgrade',
]

/** 転送するフィールドと、外したフィールドの名前 */
export function stripHopByHop(fields: readonly HeaderField[]): {
  readonly forwarded: readonly HeaderField[]
  readonly removed: readonly string[]
} {
  const listed = fields
    .filter((field) => field.name.toLowerCase() === 'connection')
    .flatMap((field) => splitList(field.value).map((name) => name.toLowerCase()))
  const drop = new Set([...HOP_BY_HOP, ...listed])
  return {
    forwarded: fields.filter((field) => !drop.has(field.name.toLowerCase())),
    removed: fields
      .filter((field) => drop.has(field.name.toLowerCase()))
      .map((field) => field.name),
  }
}

const SF_TOKEN = /^[A-Za-z*][!#$%&'*+\-.^_`|~0-9A-Za-z:/]*$/

/** Structured Field の Token にできればそのまま、できなければ String（RFC 9651 §3.3.3、§3.3.4） */
export const sfItem = (value: string): string =>
  SF_TOKEN.test(value) ? value : escapeQuoted(value)

/** Proxy-Status の 1 つの値（RFC 9209 §2） */
export function formatProxyStatus(proxy: string, error: string, nextHop?: string): string {
  return [
    sfItem(proxy),
    `error=${error}`,
    ...(nextHop === undefined ? [] : [`next-hop=${sfItem(nextHop)}`]),
  ].join('; ')
}

export interface CacheStatusParams {
  readonly hit?: boolean
  /** fwd の理由（uri-miss など） */
  readonly fwd?: string
  readonly ttl?: number
  readonly stored?: boolean
}

/** Cache-Status の 1 つの値（RFC 9211 §2） */
export function formatCacheStatus(cache: string, params: CacheStatusParams): string {
  return [
    sfItem(cache),
    ...(params.hit === true ? ['hit'] : []),
    ...(params.fwd === undefined ? [] : [`fwd=${params.fwd}`]),
    ...(params.ttl === undefined ? [] : [`ttl=${String(params.ttl)}`]),
    ...(params.stored === true ? ['stored'] : []),
  ].join('; ')
}
