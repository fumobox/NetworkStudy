/**
 * オリジンとサイトの判定
 *
 * - RFC 6454 §4、§5: オリジンはスキーム・ホスト・ポートの組。同じオリジンは 3 つとも同じ
 * - URL Standard（WHATWG）"Host miscellaneous": public suffix と registrable domain（登録可能ドメイン = public suffix と、その左の
 *   ラベル 1 つ）。public suffix は Public Suffix List（PSL）で決まり、載っていなければ最後のラベル（既定の規則 *）
 * - HTML Standard（WHATWG）"Sites": サイトはスキームと登録可能ドメイン（なければホスト）の組。同じサイトはポートを比べない
 *
 * PSL は数千の項目があるが、ここではごく一部（下の PUBLIC_SUFFIX_SUBSET と既定の規則）だけを使う
 */

export interface WebOrigin {
  readonly scheme: 'https' | 'http'
  readonly host: string
  /** 既定のポート（https の 443、http の 80）なら null */
  readonly port: number | null
}

export const serializeOrigin = (origin: WebOrigin): string =>
  `${origin.scheme}://${origin.host}${origin.port === null ? '' : `:${String(origin.port)}`}`

/** PSL のごく一部。これに載っていない最後のラベル（com、example など）も public suffix になる */
export const PUBLIC_SUFFIX_SUBSET = ['co.jp', 'github.io'] as const

const labels = (host: string) => host.toLowerCase().split('.')

export function publicSuffix(host: string): string {
  const hostLabels = labels(host)
  const listed = PUBLIC_SUFFIX_SUBSET.filter((suffix) => {
    const suffixLabels = suffix.split('.')
    return suffixLabels.every(
      (label, index) => hostLabels[hostLabels.length - suffixLabels.length + index] === label,
    )
  }).sort((a, b) => b.split('.').length - a.split('.').length)[0]
  return listed ?? hostLabels[hostLabels.length - 1] ?? ''
}

/** 登録可能ドメイン。ホストそのものが public suffix なら null */
export function registrableDomain(host: string): string | null {
  const suffix = publicSuffix(host)
  const hostLabels = labels(host)
  const suffixLength = suffix.split('.').length
  if (hostLabels.length <= suffixLength) {
    return null
  }
  return hostLabels.slice(hostLabels.length - suffixLength - 1).join('.')
}

export const sameOrigin = (a: WebOrigin, b: WebOrigin): boolean =>
  a.scheme === b.scheme && a.host.toLowerCase() === b.host.toLowerCase() && a.port === b.port

const siteHost = (origin: WebOrigin) => registrableDomain(origin.host) ?? origin.host.toLowerCase()

/** 同じサイトか。スキームも比べる（schemeful）。ポートは比べない */
export const sameSite = (a: WebOrigin, b: WebOrigin): boolean =>
  a.scheme === b.scheme && siteHost(a) === siteHost(b)
