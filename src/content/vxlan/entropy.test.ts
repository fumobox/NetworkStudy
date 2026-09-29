// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  ecmpIndex,
  fnv1a,
  SOURCE_PORT_MAX,
  SOURCE_PORT_MIN,
  sourcePort,
  type FlowTuple,
} from './entropy'

const flow = (srcPort: number, dstPort: number): FlowTuple => ({
  proto: 'TCP',
  srcIp: '10.0.0.1',
  srcPort,
  dstIp: '10.0.0.2',
  dstPort,
})

describe('外側の送信元ポート', () => {
  it('FNV-1a の既知の値', () => {
    expect(fnv1a('')).toBe(0x811c9dc5)
    expect(fnv1a('a')).toBe(0xe40c292c)
  })

  it('同じ流れはいつも同じポートで、推奨の範囲に入る', () => {
    for (let port = 40000; port < 40050; port++) {
      const chosen = sourcePort(flow(port, 443))
      expect(chosen).toBe(sourcePort(flow(port, 443)))
      expect(chosen).toBeGreaterThanOrEqual(SOURCE_PORT_MIN)
      expect(chosen).toBeLessThanOrEqual(SOURCE_PORT_MAX)
    }
  })

  it('経路の番号は 0 から本数 − 1', () => {
    for (let port = 40000; port < 40050; port++) {
      const index = ecmpIndex(flow(port, 4789), 2)
      expect([0, 1]).toContain(index)
    }
  })
})
