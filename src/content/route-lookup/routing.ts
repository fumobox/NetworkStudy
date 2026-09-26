/**
 * 経路表の検索（最長一致）。アドレスは subnet.ts と同じく 32 ビットの符号なし整数で扱う。
 *
 * 根拠:
 * - RFC 1812 §5.2.4.3（Next Hop Address）: 宛先に一致する経路のうち、プレフィックスがいちばん長いものを選ぶ（Longest Match）。
 *   同じ長さならメトリックの小さいもの（Best Metric）。一致する経路がなければ、ICMP Destination Unreachable を返す
 * - RFC 1812 §4.3.3.1: 経路がないときの ICMP Destination Unreachable（code 0 = network unreachable）
 * - RFC 4632 §5.1: CIDR の経路の集約と「最長一致」
 * - RFC 1122 §3.3.1: ホスト（PC）自身の経路の判断（同じネットワークなら直接、それ以外はデフォルトゲートウェイ）
 *
 * 学習用の単純化: 同じ長さ・同じメトリックなら表の順で先の経路を選ぶ（このツールの決まり）。
 * アドミニストレーティブディスタンス、ECMP（RFC 2991）、動的なルーティングプロトコル、TOS は扱わない
 */
import { z } from 'zod'
import { isPrefixLength, networkOf, parseIPv4 } from '../subnet-calculator/subnet'

export const INTERFACES = ['lan', 'wan'] as const
export type Interface = (typeof INTERFACES)[number]

export interface Route {
  readonly id: string
  /** ネットワークアドレス（ホスト部は 0） */
  readonly network: number
  /** プレフィックス長（0〜32） */
  readonly length: number
  /** 次に送るルーターのアドレス。null は直接接続（宛先そのものに送る） */
  readonly nextHop: number | null
  readonly iface: Interface
  readonly metric: number
  readonly enabled: boolean
}

export interface ParsedPrefix {
  readonly network: number
  readonly length: number
  /** ホスト部に 1 が立っていて、0 にした（192.168.1.10/24 → 192.168.1.0/24） */
  readonly hostBitsCleared: boolean
}

/** `a.b.c.d/n` を解析し、ホスト部を 0 にする。不正なら null */
export function parsePrefix(text: string): ParsedPrefix | null {
  const [addressText, lengthText, ...rest] = text.split('/')
  if (addressText === undefined || lengthText === undefined || rest.length > 0) {
    return null
  }
  const address = parseIPv4(addressText)
  const length = /^(0|[1-9]\d?)$/.test(lengthText) ? Number(lengthText) : Number.NaN
  if (address === null || !isPrefixLength(length)) {
    return null
  }
  const network = networkOf(address, length)
  return { network, length, hostBitsCleared: network !== address }
}

/** 宛先がこの経路のネットワークに入るか（/0 はすべてに一致する） */
export function routeMatches(route: Pick<Route, 'network' | 'length'>, address: number): boolean {
  return networkOf(address, route.length) === route.network
}

/** 2 つのアドレスの先頭から一致しているビットの数（0〜32） */
export function commonPrefixLength(a: number, b: number): number {
  return Math.clz32((a ^ b) >>> 0)
}

export const LOOKUP_REASONS = ['longest', 'metric', 'order', 'default', 'none'] as const
export type LookupReason = (typeof LOOKUP_REASONS)[number]

export interface LookupResult {
  /** 宛先に一致した有効な経路（表の順） */
  readonly candidates: readonly Route[]
  readonly selected: Route | null
  /**
   * 選んだ理由。longest: いちばん長い一致、metric: 同じ長さの中でメトリックが小さい、order: 長さもメトリックも同じで表の順、
   * default: 一致したのがデフォルト経路（/0）だけ、none: 一致する経路がない
   */
  readonly reason: LookupReason
}

