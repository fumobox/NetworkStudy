/**
 * IPv6 アドレスの計算（DOM に依存しない純関数）
 *
 * 根拠:
 * - RFC 4291 §2.2（テキストの表記: 16 ビットずつ 8 つの 16 進、:: で 0 の続きを 1 回だけ省ける、末尾の 32 ビットを IPv4 の表記で書ける）、
 *   §2.4（種類）、§2.5.2（::）、§2.5.3（::1）、§2.5.5.2（::ffff:0:0/96）、§2.5.6（fe80::/10）、§2.7（マルチキャスト ff00::/8 と
 *   scope）、§2.7.1（ff02::1、ff02::2、要請ノードマルチキャスト ff02::1:ff00:0/104）、付録 A（MAC アドレスから EUI-64 の
 *   インターフェース ID を作る。ff:fe を挟み、U/L ビットを反転する）
 * - RFC 5952 §4.1（先頭の 0 を省く）、§4.2.1（:: はいちばん長い 0 の続きに使う）、§4.2.2（0 が 1 つだけなら :: にしない）、
 *   §4.2.3（同じ長さなら最初の続き）、§4.3（小文字）、§5（IPv4 射影アドレスは末尾を IPv4 の表記で書く）
 * - RFC 4193（ユニークローカル fc00::/7）、RFC 3849（文書用 2001:db8::/32）、RFC 9637（文書用 3fff::/20）、
 *   RFC 3587・IANA（グローバルユニキャストは 2000::/3 から割り当てている）
 * - RFC 2464 §4（Ethernet の MAC アドレスからのインターフェース ID）、§7（マルチキャストの MAC アドレスは 33:33 と下位 32 ビット）
 *
 * 学習用の単純化: ゾーン ID（%eth0）、6to4、Teredo、RFC 7217 / RFC 8981 のインターフェース ID は扱わない（概要で触れる）
 */
import { z } from 'zod'

/** 16 ビットのグループが 8 つ */
export type Groups = readonly number[]

export const GROUP_COUNT = 8
export const MIN_PREFIX = 0
export const MAX_PREFIX = 128

const HEX_GROUP = /^[0-9a-f]{1,4}$/
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** 1 つのグループの並び（:: の片側）を読む。最後の要素は IPv4 の表記でもよい */
function parseSide(text: string, allowIpv4: boolean): number[] | null {
  if (text === '') {
    return []
  }
  const parts = text.split(':')
  const groups: number[] = []
  for (const [i, part] of parts.entries()) {
    const ipv4 = IPV4.exec(part)
    if (ipv4 !== null && allowIpv4 && i === parts.length - 1) {
      const octets = ipv4.slice(1).map(Number)
      if (octets.some((octet) => octet > 255)) {
        return null
      }
      const [a = 0, b = 0, c = 0, d = 0] = octets
      groups.push(a * 256 + b, c * 256 + d)
      continue
    }
    if (!HEX_GROUP.test(part)) {
      return null
    }
    groups.push(Number.parseInt(part, 16))
  }
  return groups
}

/** テキストの IPv6 アドレスを 8 つのグループにする。正しくなければ null */
export function parseIPv6(input: string): Groups | null {
  const text = input.trim().toLowerCase()
  const halves = text.split('::')
  if (halves.length > 2) {
    return null
  }
  if (halves.length === 1) {
    const groups = parseSide(text, true)
    return groups?.length === GROUP_COUNT ? groups : null
  }
  const [head = '', tail = ''] = halves
  const left = parseSide(head, false)
  const right = parseSide(tail, true)
  if (left === null || right === null || left.length + right.length > GROUP_COUNT - 1) {
    return null
  }
  const zeros = GROUP_COUNT - left.length - right.length
  return [...left, ...Array.from({ length: zeros }, () => 0), ...right]
}

const hex = (group: number) => group.toString(16)

/** 省略しない表記（4 桁ずつ） */
export function formatFull(groups: Groups): string {
  return groups.map((group) => hex(group).padStart(4, '0')).join(':')
}

