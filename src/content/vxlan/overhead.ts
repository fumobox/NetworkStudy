/**
 * VXLAN のオーバーヘッド（RFC 7348 §5）。内側の IP パケットの外に、内側の Ethernet のヘッダー（14 バイト。§6.1 で内側の
 * 802.1Q のタグは既定で付けない）、VXLAN（8）、UDP（8）、外側の IP（IPv4 は 20、IPv6 は 40）が付く。外側の Ethernet の
 * ヘッダーは IP の MTU に数えない。
 * IPv4 で 50 バイト、IPv6 で 70 バイト。Linux の drivers/net/vxlan/vxlan_core.c の vxlan_headroom と同じ計算で、
 * 下のデバイスを指定すると VXLAN のデバイスの MTU は、その MTU から 50 を引いた値になる
 */

export const ETHERNET_HEADER = 14
export const VXLAN_HEADER = 8
export const UDP_HEADER = 8
export const IPV4_HEADER = 20
export const IPV6_HEADER = 40

export type OuterFamily = 'ipv4' | 'ipv6'

export function overhead(family: OuterFamily): number {
  return (
    ETHERNET_HEADER + VXLAN_HEADER + UDP_HEADER + (family === 'ipv4' ? IPV4_HEADER : IPV6_HEADER)
  )
}

/** 内側の IP パケットの長さから、外側の IP パケットの長さ */
export function outerIpLength(innerIpLength: number, family: OuterFamily = 'ipv4'): number {
  return innerIpLength + overhead(family)
}

/** アンダーレイの MTU で運べる、内側の IP パケットの最大の長さ（オーバーレイの MTU） */
export function overlayMtu(underlayMtu: number, family: OuterFamily = 'ipv4'): number {
  return underlayMtu - overhead(family)
}

/** 内側の MTU を保つのに要るアンダーレイの MTU */
export function requiredUnderlayMtu(innerMtu: number, family: OuterFamily = 'ipv4'): number {
  return innerMtu + overhead(family)
}

export function fits(
  innerIpLength: number,
  underlayMtu: number,
  family: OuterFamily = 'ipv4',
): boolean {
  return outerIpLength(innerIpLength, family) <= underlayMtu
}
