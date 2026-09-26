// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { formatIPv4, parseIPv4 } from '../subnet-calculator/subnet'
import {
  commonPrefixLength,
  lookupRoute,
  nextHopOf,
  parsePrefix,
  readRouteQuery,
  ROUTE_TABLES,
  routeMatches,
  type Route,
} from './routing'

function ip(text: string): number {
  const value = parseIPv4(text)
  if (value === null) throw new Error(`invalid address in test: ${text}`)
  return value
}

const router = ROUTE_TABLES.router
const lookup = (address: string, table: readonly Route[] = router) => {
  const result = lookupRoute(table, ip(address))
  return {
    selected: result.selected?.id ?? null,
    reason: result.reason,
    candidates: result.candidates.map((route) => route.id),
  }
}

describe('parsePrefix', () => {
  it('ネットワークとプレフィックス長を読み、ホスト部を 0 にする', () => {
    expect(parsePrefix('192.168.1.0/24')).toEqual({
      network: ip('192.168.1.0'),
      length: 24,
      hostBitsCleared: false,
    })
    expect(parsePrefix('192.168.1.10/24')).toEqual({
      network: ip('192.168.1.0'),
      length: 24,
      hostBitsCleared: true,
    })
    expect(parsePrefix('0.0.0.0/0')).toEqual({ network: 0, length: 0, hostBitsCleared: false })
    expect(parsePrefix('192.0.2.10/32')?.network).toBe(ip('192.0.2.10'))
  })

  it.each([
    '',
    '192.168.1.0',
    '192.168.1.0/33',
    '192.168.1.0/-1',
    '192.168.1.0/08',
    '256.0.0.0/8',
    '1.2.3.4/8/9',
  ])('不正な表記 %j は null', (text) => {
    expect(parsePrefix(text)).toBeNull()
  })
})

describe('routeMatches / commonPrefixLength', () => {
  it('/0 はすべてに一致し、/32 はそのアドレスだけに一致する', () => {
    expect(routeMatches({ network: 0, length: 0 }, ip('8.8.8.8'))).toBe(true)
    expect(routeMatches({ network: ip('192.0.2.10'), length: 32 }, ip('192.0.2.10'))).toBe(true)
    expect(routeMatches({ network: ip('192.0.2.10'), length: 32 }, ip('192.0.2.11'))).toBe(false)
  })

  it('先頭から一致しているビットの数', () => {
    expect(commonPrefixLength(ip('192.168.2.5'), ip('192.168.2.0'))).toBe(29)
    expect(commonPrefixLength(ip('192.168.1.1'), ip('192.168.1.1'))).toBe(32)
    expect(commonPrefixLength(ip('0.0.0.0'), ip('128.0.0.0'))).toBe(0)
  })
})

describe('lookupRoute（RFC 1812 §5.2.4.3）', () => {
  it.each([
    // [宛先, 選ばれる経路, 理由, 一致した経路]
    ['192.168.1.20', 'lan', 'longest', ['default', 'lan', 'aggregate']],
    ['192.168.2.5', 'branch', 'longest', ['default', 'aggregate', 'branch']],
    ['192.168.7.1', 'aggregate', 'longest', ['default', 'aggregate']],
    ['192.0.2.10', 'host', 'longest', ['default', 'host']],
    ['192.0.2.53', 'default', 'default', ['default']],
    ['10.1.2.3', 'ten-b', 'metric', ['default', 'ten-a', 'ten-b']],
    ['203.0.113.1', 'wan', 'longest', ['default', 'wan']],
    ['192.168.1.255', 'lan', 'longest', ['default', 'lan', 'aggregate']],
    ['0.0.0.0', 'default', 'default', ['default']],
  ] as const)('%s → %s（%s）', (address, selected, reason, candidates) => {
    expect(lookup(address)).toEqual({ selected, reason, candidates })
  })

  it('デフォルト経路を無効にすると、一致する経路がない', () => {
    const table = router.map((route) =>
      route.id === 'default' ? { ...route, enabled: false } : route,
    )
    expect(lookup('198.51.100.53', table)).toEqual({
      selected: null,
      reason: 'none',
      candidates: [],
    })
    // 一致する経路がほかにあれば、そちらが選ばれる
    expect(lookup('192.0.2.10', table).selected).toBe('host')
  })

  it('ホスト経路を無効にすると、デフォルト経路に戻る', () => {
    const table = router.map((route) =>
      route.id === 'host' ? { ...route, enabled: false } : route,
    )
    expect(lookup('192.0.2.10', table)).toMatchObject({ selected: 'default', reason: 'default' })
  })

  it('長さもメトリックも同じなら、表で先の経路（このツールの決まり）', () => {
    const table = router.map((route) => (route.id === 'ten-a' ? { ...route, metric: 10 } : route))
    expect(lookup('10.1.2.3', table)).toMatchObject({ selected: 'ten-a', reason: 'order' })
  })

  it('すべて無効なら経路なし', () => {
    const table = router.map((route) => ({ ...route, enabled: false }))
    expect(lookup('192.168.1.20', table).reason).toBe('none')
  })
})

describe('nextHopOf', () => {
  it('直接接続なら宛先そのもの、そうでなければ次のルーター', () => {
    const lan = router.find((route) => route.id === 'lan')
    const host = router.find((route) => route.id === 'host')
    if (lan === undefined || host === undefined) throw new Error('missing route')
    expect(nextHopOf(lan, ip('192.168.1.20'))).toEqual({
      address: ip('192.168.1.20'),
      onLink: true,
    })
    expect(nextHopOf(host, ip('192.0.2.10'))).toEqual({
      address: ip('203.0.113.254'),
      onLink: false,
    })
  })
})

describe('用意した経路表', () => {
  it('PC の表: 同じ LAN は直接、それ以外はデフォルトゲートウェイ（RFC 1122 §3.3.1）', () => {
    const pc = ROUTE_TABLES.pc
    expect(lookup('192.168.1.20', pc)).toMatchObject({ selected: 'pc-lan', reason: 'longest' })
    const result = lookupRoute(pc, ip('192.0.2.10'))
    expect(result.reason).toBe('default')
    expect(
      result.selected === null
        ? null
        : formatIPv4(nextHopOf(result.selected, ip('192.0.2.10')).address),
    ).toBe('192.168.1.1')
  })

  it('どの経路もホスト部が 0 で、id が重ならない', () => {
    for (const table of Object.values(ROUTE_TABLES)) {
      for (const route of table) {
        expect(routeMatches(route, route.network), route.id).toBe(true)
      }
      expect(new Set(table.map((route) => route.id)).size).toBe(table.length)
    }
  })
})

describe('readRouteQuery', () => {
  it('正しい値はそのまま、欠けた値や不正な値は既定値', () => {
    expect(readRouteQuery(new URLSearchParams('dst=10.1.2.3&table=pc'))).toEqual({
      dst: '10.1.2.3',
      table: 'pc',
    })
    expect(readRouteQuery(new URLSearchParams('dst=999.1.1.1&table=isp'))).toEqual({
      dst: '192.0.2.10',
      table: 'router',
    })
    expect(readRouteQuery(new URLSearchParams(''))).toEqual({ dst: '192.0.2.10', table: 'router' })
  })
})
