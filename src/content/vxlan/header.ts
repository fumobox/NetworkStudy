/**
 * VXLAN のヘッダー（RFC 7348 §5 の Figure 1）。8 バイトで、最初のバイトのフラグ I（0x08）が 1 なら VNI が有効。
 * VNI は 4〜6 バイト目の 24 ビット。ほかのビットは予約で、送るときは 0 にし、受け取ったときは無視する（§5）。
 *
 * RFC 7348 にバイト列の例はないので、テストは Figure 1 のビットの並びと、Figure 3 の VNI（22、34、74、98）で確かめる。
 * Linux の include/net/vxlan.h の VXLAN_HF_VNI（BIT(27)。最初の 32 ビットの 0x08000000）とも一致する
 */

export const VXLAN_HEADER_LENGTH = 8
export const I_FLAG = 0x08
export const MAX_VNI = 0xffffff

export function encodeVxlanHeader(vni: number): readonly number[] {
  if (!Number.isInteger(vni) || vni < 0 || vni > MAX_VNI) {
    throw new RangeError(`VNI は 0〜${String(MAX_VNI)} の整数: ${String(vni)}`)
  }
  return [I_FLAG, 0, 0, 0, (vni >> 16) & 0xff, (vni >> 8) & 0xff, vni & 0xff, 0]
}

export type ParsedVxlanHeader =
  | { readonly ok: true; readonly vni: number }
  /** short: 8 バイトに足りない。noVni: フラグ I が 0（RFC 7348 は受け取った側の扱いを決めていない） */
  | { readonly ok: false; readonly reason: 'short' | 'noVni' }

export function parseVxlanHeader(bytes: readonly number[]): ParsedVxlanHeader {
  const [flags, , , , high, middle, low] = bytes
  if (
    bytes.length < VXLAN_HEADER_LENGTH ||
    flags === undefined ||
    high === undefined ||
    middle === undefined ||
    low === undefined
  ) {
    return { ok: false, reason: 'short' }
  }
  if ((flags & I_FLAG) === 0) {
    return { ok: false, reason: 'noVni' }
  }
  return { ok: true, vni: (high << 16) | (middle << 8) | low }
}

export function formatHeaderBytes(bytes: readonly number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join(' ')
}