/** いちばん長い 0 の続き（2 つ以上）の [開始, 長さ]。同じ長さなら最初のもの */
function longestZeroRun(groups: Groups): [number, number] | null {
  let best: [number, number] | null = null
  let start = -1
  for (let i = 0; i <= groups.length; i++) {
    if (i < groups.length && groups[i] === 0) {
      if (start < 0) {
        start = i
      }
      continue
    }
    if (start >= 0) {
      const length = i - start
      if (length >= 2 && (best === null || length > best[1])) {
        best = [start, length]
      }
      start = -1
    }
  }
  return best
}

function compress(groups: Groups): string {
  const run = longestZeroRun(groups)
  if (run === null) {
    return groups.map(hex).join(':')
  }
  const [start, length] = run
  const head = groups.slice(0, start).map(hex).join(':')
  const tail = groups
    .slice(start + length)
    .map(hex)
    .join(':')
  return `${head}::${tail}`
}

/** RFC 5952 の正規の表記 */
export function formatCanonical(groups: Groups): string {
  if (classify(groups).kind === 'ipv4Mapped') {
    const high = groups[6] ?? 0
    const low = groups[7] ?? 0
    return `::ffff:${[high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')}`
  }
  return compress(groups)
}

/** 先頭の prefix ビットが等しいか */
function hasPrefix(groups: Groups, prefix: Groups, length: number): boolean {
  for (let bit = 0; bit < length; bit++) {
    const index = Math.floor(bit / 16)
    const mask = 1 << (15 - (bit % 16))
    if (((groups[index] ?? 0) & mask) !== ((prefix[index] ?? 0) & mask)) {
      return false
    }
  }
  return true
}

export const ADDRESS_KINDS = [
  'unspecified',
  'loopback',
  'ipv4Mapped',
  'multicast',
  'linkLocal',
  'uniqueLocal',
  'documentation',
  'globalUnicast',
  'reserved',
] as const
export type AddressKind = (typeof ADDRESS_KINDS)[number]

export interface Classification {
  readonly kind: AddressKind
  /** その種類のプレフィックス（::/128、fe80::/10 など） */
  readonly range: string
}

/** 種類を判定するための範囲。上から順に調べる */
const RANGES: readonly (readonly [AddressKind, string, number])[] = [
  ['unspecified', '::', 128],
  ['loopback', '::1', 128],
  ['ipv4Mapped', '::ffff:0:0', 96],
  ['multicast', 'ff00::', 8],
  ['linkLocal', 'fe80::', 10],
  ['uniqueLocal', 'fc00::', 7],
  ['documentation', '2001:db8::', 32],
  ['documentation', '3fff::', 20],
  ['globalUnicast', '2000::', 3],
]

export function classify(groups: Groups): Classification {
  for (const [kind, prefix, length] of RANGES) {
    const prefixGroups = parseIPv6(prefix)
    if (prefixGroups !== null && hasPrefix(groups, prefixGroups, length)) {
      return { kind, range: `${prefix}/${String(length)}` }
    }
  }
  return { kind: 'reserved', range: '-' }
}

export const MULTICAST_SCOPES = [
  'interfaceLocal',
  'linkLocal',
  'siteLocal',
  'organizationLocal',
  'global',
  'other',
] as const
export type MulticastScope = (typeof MULTICAST_SCOPES)[number]

/** マルチキャストの scope（先頭のグループの下位 4 ビット、RFC 4291 §2.7） */
export function multicastScope(groups: Groups): MulticastScope {
  switch ((groups[0] ?? 0) & 0xf) {
    case 0x1:
      return 'interfaceLocal'
    case 0x2:
      return 'linkLocal'
    case 0x5:
      return 'siteLocal'
    case 0x8:
      return 'organizationLocal'
    case 0xe:
      return 'global'
    default:
      return 'other'
  }
}

export const WELL_KNOWN_GROUPS = ['allNodes', 'allRouters', 'solicitedNode'] as const
export type WellKnownGroup = (typeof WELL_KNOWN_GROUPS)[number]

