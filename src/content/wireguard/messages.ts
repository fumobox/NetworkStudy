/**
 * WireGuard のメッセージの形式と大きさ（ホワイトペーパー §5.4.2〜§5.4.7、wireguard.com「Protocol & Cryptography」）。
 *
 * - 1: Handshake Initiation 148 バイト（type 1、reserved 3、sender 4、ephemeral 32、static 32 + 16、timestamp 12 + 16、mac1 16、mac2 16）
 * - 2: Handshake Response 92 バイト（type 1、reserved 3、sender 4、receiver 4、ephemeral 32、empty 0 + 16、mac1 16、mac2 16）
 * - 3: Cookie Reply 64 バイト（type 1、reserved 3、receiver 4、nonce 24、cookie 16 + 16）
 * - 4: Transport Data（type 1、reserved 3、receiver 4、counter 8 の 16 バイト、暗号化した中身、tag 16）。中身は 16 の倍数まで 0 で
 *   詰めるが、MTU は超えない（Linux の calculate_skb_padding）。中身のないキープアライブは 32 バイト
 *
 * 外側のオーバーヘッドは、Transport Data の 32 バイトと UDP 8、IP（IPv4 20、IPv6 40）で 60 か 80 バイト（と詰め物）。
 * Linux のデバイスの既定の MTU は 1500 − 80 = 1420（drivers/net/wireguard/device.c）
 */

export interface FieldLayout {
  readonly name: string
  readonly bytes: number
}

export const INITIATION_LAYOUT: readonly FieldLayout[] = [
  { name: 'Type', bytes: 1 },
  { name: 'Reserved', bytes: 3 },
  { name: 'Sender', bytes: 4 },
  { name: 'Ephemeral', bytes: 32 },
  { name: 'Static', bytes: 48 },
  { name: 'Timestamp', bytes: 28 },
  { name: 'mac1', bytes: 16 },
  { name: 'mac2', bytes: 16 },
]
export const RESPONSE_LAYOUT: readonly FieldLayout[] = [
  { name: 'Type', bytes: 1 },
  { name: 'Reserved', bytes: 3 },
  { name: 'Sender', bytes: 4 },
  { name: 'Receiver', bytes: 4 },
  { name: 'Ephemeral', bytes: 32 },
  { name: 'Empty', bytes: 16 },
  { name: 'mac1', bytes: 16 },
  { name: 'mac2', bytes: 16 },
]
export const COOKIE_REPLY_LAYOUT: readonly FieldLayout[] = [
  { name: 'Type', bytes: 1 },
  { name: 'Reserved', bytes: 3 },
  { name: 'Receiver', bytes: 4 },
  { name: 'Nonce', bytes: 24 },
  { name: 'Cookie', bytes: 32 },
]

export const layoutLength = (layout: readonly FieldLayout[]) =>
  layout.reduce((sum, field) => sum + field.bytes, 0)

export const DATA_HEADER = 16
export const TAG = 16
export const PADDING_MULTIPLE = 16
export const UDP_HEADER = 8
export const IP_HEADER = { ipv4: 20, ipv6: 40 } as const
export type Family = keyof typeof IP_HEADER

/** 中身を 16 の倍数まで詰めた長さ（MTU を超えない） */
export function paddedLength(innerLength: number, mtu: number): number {
  const rounded = Math.ceil(innerLength / PADDING_MULTIPLE) * PADDING_MULTIPLE
  return Math.max(innerLength, Math.min(mtu, rounded))
}

/** Transport Data のメッセージの長さ（UDP の中身） */
export function dataMessageLength(innerLength: number, mtu: number): number {
  return DATA_HEADER + paddedLength(innerLength, mtu) + TAG
}

/** WireGuard のメッセージを運ぶ外側の IP パケットの長さ */
export function outerIpLength(messageLength: number, family: Family = 'ipv4'): number {
  return messageLength + UDP_HEADER + IP_HEADER[family]
}

/** 詰め物を除いたオーバーヘッド（IPv4 で 60、IPv6 で 80） */
export function overhead(family: Family): number {
  return DATA_HEADER + TAG + UDP_HEADER + IP_HEADER[family]
}

/** Linux のデバイスの既定の MTU（IPv6 の外側でも収まるよう 80 を引く） */
export const DEFAULT_MTU = 1500 - overhead('ipv6')
