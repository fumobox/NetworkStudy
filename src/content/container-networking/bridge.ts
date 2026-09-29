/**
 * Linux のブリッジの学習と転送（IEEE Std 802.1Q-2022 clause 8.6 "The Forwarding Process"、8.7 "The Learning Process"、
 * 8.8 "The Filtering Database"。Linux の実装は docs.kernel.org の "Ethernet Bridging"）。
 *
 * ブリッジ自身のインターフェース（docker0 など）もポートの 1 つとして扱う。宛先がブリッジ自身の MAC アドレスなら、
 * フレームはホストの IP の処理に上がる（local）。ブロードキャストと知らない宛先は、受け取ったポート以外のすべてに流し、
 * そこにはブリッジ自身のインターフェースも含まれる
 */

export type FdbType = 'local' | 'learned'

export interface FdbEntry {
  readonly mac: string
  readonly port: string
  readonly type: FdbType
}

export type BridgeDecision =
  | { readonly kind: 'local' }
  | { readonly kind: 'forward'; readonly port: string }
  | { readonly kind: 'flood'; readonly ports: readonly string[] }
  | { readonly kind: 'filter' }

/** グループアドレス（最初のオクテットの最下位ビットが 1。ブロードキャストを含む） */
export function isGroupMac(mac: string): boolean {
  const first = Number.parseInt(mac.slice(0, 2), 16)
  return (first & 1) === 1
}

/** 受け取ったフレームの送信元を学習する（宛先からは学習しない。グループアドレスは学習しない） */
export function learn(fdb: readonly FdbEntry[], srcMac: string, port: string): readonly FdbEntry[] {
  if (isGroupMac(srcMac)) {
    return fdb
  }
  const existing = fdb.find((entry) => entry.mac === srcMac)
  if (existing === undefined) {
    return [...fdb, { mac: srcMac, port, type: 'learned' }]
  }
  if (existing.type === 'local' || existing.port === port) {
    return fdb
  }
  // 別のポートに移った
  return fdb.map((entry) => (entry.mac === srcMac ? { mac: srcMac, port, type: 'learned' } : entry))
}

/** 宛先の MAC アドレスで、フレームをどこへ送るかを決める */
export function decide(
  fdb: readonly FdbEntry[],
  dstMac: string,
  ingress: string,
  ports: readonly string[],
): BridgeDecision {
  const entry = isGroupMac(dstMac) ? undefined : fdb.find((e) => e.mac === dstMac)
  if (entry === undefined) {
    return { kind: 'flood', ports: ports.filter((port) => port !== ingress) }
  }
  if (entry.type === 'local') {
    return { kind: 'local' }
  }
  return entry.port === ingress ? { kind: 'filter' } : { kind: 'forward', port: entry.port }
}

export const FDB_COLUMNS = ['MAC', 'Port', 'Type'] as const

export function fdbRows(fdb: readonly FdbEntry[]): readonly (readonly string[])[] {
  return fdb.map((entry) => [entry.mac, entry.port, entry.type])
}
