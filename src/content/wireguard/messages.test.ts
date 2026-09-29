// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  COOKIE_REPLY_LAYOUT,
  dataMessageLength,
  DEFAULT_MTU,
  INITIATION_LAYOUT,
  layoutLength,
  outerIpLength,
  overhead,
  paddedLength,
  RESPONSE_LAYOUT,
} from './messages'

describe('WireGuard のメッセージの大きさ', () => {
  it('ハンドシェイクのメッセージは 148、92、64 バイト', () => {
    expect(layoutLength(INITIATION_LAYOUT)).toBe(148)
    expect(layoutLength(RESPONSE_LAYOUT)).toBe(92)
    expect(layoutLength(COOKIE_REPLY_LAYOUT)).toBe(64)
  })

  it('データは 16 の倍数まで詰め、MTU は超えない', () => {
    expect(paddedLength(0, 1420)).toBe(0)
    expect(paddedLength(1, 1420)).toBe(16)
    expect(paddedLength(84, 1420)).toBe(96)
    expect(paddedLength(1419, 1420)).toBe(1420)
    expect(paddedLength(1420, 1420)).toBe(1420)
  })

  it('キープアライブは 32 バイト、84 バイトの ping は 128 バイト', () => {
    expect(dataMessageLength(0, 1420)).toBe(32)
    expect(dataMessageLength(84, 1420)).toBe(128)
    expect(dataMessageLength(1420, 1420)).toBe(1452)
  })

  it('外側の IP パケットとオーバーヘッド', () => {
    expect(outerIpLength(128)).toBe(156)
    expect(outerIpLength(148)).toBe(176)
    expect(outerIpLength(32)).toBe(60)
    expect(outerIpLength(dataMessageLength(1420, 1420))).toBe(1480)
    expect(outerIpLength(dataMessageLength(1420, 1420), 'ipv6')).toBe(1500)
    expect(overhead('ipv4')).toBe(60)
    expect(overhead('ipv6')).toBe(80)
    expect(DEFAULT_MTU).toBe(1420)
  })
})
