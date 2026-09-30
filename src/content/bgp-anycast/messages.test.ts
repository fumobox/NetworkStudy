// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  attributeLength,
  KEEPALIVE_LENGTH,
  MARKER,
  notificationLength,
  OPEN_LENGTH,
  prefixOctets,
  updateLength,
} from './messages'

describe('BGP のメッセージの長さ（RFC 4271 §4）', () => {
  it('ヘッダーだけの KEEPALIVE は 19、Marker は 0xff が 16', () => {
    expect(KEEPALIVE_LENGTH).toBe(19)
    expect(MARKER.split(' ')).toEqual(Array.from({ length: 16 }, () => 'ff'))
  })

  it('OPEN は 29 + Capability（4 オクテットの AS 番号）の 8 = 37', () => {
    expect(OPEN_LENGTH).toBe(37)
  })

  it('経路はプレフィックス長をオクテット単位に切り上げる', () => {
    expect([0, 24, 25, 32].map(prefixOctets)).toEqual([1, 4, 5, 5])
  })

  it('属性の長さは 256 オクテットから Extended Length', () => {
    expect(attributeLength(255)).toBe(258)
    expect(attributeLength(256)).toBe(260)
  })

  it('UPDATE: /24 の広告は AS が 1・2・3 つで 47・51・55、取り下げだけなら 27', () => {
    expect(
      [1, 2, 3].map((asCount) => updateLength({ withdrawn: [], nlri: [24], asCount })),
    ).toEqual([47, 51, 55])
    expect(updateLength({ withdrawn: [24], nlri: [], asCount: 0 })).toBe(27)
  })

  it('NOTIFICATION は Data がなければ 21', () => {
    expect(notificationLength(0)).toBe(21)
  })
})
