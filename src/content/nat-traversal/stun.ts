/**
 * STUN と TURN のメッセージの値を作る純関数（RFC 8489 §5、§14、RFC 8656 §12.4、§12.5）。
 * シナリオに載せる 16 進の値を手で書かずに作り、RFC 5769 のテストベクターなどでテストする
 */

export const MAGIC_COOKIE = 0x2112a442
/** STUN のヘッダーは 20 バイト */
export const HEADER_BYTES = 20

export type StunClass = 'request' | 'indication' | 'success' | 'error'

/** クラスのビット（C1 C0）。メソッドのビットの間に挟まる */
const CLASS_BITS: Readonly<Record<StunClass, number>> = {
  request: 0b00,
  indication: 0b01,
  success: 0b10,
  error: 0b11,
}

/**
 * メッセージの型（RFC 8489 §5）。14 ビットのうち、メソッドの 12 ビットの間にクラスの 2 ビット（C0 は 4 ビット目、C1 は 8 ビット目）を挟む。
 * 例: Binding（0x001）の Request は 0x0001、Success Response は 0x0101
 */
export function messageType(method: number, cls: StunClass): number {
  const c = CLASS_BITS[cls]
  const c0 = c & 0b01
  const c1 = (c >> 1) & 0b01
  return (
    ((method & 0xf80) << 2) | (c1 << 8) | ((method & 0x070) << 1) | (c0 << 4) | (method & 0x00f)
  )
}

export function hex16(value: number): string {
  return `0x${value.toString(16).padStart(4, '0')}`
}

export function hex(bytes: readonly number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join(' ')
}

function ipv4Bytes(ip: string): number[] {
  return ip.split('.').map((part) => Number(part))
}

/** IPv4 の XOR-MAPPED-ADDRESS などの値（8 バイト: 予約 0、ファミリー 0x01、X-Port、X-Address。RFC 8489 §14.2） */
export function xorAddress(ip: string, port: number): number[] {
  const xPort = port ^ (MAGIC_COOKIE >>> 16)
  const cookie = [0x21, 0x12, 0xa4, 0x42]
  const xAddress = ipv4Bytes(ip).map((byte, i) => byte ^ (cookie[i] ?? 0))
  return [0x00, 0x01, (xPort >> 8) & 0xff, xPort & 0xff, ...xAddress]
}

/** xorAddress の逆（受け取った値を元に戻す） */
export function decodeXorAddress(value: readonly number[]): { ip: string; port: number } {
  const xPort = ((value[2] ?? 0) << 8) | (value[3] ?? 0)
  const cookie = [0x21, 0x12, 0xa4, 0x42]
  const ip = [4, 5, 6, 7].map((i, j) => (value[i] ?? 0) ^ (cookie[j] ?? 0)).join('.')
  return { ip, port: xPort ^ (MAGIC_COOKIE >>> 16) }
}

/** 属性の長さ（4 バイトの TLV のヘッダーと、4 バイトの境界までの詰め物を含む。RFC 8489 §14） */
export function attributeSize(valueLength: number): number {
  return 4 + Math.ceil(valueLength / 4) * 4
}

/** ヘッダーの Message Length（ヘッダーの 20 バイトを含まない。RFC 8489 §5） */
export function messageLength(valueLengths: readonly number[]): number {
  return valueLengths.reduce((sum, length) => sum + attributeSize(length), 0)
}

/** 20 バイトのヘッダー（型、長さ、マジッククッキー、96 ビットのトランザクション ID） */
export function stunHeader(
  type: number,
  length: number,
  transactionId: readonly number[],
): number[] {
  return [
    (type >> 8) & 0xff,
    type & 0xff,
    (length >> 8) & 0xff,
    length & 0xff,
    0x21,
    0x12,
    0xa4,
    0x42,
    ...transactionId,
  ]
}

/** 16 進の文字列（24 桁）のトランザクション ID をバイト列にする */
export function transactionIdBytes(id: string): number[] {
  const bytes: number[] = []
  for (let i = 0; i < id.length; i += 2) bytes.push(Number.parseInt(id.slice(i, i + 2), 16))
  return bytes
}

/** ChannelData のヘッダー（4 バイト: チャネル番号と長さ。RFC 8656 §12.4） */
export function channelDataHeader(channel: number, length: number): number[] {
  return [(channel >> 8) & 0xff, channel & 0xff, (length >> 8) & 0xff, length & 0xff]
}

/** TCP・TLS の上では、ChannelData を 4 バイトの倍数に詰める（RFC 8656 §12.5） */
export function paddedSize(size: number): number {
  return Math.ceil(size / 4) * 4
}

/** CRC-32（IEEE 802.3、FINGERPRINT に使う） */
export function crc32(bytes: readonly number[]): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** FINGERPRINT の値: CRC-32 と 0x5354554e の XOR（RFC 8489 §14.7） */
export function fingerprint(bytesBeforeFingerprint: readonly number[]): number {
  return (crc32(bytesBeforeFingerprint) ^ 0x5354554e) >>> 0
}
