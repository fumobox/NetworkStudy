// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PROXY_V1_MAX_LENGTH, proxyV1Line } from './proxyProtocol'

describe('PROXY protocol の版 1（§2.1）', () => {
  it('仕様の例と同じ行', () => {
    expect(
      proxyV1Line({
        family: 'TCP4',
        source: '192.168.0.1',
        destination: '192.168.0.11',
        sourcePort: 56324,
        destinationPort: 443,
      }),
    ).toBe('PROXY TCP4 192.168.0.1 192.168.0.11 56324 443\r\n')
  })

  it('TCP4 のいちばん長い行は 56 文字で、最長 107 文字に収まる', () => {
    const line = proxyV1Line({
      family: 'TCP4',
      source: '255.255.255.255',
      destination: '255.255.255.255',
      sourcePort: 65535,
      destinationPort: 65535,
    })
    expect(line.length).toBe(56)
    expect(PROXY_V1_MAX_LENGTH).toBe(107)
  })

  it('範囲外のポートは受け付けない', () => {
    expect(() =>
      proxyV1Line({
        family: 'TCP4',
        source: '192.0.2.1',
        destination: '192.0.2.2',
        sourcePort: 70000,
        destinationPort: 1,
      }),
    ).toThrow(RangeError)
  })
})
