/**
 * WebSocket のフレームのヘッダーとマスクを作る純関数（RFC 6455 §5.2、§5.3）。
 * シナリオに載せるバイト列を手で書かずに作り、RFC 6455 §5.7 の例でテストする
 */

export const OPCODES = {
  continuation: 0x0,
  text: 0x1,
  binary: 0x2,
  close: 0x8,
  ping: 0x9,
  pong: 0xa,
} as const
export type Opcode = keyof typeof OPCODES

export type MaskingKey = readonly [number, number, number, number]

export interface FrameSpec {
  readonly fin: boolean
  readonly opcode: Opcode
  readonly length: number
  /** クライアントからのフレームだけ（§5.1） */
  readonly maskingKey?: MaskingKey
}

/** ペイロード長の表現（§5.2: 125 以下は 7 ビット、65535 以下は 126 + 16 ビット、それより大きければ 127 + 64 ビット） */
export type LengthEncoding = '7-bit' | '7+16-bit' | '7+64-bit'

export function lengthEncoding(length: number): LengthEncoding {
  if (length <= 125) return '7-bit'
  if (length <= 0xffff) return '7+16-bit'
  return '7+64-bit'
}

/** 大きい順のバイト列（ネットワークバイトオーダー） */
function bigEndian(value: number, bytes: number): number[] {
  const result: number[] = []
  let rest = value
  for (let i = 0; i < bytes; i++) {
    result.unshift(rest % 256)
    rest = Math.floor(rest / 256)
  }
  return result
}

/** フレームのヘッダー（FIN・RSV・opcode、MASK・長さ、延長の長さ、マスクキー）。RSV1〜3 は 0（拡張なし） */
export function frameHeader(spec: FrameSpec): number[] {
  const first = (spec.fin ? 0x80 : 0) | OPCODES[spec.opcode]
  const mask = spec.maskingKey === undefined ? 0 : 0x80
  const encoding = lengthEncoding(spec.length)
  const lengthBytes =
    encoding === '7-bit'
      ? [mask | spec.length]
      : encoding === '7+16-bit'
        ? [mask | 126, ...bigEndian(spec.length, 2)]
        : [mask | 127, ...bigEndian(spec.length, 8)]
  return [first, ...lengthBytes, ...(spec.maskingKey ?? [])]
}

/** マスク（§5.3: i 番目のバイトとキーの i mod 4 番目のバイトの XOR）。もう一度かけると元に戻る */
export function maskPayload(payload: readonly number[], key: MaskingKey): number[] {
  return payload.map((byte, i) => byte ^ (key[i % 4] ?? 0))
}

export function utf8(text: string): number[] {
  return Array.from(new TextEncoder().encode(text))
}

/** Close のペイロード: 2 バイトのステータスコード（と理由） */
export function closePayload(code: number): number[] {
  return bigEndian(code, 2)
}

export function hex(bytes: readonly number[]): string {
  return bytes.map((byte) => `0x${byte.toString(16).padStart(2, '0')}`).join(' ')
}