/** よく使うリンクローカルのマルチキャストのグループ（RFC 4291 §2.7.1） */
export function wellKnownGroup(groups: Groups): WellKnownGroup | null {
  const text = compress(groups)
  if (text === 'ff02::1') {
    return 'allNodes'
  }
  if (text === 'ff02::2') {
    return 'allRouters'
  }
  const solicited = parseIPv6('ff02::1:ff00:0')
  return solicited !== null && hasPrefix(groups, solicited, 104) ? 'solicitedNode' : null
}

/** 先頭 prefix ビットだけを残したもの（ネットワークのプレフィックス） */
export function networkPrefix(groups: Groups, prefix: number): Groups {
  return groups.map((group, i) => {
    const bits = Math.min(16, Math.max(0, prefix - i * 16))
    const mask = bits === 0 ? 0 : (0xffff << (16 - bits)) & 0xffff
    return group & mask
  })
}

/** 先頭 prefix ビットを 0 にしたもの（インターフェース ID） */
export function interfaceId(groups: Groups, prefix: number): Groups {
  const network = networkPrefix(groups, prefix)
  return groups.map((group, i) => group ^ (network[i] ?? 0))
}

/** 要請ノードマルチキャストアドレス（ff02::1:ff と、下位 24 ビット） */
export function solicitedNode(groups: Groups): Groups {
  const high = groups[6] ?? 0
  const low = groups[7] ?? 0
  return [0xff02, 0, 0, 0, 0, 1, 0xff00 | (high & 0xff), low]
}

const macHex = (byte: number) => byte.toString(16).padStart(2, '0')

/** IPv6 のマルチキャストのアドレスに対応する Ethernet の MAC アドレス（33:33 と下位 32 ビット） */
export function multicastMac(groups: Groups): string {
  const high = groups[6] ?? 0
  const low = groups[7] ?? 0
  return ['33', '33', high >> 8, high & 0xff, low >> 8, low & 0xff]
    .map((part) => (typeof part === 'string' ? part : macHex(part)))
    .join(':')
}

const MAC =
  /^([0-9a-f]{2})[:-]([0-9a-f]{2})[:-]([0-9a-f]{2})[:-]([0-9a-f]{2})[:-]([0-9a-f]{2})[:-]([0-9a-f]{2})$/

/** MAC アドレスを 6 バイトにする。正しくなければ null */
export function parseMac(input: string): readonly number[] | null {
  const match = MAC.exec(input.trim().toLowerCase())
  return match === null ? null : match.slice(1).map((byte) => Number.parseInt(byte, 16))
}

export function formatMac(bytes: readonly number[]): string {
  return bytes.map(macHex).join(':')
}

/** U/L ビット（最初のバイトの下から 2 ビット目） */
export const UL_BIT = 0x02

/** MAC アドレスから作る EUI-64 のインターフェース ID（4 グループ）。ff:fe を挟み、U/L ビットを反転する */
export function eui64FromMac(mac: readonly number[]): Groups {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = mac
  const bytes = [a ^ UL_BIT, b, c, 0xff, 0xfe, d, e, f]
  return [0, 2, 4, 6].map((i) => ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0))
}

/** MAC アドレスから作るリンクローカルアドレス（fe80::/64 と EUI-64） */
export function linkLocalFromMac(mac: readonly number[]): Groups {
  return [0xfe80, 0, 0, 0, ...eui64FromMac(mac)]
}

export const DEFAULT_ADDRESS = '2001:db8:1:0:200:5eff:fe00:530a'
export const DEFAULT_PREFIX = 64

export const ipv6QuerySchema = z.object({
  address: z
    .string()
    .refine((text) => parseIPv6(text) !== null)
    .catch(DEFAULT_ADDRESS),
  // 空文字列が 0 にならないよう、数字だけの文字列に限る
  prefix: z
    .string()
    .regex(/^(0|[1-9]\d{0,2})$/)
    .transform(Number)
    .pipe(z.number().max(MAX_PREFIX))
    .catch(DEFAULT_PREFIX),
})

export type Ipv6Query = z.infer<typeof ipv6QuerySchema>

/** URLSearchParams からクエリを読む */
export function readIpv6Query(params: URLSearchParams): Ipv6Query {
  return ipv6QuerySchema.parse({
    address: params.get('address') ?? undefined,
    prefix: params.get('prefix') ?? undefined,
  })
}
