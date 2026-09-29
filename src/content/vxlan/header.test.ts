// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { encodeVxlanHeader, formatHeaderBytes, parseVxlanHeader } from './header'

describe('VXLAN のヘッダー（RFC 7348 §5）', () => {
  it('VNI 100 と 200 の 8 バイト', () => {
    expect(formatHeaderBytes(encodeVxlanHeader(100))).toBe('08 00 00 00 00 00 64 00')
    expect(formatHeaderBytes(encodeVxlanHeader(200))).toBe('08 00 00 00 00 00 c8 00')
  })

  it('Figure 3 の VNI（22、34、74、98）は 24 ビットの位置に入る', () => {
    expect([22, 34, 74, 98].map((vni) => encodeVxlanHeader(vni)[6])).toEqual([
      0x16, 0x22, 0x4a, 0x62,
    ])
  })

  it('最初の 32 ビットは 0x08000000（フラグ I だけ。Linux の VXLAN_HF_VNI = BIT(27)）', () => {
    const [a = 0, b = 0, c = 0, d = 0] = encodeVxlanHeader(0xabcdef)
    expect(((a << 24) | (b << 16) | (c << 8) | d) >>> 0).toBe(0x08000000)
    expect(encodeVxlanHeader(0xabcdef).slice(4, 7)).toEqual([0xab, 0xcd, 0xef])
  })

  it('24 ビットに収まらない VNI は例外', () => {
    expect(formatHeaderBytes(encodeVxlanHeader(0xffffff))).toBe('08 00 00 00 ff ff ff 00')
    expect(() => encodeVxlanHeader(0x1000000)).toThrow(RangeError)
    expect(() => encodeVxlanHeader(-1)).toThrow(RangeError)
    expect(() => encodeVxlanHeader(1.5)).toThrow(RangeError)
  })

  it('読むときは予約のビットを無視する', () => {
    expect(parseVxlanHeader([0xff, 0xff, 0xff, 0xff, 0, 0, 100, 0xff])).toEqual({
      ok: true,
      vni: 100,
    })
    expect(parseVxlanHeader(encodeVxlanHeader(0xabcdef))).toEqual({ ok: true, vni: 0xabcdef })
  })

  it('フラグ I が 0 なら VNI は有効でない。8 バイトに足りなければ short', () => {
    expect(parseVxlanHeader([0, 0, 0, 0, 0, 0, 100, 0])).toEqual({ ok: false, reason: 'noVni' })
    expect(parseVxlanHeader([8, 0, 0, 0, 0, 0])).toEqual({ ok: false, reason: 'short' })
  })
})
