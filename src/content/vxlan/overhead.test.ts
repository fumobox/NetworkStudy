// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fits, outerIpLength, overhead, overlayMtu, requiredUnderlayMtu } from './overhead'

describe('VXLAN のオーバーヘッド', () => {
  it('IPv4 で 50 バイト（14 + 8 + 8 + 20）、IPv6 で 70 バイト', () => {
    expect(overhead('ipv4')).toBe(50)
    expect(overhead('ipv6')).toBe(70)
  })

  it('内側の IP パケットの長さから、外側の IP パケットの長さ', () => {
    expect(outerIpLength(84)).toBe(134)
    expect(outerIpLength(1450)).toBe(1500)
    expect(outerIpLength(1500)).toBe(1550)
  })

  it('アンダーレイの MTU とオーバーレイの MTU', () => {
    expect(overlayMtu(1500)).toBe(1450)
    expect(overlayMtu(1500, 'ipv6')).toBe(1430)
    expect(overlayMtu(9000)).toBe(8950)
    expect(requiredUnderlayMtu(1500)).toBe(1550)
  })

  it('収まるかどうか', () => {
    expect(fits(1450, 1500)).toBe(true)
    expect(fits(1451, 1500)).toBe(false)
    expect(fits(1500, 1500)).toBe(false)
  })
})
