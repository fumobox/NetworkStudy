/**
 * 既知の HSTS ホストの記録と照合（RFC 6797 §8.1〜§8.3）
 *
 * - §8.1: 安全な接続で、誤りなく受けた最初の STS ヘッダーだけを処理する。平文で受けたものは無視する。max-age=0 なら記録を消す
 *   （知らないホストなら記録しない）
 * - §8.1.1: IP アドレスのホストは記録しない。上位ドメインとして一致した記録は変えない。期限が過去のものは期限切れで、消す
 * - §8.2: ラベルごとに、大文字小文字を区別せず右から比べる。完全一致（congruent）と上位ドメインとの一致（superdomain）
 * - §8.3 手順 5: includeSubDomains のある上位ドメインの一致か、完全一致があれば https に書き換え、明示されたポート 80 は 443 に、
 *   ほかのポートはそのまま、ポートがなければ足さない
 */
import { parseStrictTransportSecurity } from './sts'

export interface KnownHost {
  readonly host: string
  readonly includeSubDomains: boolean
  /** ISO 8601（UTC）。プリロードリストの項目は null */
  readonly expires: string | null
  readonly source: 'header' | 'preload'
}

export const addSeconds = (iso: string, seconds: number): string =>
  new Date(Date.parse(iso) + seconds * 1000).toISOString().replace('.000Z', 'Z')

/** 期限が過去なら期限切れ（ちょうど今は、まだ期限切れではない） */
export const isExpired = (entry: KnownHost, now: string): boolean =>
  entry.expires !== null && Date.parse(entry.expires) < Date.parse(now)

export const evictExpired = (store: readonly KnownHost[], now: string): KnownHost[] =>
  store.filter((entry) => !isExpired(entry, now))

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/
const isIpLiteral = (host: string) => IPV4.test(host) || host.startsWith('[')

const labelsOf = (host: string) => host.toLowerCase().split('.')

export type HostMatch =
  | { readonly kind: 'congruent' | 'superdomain'; readonly entry: KnownHost }
  | { readonly kind: 'none' }

/** includeSubDomains のある上位ドメインの一致を、完全一致より先に採る（§8.3 手順 5） */
export function matchKnownHost(store: readonly KnownHost[], host: string, now: string): HostMatch {
  if (isIpLiteral(host)) {
    return { kind: 'none' }
  }
  const hostLabels = labelsOf(host)
  const live = evictExpired(store, now)
  const superdomain = live.find((entry) => {
    const entryLabels = labelsOf(entry.host)
    return (
      entry.includeSubDomains &&
      entryLabels.length < hostLabels.length &&
      entryLabels.every(
        (label, i) => hostLabels[hostLabels.length - entryLabels.length + i] === label,
      )
    )
  })
  if (superdomain !== undefined) {
    return { kind: 'superdomain', entry: superdomain }
  }
  const congruent = live.find((entry) => entry.host.toLowerCase() === host.toLowerCase())
  return congruent === undefined ? { kind: 'none' } : { kind: 'congruent', entry: congruent }
}

export interface NoteInput {
  readonly host: string
  /** 応答の Strict-Transport-Security のヘッダー（順に） */
  readonly headers: readonly string[]
  readonly secure: boolean
  readonly transportOk: boolean
  readonly now: string
}

/** 応答の STS ヘッダーで記録を更新する（§8.1、§8.1.1） */
export function noteHeader(store: readonly KnownHost[], input: NoteInput): KnownHost[] {
  const [first] = input.headers
  if (!input.secure || !input.transportOk || first === undefined || isIpLiteral(input.host)) {
    return [...store]
  }
  const parsed = parseStrictTransportSecurity(first)
  if (!parsed.ok) {
    return [...store]
  }
  // 変えるのはこのホスト自身の記録だけ。上位ドメインとして一致した記録（example.com など）は変えない（§8.1.1）
  const others = store.filter((entry) => entry.host.toLowerCase() !== input.host.toLowerCase())
  const own = store.find((entry) => entry.host.toLowerCase() === input.host.toLowerCase())
  if (parsed.maxAge === 0) {
    return own?.source === 'preload' ? [...store] : others
  }
  const noted: KnownHost = {
    host: input.host.toLowerCase(),
    includeSubDomains: parsed.includeSubDomains,
    expires: addSeconds(input.now, parsed.maxAge),
    source: 'header',
  }
  // プリロードリストの項目は残し、ヘッダーで知った項目を別の行として持つ（このページの模型）
  return own?.source === 'preload' ? [...store, noted] : [...others, noted]
}

/** http の URI を https に書き換える（§8.3 手順 5） */
export function upgradeUri(uri: string): string {
  const match = /^http:\/\/([^/:?#]+)(?::(\d+))?(.*)$/.exec(uri)
  if (match === null) {
    return uri
  }
  const [, host = '', port, rest = ''] = match
  const newPort = port === undefined ? '' : port === '80' ? ':443' : `:${port}`
  return `https://${host}${newPort}${rest}`
}
