/**
 * AS_PATH（RFC 4271 §5.1.2、§9.1.2）。ここでは AS_SEQUENCE 1 つだけを扱う。
 * - 自分が作った経路を eBGP で広告するときは、自分の AS 番号だけを入れる
 * - 受け取った経路を eBGP で広告するときは、自分の AS 番号を先頭（左端）に付け足す。
 *   設定で 2 つ以上付け足してもよい（プリペンド）
 * - 受け取った経路の AS_PATH に自分の AS 番号があれば、ループなので使わない
 */

export type AsPath = readonly number[]

export const prepend = (path: AsPath, asn: number, times = 1): AsPath => [
  ...Array.from({ length: times }, () => asn),
  ...path,
]

export const containsLoop = (path: AsPath, localAs: number): boolean => path.includes(localAs)

export const formatAsPath = (path: AsPath): string => path.join(' ')
