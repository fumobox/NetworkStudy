// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { addAllowedIp, inboundAllowed, lookupPeer, outboundPeer, type AllowedIp } from './cryptokey'

const SERVER: readonly AllowedIp[] = [
  { prefix: '10.8.0.2/32', peer: 'laptop' },
  { prefix: '10.8.0.3/32', peer: 'phone' },
]

describe('暗号鍵ルーティング', () => {
  it('送るときは宛先でピアを選び、なければ null', () => {
    expect(outboundPeer(SERVER, '10.8.0.2')).toBe('laptop')
    expect(outboundPeer(SERVER, '10.8.0.9')).toBeNull()
  })

  it('受け取ったときは、内側の送信元がそのピアのものか', () => {
    expect(inboundAllowed(SERVER, 'laptop', '10.8.0.2')).toBe(true)
    expect(inboundAllowed(SERVER, 'laptop', '10.8.0.3')).toBe(false)
    expect(inboundAllowed(SERVER, 'laptop', '10.10.0.20')).toBe(false)
  })

  it('範囲に入っていても、より長い一致が別のピアなら受け入れない', () => {
    const table: readonly AllowedIp[] = [
      { prefix: '10.0.0.0/8', peer: 'a' },
      { prefix: '10.1.0.0/16', peer: 'b' },
    ]
    expect(inboundAllowed(table, 'a', '10.2.3.4')).toBe(true)
    expect(inboundAllowed(table, 'a', '10.1.2.3')).toBe(false)
    expect(lookupPeer(table, '10.1.2.3')?.peer).toBe('b')
  })

  it('0.0.0.0/0 はすべてに当たる（フルトンネル）', () => {
    expect(outboundPeer([{ prefix: '0.0.0.0/0', peer: 'server' }], '93.184.215.14')).toBe('server')
  })

  it('同じ範囲を別のピアに足すと、そちらに移る', () => {
    const moved = addAllowedIp(SERVER, { prefix: '10.8.0.3/32', peer: 'laptop' })
    expect(outboundPeer(moved, '10.8.0.3')).toBe('laptop')
    expect(moved.filter((entry) => entry.prefix === '10.8.0.3/32')).toHaveLength(1)
  })
})