/** 経路表から、宛先に使う経路を選ぶ（RFC 1812 §5.2.4.3） */
export function lookupRoute(table: readonly Route[], address: number): LookupResult {
  const candidates = table.filter((route) => route.enabled && routeMatches(route, address))
  const longestLength = Math.max(...candidates.map((route) => route.length))
  const longest = candidates.filter((route) => route.length === longestLength)
  const [first] = longest
  if (first === undefined) {
    return { candidates, selected: null, reason: 'none' }
  }
  if (longest.length === 1) {
    return { candidates, selected: first, reason: longestLength === 0 ? 'default' : 'longest' }
  }
  const bestMetric = Math.min(...longest.map((route) => route.metric))
  const best = longest.filter((route) => route.metric === bestMetric)
  const [winner = first] = best
  return { candidates, selected: winner, reason: best.length === 1 ? 'metric' : 'order' }
}

export interface NextHop {
  /** 次にフレームを送る相手の IP アドレス（ARP で MAC アドレスを調べる相手） */
  readonly address: number
  /** 直接接続のネットワーク（宛先そのものに送る） */
  readonly onLink: boolean
}

export function nextHopOf(route: Route, destination: number): NextHop {
  return route.nextHop === null
    ? { address: destination, onLink: true }
    : { address: route.nextHop, onLink: false }
}

/** 表の定義用: 正しいとわかっている表記から経路を作る（誤りはモジュールの読み込み時に気づけるよう例外にする） */
function route(
  id: string,
  prefix: string,
  nextHop: string | null,
  iface: Interface,
  metric: number,
): Route {
  const parsed = parsePrefix(prefix)
  const hop = nextHop === null ? null : parseIPv4(nextHop)
  if (parsed === null || parsed.hostBitsCleared || (nextHop !== null && hop === null)) {
    throw new Error(`invalid route ${id}: ${prefix} via ${String(nextHop)}`)
  }
  return {
    id,
    network: parsed.network,
    length: parsed.length,
    nextHop: hop,
    iface,
    metric,
    enabled: true,
  }
}

export const ROUTE_TABLE_IDS = ['pc', 'router'] as const
export type RouteTableId = (typeof ROUTE_TABLE_IDS)[number]

/**
 * 用意した経路表。pc は PC（192.168.1.10）自身、router は家庭のルーター（LAN 192.168.1.1、WAN 203.0.113.5）。
 * router には、最長一致・デフォルト経路・ホスト経路・メトリックの比較を見せるための経路も入れてある
 */
export const ROUTE_TABLES: Readonly<Record<RouteTableId, readonly Route[]>> = {
  pc: [
    route('pc-lan', '192.168.1.0/24', null, 'lan', 0),
    route('pc-default', '0.0.0.0/0', '192.168.1.1', 'lan', 0),
  ],
  router: [
    route('default', '0.0.0.0/0', '203.0.113.1', 'wan', 10),
    route('lan', '192.168.1.0/24', null, 'lan', 0),
    route('wan', '203.0.113.0/24', null, 'wan', 0),
    route('aggregate', '192.168.0.0/16', '192.168.1.2', 'lan', 0),
    route('branch', '192.168.2.0/24', '192.168.1.3', 'lan', 0),
    route('host', '192.0.2.10/32', '203.0.113.254', 'wan', 0),
    route('ten-a', '10.0.0.0/8', '203.0.113.1', 'wan', 20),
    route('ten-b', '10.0.0.0/8', '203.0.113.254', 'wan', 10),
  ],
}

export const DEFAULT_DESTINATION = '192.0.2.10'
export const DEFAULT_TABLE: RouteTableId = 'router'

/** URL のクエリ（`?dst=192.0.2.10&table=router`）。欠けた値や不正な値は既定値にする */
export const routeQuerySchema = z.object({
  dst: z
    .string()
    .refine((text) => parseIPv4(text) !== null)
    .catch(DEFAULT_DESTINATION),
  table: z.enum(ROUTE_TABLE_IDS).catch(DEFAULT_TABLE),
})

export type RouteQuery = z.infer<typeof routeQuerySchema>

export function readRouteQuery(params: URLSearchParams): RouteQuery {
  return routeQuerySchema.parse({
    dst: params.get('dst') ?? undefined,
    table: params.get('table') ?? undefined,
  })
}

/** プレフィックスの表記（`192.168.1.0/24`） */
export function formatPrefix(
  route: Pick<Route, 'network' | 'length'>,
  format: (value: number) => string,
): string {
  return `${format(route.network)}/${String(route.length)}`
}
