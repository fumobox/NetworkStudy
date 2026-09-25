/**
 * IPv4 のサブネット計算。アドレスは 32 ビットの符号なし整数（number）で扱い、ビット演算の結果は `>>> 0` で符号なしに戻す。
 *
 * 根拠:
 * - CIDR（プレフィックス長によるアドレスの集約）: RFC 4632
 * - /31 のポイントツーポイントリンク（ネットワークアドレスとブロードキャストアドレスもホストに使う）: RFC 3021
 * - プライベートアドレス（10/8、172.16/12、192.168/16）: RFC 1918
 * - アドレスクラス（A〜E）: RFC 791 §3.2 と RFC 1112 §4（CIDR で廃止されたが、学習のために表示する）
 */
import { z } from 'zod'

export const MIN_PREFIX = 0
export const MAX_PREFIX = 32

const ALL_ONES = 0xffffffff
const OCTET_PATTERN = /^(0|[1-9]\d{0,2})$/

/**
 * ドット区切りの 10 進表記（`192.168.1.10`）を 32 ビットの整数にする。不正なら null。
 * 8 進数と紛らわしい先頭の 0（`010`）や、前後の空白は受け付けない
 */
export function parseIPv4(text: string): number | null {
  const parts = text.split('.')
  if (parts.length !== 4) {
    return null
  }
  let value = 0
  for (const part of parts) {
    if (!OCTET_PATTERN.test(part)) {
      return null
    }
    const octet = Number(part)
    if (octet > 255) {
      return null
    }
    value = value * 256 + octet
  }
  return value
}

/** 32 ビットの整数をドット区切りの 10 進表記にする */
export function formatIPv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => String((value >>> shift) & 0xff)).join('.')
}

/** 8 ビットずつの 2 進表記（`['11000000', '10101000', …]`） */
export function toBinaryOctets(value: number): readonly string[] {
  return [24, 16, 8, 0].map((shift) => ((value >>> shift) & 0xff).toString(2).padStart(8, '0'))
}

export function isPrefixLength(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_PREFIX && value <= MAX_PREFIX
}

/** プレフィックス長からサブネットマスクを作る（/24 → 255.255.255.0） */
export function maskFromPrefix(prefix: number): number {
  // JavaScript のシフトは 32 ビットを法とするので（x << 32 は x のまま）、/0 は別に扱う
  return prefix === 0 ? 0 : (ALL_ONES << (MAX_PREFIX - prefix)) >>> 0
}

/** サブネットマスクからプレフィックス長を求める。1 が先頭から連続していなければ null */
export function prefixFromMask(mask: number): number | null {
  const hostBits = ~mask >>> 0
  // ホスト部（反転したマスク）が 2^n − 1 の形なら、1 は先頭から連続している
  if ((hostBits & (hostBits + 1)) !== 0) {
    return null
  }
  return MAX_PREFIX - hostBits.toString(2).replace(/^0+/, '').length
}

/** ワイルドカードマスク（サブネットマスクの反転。ACL などで使う） */
export function wildcardOf(prefix: number): number {
  return ~maskFromPrefix(prefix) >>> 0
}

export function networkOf(address: number, prefix: number): number {
  return (address & maskFromPrefix(prefix)) >>> 0
}

export function broadcastOf(address: number, prefix: number): number {
  return (networkOf(address, prefix) | wildcardOf(prefix)) >>> 0
}

export interface HostRange {
  readonly first: number
  readonly last: number
  /** ホストに割り当てられるアドレスの数 */
  readonly count: number
}

/**
 * ホストに割り当てられる範囲。通常はネットワークアドレスとブロードキャストアドレスを除く（2^(32−p) − 2 個）。
 * /31 は RFC 3021 により 2 個とも使え、/32 はそのアドレス 1 個だけ
 */
export function hostRange(address: number, prefix: number): HostRange {
  const network = networkOf(address, prefix)
  const broadcast = broadcastOf(address, prefix)
  if (prefix === MAX_PREFIX) {
    return { first: network, last: network, count: 1 }
  }
  if (prefix === MAX_PREFIX - 1) {
    return { first: network, last: broadcast, count: 2 }
  }
  return { first: network + 1, last: broadcast - 1, count: 2 ** (MAX_PREFIX - prefix) - 2 }
}

/** RFC 1918 のプライベートアドレス */
export function isPrivate(address: number): boolean {
  return (
    networkOf(address, 8) === 0x0a000000 ||
    networkOf(address, 12) === 0xac100000 ||
    networkOf(address, 16) === 0xc0a80000
  )
}

export const ADDRESS_CLASSES = ['A', 'B', 'C', 'D', 'E'] as const
export type AddressClass = (typeof ADDRESS_CLASSES)[number]

/** 先頭のビットで決まるアドレスクラス（0 → A、10 → B、110 → C、1110 → D、1111 → E） */
export function addressClassOf(address: number): AddressClass {
  const firstOctet = address >>> 24
  if (firstOctet < 128) {
    return 'A'
  }
  if (firstOctet < 192) {
    return 'B'
  }
  if (firstOctet < 224) {
    return 'C'
  }
  return firstOctet < 240 ? 'D' : 'E'
}

export interface SubnetInfo {
  readonly address: number
  readonly prefix: number
  readonly mask: number
  readonly wildcard: number
  readonly network: number
  readonly broadcast: number
  readonly hosts: HostRange
  readonly addressClass: AddressClass
  readonly isPrivate: boolean
}

/** アドレスとプレフィックス長から、表示する値をまとめて求める */
export function describeSubnet(address: number, prefix: number): SubnetInfo {
  return {
    address,
    prefix,
    mask: maskFromPrefix(prefix),
    wildcard: wildcardOf(prefix),
    network: networkOf(address, prefix),
    broadcast: broadcastOf(address, prefix),
    hosts: hostRange(address, prefix),
    addressClass: addressClassOf(address),
    isPrivate: isPrivate(address),
  }
}

export const DEFAULT_ADDRESS = '192.168.1.10'
export const DEFAULT_PREFIX = 24

/** URL のクエリ（`?ip=192.168.1.10&prefix=24`）。欠けた値や不正な値は既定値にする */
export const subnetQuerySchema = z.object({
  ip: z
    .string()
    .refine((text) => parseIPv4(text) !== null)
    .catch(DEFAULT_ADDRESS),
  // z.coerce.number() だと空文字列（`?prefix=`）が 0 になるので、数字だけの文字列に限る
  prefix: z
    .string()
    .regex(/^(0|[1-9]\d?)$/)
    .transform(Number)
    .pipe(z.number().max(MAX_PREFIX))
    .catch(DEFAULT_PREFIX),
})

export type SubnetQuery = z.infer<typeof subnetQuerySchema>

/** URLSearchParams からクエリを読む */
export function readSubnetQuery(params: URLSearchParams): SubnetQuery {
  return subnetQuerySchema.parse({
    ip: params.get('ip') ?? undefined,
    prefix: params.get('prefix') ?? undefined,
  })
}
