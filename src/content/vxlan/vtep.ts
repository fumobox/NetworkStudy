/**
 * VTEP（VXLAN Tunnel End Point）の表と転送（RFC 7348 §4.1、§4.2、RFC 8365 §4）。
 *
 * VTEP は、VNI ごとのスイッチに「トンネルのポート」を足したものとして考える。
 * - 表（FDB）は VNI と MAC アドレスの組で引き、行き先は自分のホストのポートか、相手の VTEP の IP アドレス
 * - トンネルから受け取ったフレームの送信元は、内側の送信元の MAC アドレス → 外側の送信元の IP アドレスとして学習する（§4.1）
 * - ブロードキャストと知らない宛先は、自分のホストのポートと、流す先（相手の VTEP の一覧か、マルチキャストグループ）へ流す（§4.2、
 *   RFC 8365 §4 の ingress replication）
 * - トンネルから受け取ったものは、トンネルに流し返さない（スプリットホライズン。流す先の全員が、送った VTEP から直接受け取るため）
 * - 静的な行（コントロールプレーンや手で書いた行）は、学習で書き換えない。Linux の bridge fdb の permanent と同じ
 * - グループアドレス（ブロードキャストを含む）は学習しない。isGroupMac はコンテナーのネットワークのテーマのものを使う
 */
import { isGroupMac } from '../container-networking/bridge'

export type VtepEntryType = 'local' | 'learned' | 'static'

export interface VtepEntry {
  readonly vni: number
  readonly mac: string
  /** 自分のホストのポート（vethA など）か、相手の VTEP の IP アドレス */
  readonly where: string
  readonly remote: boolean
  readonly type: VtepEntryType
}

/** VNI ごとの、ブロードキャストと知らない宛先の流し方 */
export type FloodTarget =
  | { readonly kind: 'vteps'; readonly ips: readonly string[] }
  | { readonly kind: 'group'; readonly group: string }

export type Ingress = { readonly kind: 'port'; readonly port: string } | { readonly kind: 'tunnel' }

export type VtepDecision =
  | { readonly kind: 'local'; readonly port: string }
  | { readonly kind: 'encap'; readonly vtep: string }
  | {
      readonly kind: 'flood'
      readonly ports: readonly string[]
      /** トンネルへ流す先。トンネルから受け取ったときは null（スプリットホライズン） */
      readonly remote: FloodTarget | null
    }
  | { readonly kind: 'filter' }

function upsert(fdb: readonly VtepEntry[], entry: VtepEntry): readonly VtepEntry[] {
  if (isGroupMac(entry.mac)) {
    return fdb
  }
  const existing = fdb.find((e) => e.vni === entry.vni && e.mac === entry.mac)
  if (existing === undefined) {
    return [...fdb, entry]
  }
  if (
    existing.type === 'static' ||
    (existing.where === entry.where && existing.type === entry.type)
  ) {
    return fdb
  }
  return fdb.map((e) => (e === existing ? entry : e))
}

/** 自分のホストのポートから受け取ったフレームの送信元を学習する */
export function learnLocal(
  fdb: readonly VtepEntry[],
  vni: number,
  mac: string,
  port: string,
): readonly VtepEntry[] {
  return upsert(fdb, { vni, mac, where: port, remote: false, type: 'local' })
}

/** トンネルから受け取ったパケットの、内側の送信元の MAC アドレスと外側の送信元の IP アドレスを学習する（RFC 7348 §4.1） */
export function learnRemote(
  fdb: readonly VtepEntry[],
  vni: number,
  innerSrcMac: string,
  outerSrcIp: string,
): readonly VtepEntry[] {
  return upsert(fdb, { vni, mac: innerSrcMac, where: outerSrcIp, remote: true, type: 'learned' })
}

/** フレームをどこへ送るかを決める。localPorts はこの VNI の自分のホストのポート */
export function decide(
  fdb: readonly VtepEntry[],
  flood: FloodTarget,
  vni: number,
  dstMac: string,
  ingress: Ingress,
  localPorts: readonly string[],
): VtepDecision {
  const fromTunnel = ingress.kind === 'tunnel'
  const entry = isGroupMac(dstMac) ? undefined : fdb.find((e) => e.vni === vni && e.mac === dstMac)
  if (entry === undefined) {
    return {
      kind: 'flood',
      ports: localPorts.filter((port) => ingress.kind === 'tunnel' || port !== ingress.port),
      remote: fromTunnel ? null : flood,
    }
  }
  if (entry.remote) {
    // 相手の VTEP の先にいる宛先を、トンネルから受け取った: 送り返さない
    return fromTunnel ? { kind: 'filter' } : { kind: 'encap', vtep: entry.where }
  }
  return ingress.kind === 'port' && ingress.port === entry.where
    ? { kind: 'filter' }
    : { kind: 'local', port: entry.where }
}

/** IPv4 のマルチキャストグループの MAC アドレス（RFC 1112 §6.4: 01-00-5E に、グループのアドレスの下位 23 ビット） */
export function multicastMac(group: string): string {
  const octets = group.split('.').map(Number)
  const [, b = 0, c = 0, d = 0] = octets
  const bytes = [0x01, 0x00, 0x5e, b & 0x7f, c, d]
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join(':')
}

export const FDB_COLUMNS = ['VNI', 'MAC', 'Where', 'Type'] as const

export function fdbRows(fdb: readonly VtepEntry[]): readonly (readonly string[])[] {
  return fdb.map((entry) => [String(entry.vni), entry.mac, entry.where, entry.type])
}
