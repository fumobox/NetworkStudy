/**
 * BGP-4 のメッセージの長さ（RFC 4271 §4.1〜§4.5）。長さはオクテット数で、ヘッダーを含む。
 * - ヘッダー: Marker 16（すべて 1）+ Length 2 + Type 1 = 19
 * - OPEN: 29 + Optional Parameters。4 オクテットの AS 番号の Capability（RFC 6793、コード 65）は、
 *   Optional Parameter の種類 2（Capabilities、RFC 5492）の中に、コード 1 + 長さ 1 + 値 4 で入る
 * - UPDATE: 19 + Withdrawn Routes Length 2 + Withdrawn Routes + Total Path Attribute Length 2 + 属性 + NLRI
 * - 経路（プレフィックス）: 長さ 1 オクテット + プレフィックスをオクテット単位に切り上げたもの
 * - 属性: フラグ 1 + 種類 1 + 長さ 1（Extended Length のときは 2）+ 値
 * - AS_PATH の区切り: 種類 1 + AS の数 1 + AS 番号（両側が RFC 6793 に対応していれば 4 オクテットずつ）
 * - KEEPALIVE: ヘッダーだけの 19。NOTIFICATION: 21 + Data
 */

export const HEADER_LENGTH = 19
export const KEEPALIVE_LENGTH = HEADER_LENGTH
export const MESSAGE_TYPES = { OPEN: 1, UPDATE: 2, NOTIFICATION: 3, KEEPALIVE: 4 } as const
export const MARKER = Array.from({ length: 16 }, () => 'ff').join(' ')
/** RFC 6793 の Capability のコード */
export const CAPABILITY_FOUR_OCTET_AS = 65

/** 経路（NLRI・Withdrawn Routes）の 1 つ分: 長さ 1 オクテット + プレフィックス */
export const prefixOctets = (length: number): number => 1 + Math.ceil(length / 8)

/** 属性の長さ（値が 255 オクテットを超えると Extended Length で長さが 2 オクテットになる） */
export const attributeLength = (valueLength: number): number =>
  (valueLength > 255 ? 4 : 3) + valueLength

/** 属性（ORIGIN、AS_PATH（AS_SEQUENCE 1 つ）、NEXT_HOP）の長さの合計 */
export function pathAttributesLength(asCount: number): number {
  const origin = attributeLength(1)
  const asPath = attributeLength(2 + 4 * asCount)
  const nextHop = attributeLength(4)
  return origin + asPath + nextHop
}

/** OPEN。Capability は 4 オクテットの AS 番号だけ（Optional Parameter 2 + Capability 2 + 値 4 = 8） */
export const OPEN_LENGTH = 29 + 2 + 2 + 4

export interface UpdateShape {
  /** 取り下げる経路のプレフィックス長 */
  readonly withdrawn: readonly number[]
  /** 広告する経路のプレフィックス長。空なら属性もない */
  readonly nlri: readonly number[]
  /** AS_PATH の AS の数 */
  readonly asCount: number
}

export function updateLength({ withdrawn, nlri, asCount }: UpdateShape): number {
  const sum = (lengths: readonly number[]) =>
    lengths.reduce((total, length) => total + prefixOctets(length), 0)
  const attributes = nlri.length === 0 ? 0 : pathAttributesLength(asCount)
  return HEADER_LENGTH + 2 + sum(withdrawn) + 2 + attributes + sum(nlri)
}

export const notificationLength = (dataLength: number): number => 21 + dataLength
