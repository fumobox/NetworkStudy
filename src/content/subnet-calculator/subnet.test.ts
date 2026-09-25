// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  addressClassOf,
  broadcastOf,
  describeSubnet,
  formatIPv4,
  hostRange,
  isPrefixLength,
  isPrivate,
  maskFromPrefix,
  networkOf,
  parseIPv4,
  prefixFromMask,
  readSubnetQuery,
  toBinaryOctets,
  wildcardOf,
} from './subnet'

/** テスト用: 正しい表記だとわかっているアドレスを整数にする */
function ip(text: string): number {
  const value = parseIPv4(text)
  if (value === null) {
    throw new Error(`invalid address in test: ${text}`)
  }
  return value
}

describe('parseIPv4 / formatIPv4', () => {
  it.each(['0.0.0.0', '192.168.1.10', '10.0.0.1', '255.255.255.255'])('%s を往復できる', (text) => {
    expect(formatIPv4(ip(text))).toBe(text)
  })

  it('32 ビットの符号なし整数になる', () => {
    expect(parseIPv4('255.255.255.255')).toBe(0xffffffff)
    expect(parseIPv4('192.168.1.10')).toBe(0xc0a8010a)
    expect(parseIPv4('0.0.0.0')).toBe(0)
  })

  it.each([
    '',
    '256.1.1.1',
    '1.2.3',
    '1.2.3.4.5',
    '1.2.3.-4',
    ' 1.2.3.4',
    '1.2.3.4 ',
    '1..3.4',
    '01.2.3.4',
    '1.2.3.4a',
    '１.2.3.4',
    '1e2.0.0.1',
  ])('不正な表記 %j は null', (text) => {
    expect(parseIPv4(text)).toBeNull()
  })
})

describe('マスクとプレフィックス長', () => {
  it.each([
    [0, '0.0.0.0', '255.255.255.255'],
    [8, '255.0.0.0', '0.255.255.255'],
    [24, '255.255.255.0', '0.0.0.255'],
    [26, '255.255.255.192', '0.0.0.63'],
    [31, '255.255.255.254', '0.0.0.1'],
    [32, '255.255.255.255', '0.0.0.0'],
  ])('/%i のマスクは %s、ワイルドカードは %s', (prefix, mask, wildcard) => {
    expect(formatIPv4(maskFromPrefix(prefix))).toBe(mask)
    expect(formatIPv4(wildcardOf(prefix))).toBe(wildcard)
    expect(prefixFromMask(maskFromPrefix(prefix))).toBe(prefix)
  })

  it('1 が連続していないマスクはプレフィックス長にならない', () => {
    expect(prefixFromMask(ip('255.0.255.0'))).toBeNull()
    expect(prefixFromMask(ip('0.255.255.255'))).toBeNull()
  })

  it('プレフィックス長は 0〜32 の整数', () => {
    expect([0, 24, 32].map(isPrefixLength)).toEqual([true, true, true])
    expect([-1, 33, 24.5, Number.NaN].map(isPrefixLength)).toEqual([false, false, false, false])
  })
})

describe('ネットワーク・ブロードキャスト・ホストの範囲', () => {
  it.each([
    // [アドレス, プレフィックス長, ネットワーク, ブロードキャスト, 最初のホスト, 最後のホスト, ホスト数]
    ['192.168.1.10', 24, '192.168.1.0', '192.168.1.255', '192.168.1.1', '192.168.1.254', 254],
    ['192.168.1.130', 26, '192.168.1.128', '192.168.1.191', '192.168.1.129', '192.168.1.190', 62],
    ['10.20.30.40', 8, '10.0.0.0', '10.255.255.255', '10.0.0.1', '10.255.255.254', 16777214],
    ['172.16.5.4', 30, '172.16.5.4', '172.16.5.7', '172.16.5.5', '172.16.5.6', 2],
    // RFC 3021: /31 は 2 つのアドレスを両方ともホストに使う
    ['203.0.113.7', 31, '203.0.113.6', '203.0.113.7', '203.0.113.6', '203.0.113.7', 2],
    ['203.0.113.7', 32, '203.0.113.7', '203.0.113.7', '203.0.113.7', '203.0.113.7', 1],
    ['203.0.113.7', 0, '0.0.0.0', '255.255.255.255', '0.0.0.1', '255.255.255.254', 4294967294],
  ] as const)(
    '%s/%i → ネットワーク %s、ブロードキャスト %s、ホスト %s〜%s（%i 個）',
    (address, prefix, network, broadcast, first, last, count) => {
      expect(formatIPv4(networkOf(ip(address), prefix))).toBe(network)
      expect(formatIPv4(broadcastOf(ip(address), prefix))).toBe(broadcast)
      const hosts = hostRange(ip(address), prefix)
      expect([formatIPv4(hosts.first), formatIPv4(hosts.last), hosts.count]).toEqual([
        first,
        last,
        count,
      ])
    },
  )

  it('上位ビットが立ったアドレスでも符号なしのまま計算する', () => {
    const info = describeSubnet(ip('255.255.255.255'), 24)
    expect(info.network).toBe(0xffffff00)
    expect(info.broadcast).toBe(0xffffffff)
    expect(info.network).toBeGreaterThan(0)
  })
})

describe('2 進表記・クラス・プライベートアドレス', () => {
  it('8 ビットずつの 2 進表記', () => {
    expect(toBinaryOctets(ip('192.168.1.10'))).toEqual([
      '11000000',
      '10101000',
      '00000001',
      '00001010',
    ])
    expect(toBinaryOctets(0)).toEqual(['00000000', '00000000', '00000000', '00000000'])
  })

  it.each([
    ['0.0.0.0', 'A'],
    ['127.255.255.255', 'A'],
    ['128.0.0.0', 'B'],
    ['191.255.0.0', 'B'],
    ['192.0.0.0', 'C'],
    ['223.255.255.0', 'C'],
    ['224.0.0.1', 'D'],
    ['239.255.255.255', 'D'],
    ['240.0.0.0', 'E'],
    ['255.255.255.255', 'E'],
  ] as const)('%s はクラス %s', (address, expected) => {
    expect(addressClassOf(ip(address))).toBe(expected)
  })

  it.each([
    ['10.0.0.0', true],
    ['10.255.255.255', true],
    ['9.255.255.255', false],
    ['11.0.0.0', false],
    ['172.16.0.0', true],
    ['172.31.255.255', true],
    ['172.15.255.255', false],
    ['172.32.0.0', false],
    ['192.168.0.0', true],
    ['192.168.255.255', true],
    ['192.169.0.0', false],
    ['8.8.8.8', false],
  ] as const)('%s はプライベートアドレスか: %s', (address, expected) => {
    expect(isPrivate(ip(address))).toBe(expected)
  })
})

describe('readSubnetQuery', () => {
  it('正しい値はそのまま読む', () => {
    expect(readSubnetQuery(new URLSearchParams('ip=10.0.0.1&prefix=8'))).toEqual({
      ip: '10.0.0.1',
      prefix: 8,
    })
    expect(readSubnetQuery(new URLSearchParams('ip=0.0.0.0&prefix=0'))).toEqual({
      ip: '0.0.0.0',
      prefix: 0,
    })
  })

  it.each(['', 'ip=256.0.0.1&prefix=33', 'ip=&prefix=', 'prefix=24.5', 'prefix=-1', 'prefix=08'])(
    '欠けた値や不正な値（%j）は既定値',
    (query) => {
      const result = readSubnetQuery(new URLSearchParams(query))
      expect(result).toEqual({ ip: '192.168.1.10', prefix: 24 })
    },
  )
})
