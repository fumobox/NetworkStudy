/**
 * VXLAN: IP ネットワークの上に LAN を延ばす
 *
 * 根拠（標準）:
 * - RFC 7348（Informational、Independent Submission。標準化の過程の RFC ではなく、広く使われている VXLAN を記した文書）
 *   - §4: VNI ごとの 24 ビットの VXLAN セグメント。VM（ここではコンテナー）はカプセル化を見ない。セグメントが違えば
 *     MAC アドレスが重なってもよい
 *   - §4.1: トンネルから受け取ったパケットの、内側の送信元の MAC アドレスと外側の送信元の IP アドレスの対応を学習する
 *   - §4.2: ブロードキャストと知らない宛先は、VNI に対応づけたマルチキャストグループに送る。返事はユニキャスト
 *   - §4.3: VTEP は VXLAN のパケットを断片化してはならない（MUST NOT）。アンダーレイの MTU を大きくすることを推奨する。
 *     外側の DF ビットの要件はない
 *   - §5: ヘッダーの形式（header.ts）、宛先の UDP ポート 4789、送信元ポートは内側のハッシュから作り 49152〜65535 を推奨、
 *     UDP のチェックサムは 0 で送るべき（SHOULD）
 * - RFC 8365 §4（EVPN のオーバーレイ。ingress replication と、コントロールプレーンでの学習）、RFC 7432、RFC 9161（EVPN の代理 ARP）
 * - RFC 826（ARP）、RFC 1112 §6.4（マルチキャストの MAC アドレス）、RFC 5771 §9.2（説明用のマルチキャストグループ 233.252.0.0/24）
 * - RFC 9293 §3.7.1、RFC 6691（MSS）、RFC 6298（RTO）、RFC 2923 §2.1（パス MTU のブラックホール）、RFC 2992（ECMP）、RFC 6335
 * - RFC 1918（10.0.0.0/24）、RFC 5737（192.0.2.0/24、198.51.100.0/24）、RFC 9542 §2.1.4（説明用の MAC アドレス）
 * - IEEE Std 802.1Q-2022 clause 8.6〜8.8（VNI ごとのブリッジの学習と転送。vtep.ts）
 *
 * 標準ではなく実装で決まるもの（概要で書き分ける）: Linux の既定の宛先ポート 8472（drivers/net/vxlan/vxlan_core.c。4789 は
 * dstport で指定する）、外側の DF の既定（ip-link(8) の df。既定は unset）、VXLAN のデバイスの MTU（下のデバイス dev を指定して作ると、その MTU − 50）、
 * 送信元ポートの既定の範囲（ip_local_port_range）、マルチキャストの TTL の既定 1、送信元での複製の書き方（FDB の全ゼロの行）
 *
 * 学習用の単純化: ホストは 2 台で、VTEP はホストに 1 つずつ。VTEP のレーンは、ホストのブリッジと VXLAN のデバイスを合わせたもの。
 * IPv4 だけ。アンダーレイは 1 つのレーンで、ルーター 1 台を通るネットワークを表す（ECMP の 2 つの経路は Path のフィールドだけ）。
 * 経路制御、PIM、IGMP のメッセージは描かない（参加は状態で示す）。FDB の古い行が消えること（エージング）は描かない。
 * 内側のフレームに 802.1Q のタグはなく、FCS とパディングは数えない。送信元ポートと ECMP の経路は説明用のハッシュ（entropy.ts）
 * で選ぶ。MTU の状況では VTEP がフレームを捨て、何も返さない（実装によって違う）。TCP のシーケンス番号は描かない。
 * コントロールプレーンが配った行は準備で示し、BGP は描かない。マルチキャストの TTL は 1 より大きく設定してあるものとする
 */
import { z } from 'zod'
import type {
  Actor,
  ActorId,
  Message,
  PacketField,
  Scenario,
  StateKey,
  StateTable,
  Step,
  StepEvent,
} from '@/engine/types'
import type { LocalizedText } from '@/lib/i18n/locale'
import { ecmpIndex, sourcePort, type FlowTuple } from './entropy'
import { encodeVxlanHeader, formatHeaderBytes } from './header'
import { outerIpLength } from './overhead'
import {
  decide,
  FDB_COLUMNS,
  fdbRows,
  learnLocal,
  learnRemote,
  multicastMac,
  type FloodTarget,
  type Ingress,
  type VtepDecision,
  type VtepEntry,
} from './vtep'

const SITUATIONS = ['firstContact', 'multicast', 'controlPlane', 'tenants', 'mtu', 'ecmp'] as const

const optionsSchema = z.object({
  situation: z.enum(SITUATIONS).catch('firstContact'),
})
export type VxlanOptions = z.infer<typeof optionsSchema>
type Situation = VxlanOptions['situation']

const A: ActorId = 'containerA'
const V1: ActorId = 'vtep1'
const U: ActorId = 'underlay'
const V2: ActorId = 'vtep2'
const B: ActorId = 'containerB'

const IFACE: StateKey = 'iface'
const ARP: StateKey = 'arp'
const SOCKET: StateKey = 'socket'
const CONFIG: StateKey = 'config'
const FDB: StateKey = 'fdb'
const FLOOD: StateKey = 'flood'
const NEIGH: StateKey = 'neigh'
const SEGMENTS: StateKey = 'segments'
const DECISION: StateKey = 'decision'
const ROUTES: StateKey = 'routes'
const GROUPS: StateKey = 'groups'
const PATHS: StateKey = 'paths'

export const ARP_COLUMNS = ['IP', 'MAC'] as const
export const FLOOD_COLUMNS = ['VNI', 'Send to'] as const
export const SEGMENT_COLUMNS = ['VNI', 'Ports'] as const
export const ROUTE_COLUMNS = ['Destination', 'Next hop'] as const
export const GROUP_COLUMNS = ['Group', 'Members'] as const
export const PATH_COLUMNS = ['Outer src port', 'Path'] as const

/** RFC 9542 §2.1.4 の説明用の MAC アドレス */
export const MAC = {
  a: '00:00:5e:00:53:01',
  b: '00:00:5e:00:53:02',
  c: '00:00:5e:00:53:a1',
  d: '00:00:5e:00:53:a2',
  host1: '00:00:5e:00:53:10',
  host2: '00:00:5e:00:53:20',
  router1: '00:00:5e:00:53:f1',
  router2: '00:00:5e:00:53:f2',
} as const
const BROADCAST = 'ff:ff:ff:ff:ff:ff'

export const HOST1_IP = '192.0.2.10'
export const HOST2_IP = '198.51.100.20'
/** 説明用のマルチキャストグループ（RFC 5771 §9.2 の MCAST-TEST-NET） */
export const GROUP = '233.252.0.100'
export const IP = { a: '10.0.0.1', b: '10.0.0.2' } as const
export const VXLAN_PORT = 4789
const TTL = 64
export const RED = 100
export const BLUE = 200

type Side = 'host1' | 'host2'
const other = (side: Side): Side => (side === 'host1' ? 'host2' : 'host1')
const vtepOf = (side: Side): ActorId => (side === 'host1' ? V1 : V2)
const hostIp = (side: Side) => (side === 'host1' ? HOST1_IP : HOST2_IP)

const table = (
  columns: readonly string[],
  rows: readonly (readonly string[])[] = [],
): StateTable => ({
  columns,
  rows,
})
const set = (actorId: ActorId, key: StateKey, value: string | StateTable): StepEvent => ({
  kind: 'stateChange',
  actorId,
  key,
  value,
})
const send = (message: Message): StepEvent => ({ kind: 'message', message })

const containerSlots: Actor['stateSlots'] = [
  { key: IFACE, label: { en: 'Interface', ja: 'インターフェース' }, initial: '-' },
  { key: ARP, label: { en: 'ARP cache', ja: 'ARP キャッシュ' }, initial: table(ARP_COLUMNS) },
  {
    key: SOCKET,
    label: { en: 'Connection (as the container sees it)', ja: '接続（コンテナーから見たもの）' },
    initial: '-',
  },
]
const vtepSlots: Actor['stateSlots'] = [
  { key: CONFIG, label: { en: 'VXLAN device', ja: 'VXLAN のデバイス' }, initial: '-' },
  {
    key: FDB,
    label: { en: 'Forwarding table (FDB)', ja: '転送の表（FDB）' },
    initial: table(FDB_COLUMNS),
  },
  { key: FLOOD, label: { en: 'Flood list', ja: '流す先の一覧' }, initial: table(FLOOD_COLUMNS) },
  { key: NEIGH, label: { en: 'Neighbor table', ja: '近隣の表' }, initial: table(ARP_COLUMNS) },
  { key: SEGMENTS, label: { en: 'Segments', ja: 'セグメント' }, initial: table(SEGMENT_COLUMNS) },
  { key: DECISION, label: { en: 'What the VTEP did', ja: 'VTEP の判断' }, initial: '-' },
]

const actors: readonly Actor[] = [
  {
    id: A,
    kind: 'client',
    name: { en: 'Container A (host 1)', ja: 'コンテナー A（ホスト 1）' },
    shortName: { en: 'A', ja: 'A' },
    stateSlots: containerSlots,
  },
  {
    id: V1,
    kind: 'switch',
    name: { en: `VTEP (host 1, ${HOST1_IP})`, ja: `VTEP（ホスト 1、${HOST1_IP}）` },
    shortName: { en: 'VTEP 1', ja: 'VTEP 1' },
    stateSlots: vtepSlots,
  },
  {
    id: U,
    kind: 'router',
    name: { en: 'Underlay network', ja: 'アンダーレイのネットワーク' },
    shortName: { en: 'Underlay', ja: 'アンダーレイ' },
    stateSlots: [
      { key: ROUTES, label: { en: 'Routes', ja: '経路表' }, initial: table(ROUTE_COLUMNS) },
      {
        key: GROUPS,
        label: { en: 'Multicast groups', ja: 'マルチキャストグループ' },
        initial: table(GROUP_COLUMNS),
      },
      {
        key: PATHS,
        label: { en: 'Equal-cost paths', ja: '等コストの経路' },
        initial: table(PATH_COLUMNS),
      },
      {
        key: DECISION,
        label: { en: 'What the network did', ja: 'ネットワークの判断' },
        initial: '-',
      },
    ],
  },
  {
    id: V2,
    kind: 'switch',
    name: { en: `VTEP (host 2, ${HOST2_IP})`, ja: `VTEP（ホスト 2、${HOST2_IP}）` },
    shortName: { en: 'VTEP 2', ja: 'VTEP 2' },
    stateSlots: vtepSlots,
  },
  {
    id: B,
    kind: 'client',
    name: { en: 'Container B (host 2)', ja: 'コンテナー B（ホスト 2）' },
    shortName: { en: 'B', ja: 'B' },
    stateSlots: containerSlots,
  },
]

// ---------- フレーム ----------

const FIELD_TEXT = {
  link: {
    en: 'The veth pair between the container and its host’s bridge (see the container networking theme)',
    ja: 'コンテナーとホストのブリッジの間の veth ペア（コンテナーのネットワークのテーマを参照）',
  },
  ethDst: { en: 'Destination MAC address', ja: '宛先の MAC アドレス' },
  ethSrc: { en: 'Source MAC address', ja: '送信元の MAC アドレス' },
  oper: { en: 'ARP operation: 1 = request, 2 = reply', ja: 'ARP の操作。1 = 要求、2 = 応答' },
  spa: { en: 'Sender IP address', ja: '送信元の IP アドレス' },
  sha: { en: 'Sender MAC address', ja: '送信元の MAC アドレス' },
  tpa: { en: 'Target IP address', ja: '対象の IP アドレス' },
  src: { en: 'Source address', ja: '送信元のアドレス' },
  dst: { en: 'Destination address', ja: '宛先のアドレス' },
  length: {
    en: 'Length of the inner IP packet (or of the ARP message)',
    ja: '内側の IP パケット（または ARP のメッセージ）の長さ',
  },
  outerEthDst: {
    en: 'Outer destination MAC: the next hop in the underlay (a router, or the multicast MAC of the group)',
    ja: '外側の宛先の MAC アドレス。アンダーレイの次の機器（ルーター、またはグループのマルチキャストの MAC アドレス）',
  },
  outerEthSrc: { en: 'Outer source MAC address', ja: '外側の送信元の MAC アドレス' },
  outerIpSrc: {
    en: 'Outer source IP: the sending VTEP. The receiving VTEP learns the inner source MAC behind it',
    ja: '外側の送信元の IP アドレス。送った VTEP。受け取った VTEP は、内側の送信元の MAC アドレスがこの先にいると学習する',
  },
  outerIpDst: {
    en: 'Outer destination IP: the remote VTEP, or the multicast group',
    ja: '外側の宛先の IP アドレス。相手の VTEP か、マルチキャストグループ',
  },
  ttl: {
    en: 'Outer TTL. The routers of the underlay lower it by 1; the inner packet is not touched',
    ja: '外側の TTL。アンダーレイのルーターが 1 ずつ減らす。内側のパケットは変わらない',
  },
  totalLength: {
    en: 'Length of the outer IP packet: the inner one plus 50 bytes (inner Ethernet 14, VXLAN 8, UDP 8, outer IP 20)',
    ja: '外側の IP パケットの長さ。内側に 50 バイト（内側の Ethernet 14、VXLAN 8、UDP 8、外側の IP 20）を足したもの',
  },
  udpSrc: {
    en: 'Outer source port, from a hash of the inner flow (49152–65535 recommended)',
    ja: '外側の送信元ポート。内側の流れのハッシュから作る（49152〜65535 を推奨）',
  },
  udpDst: {
    en: 'The port IANA assigned to VXLAN. Linux uses 8472 unless dstport 4789 is set',
    ja: 'IANA が VXLAN に割り当てたポート。Linux は dstport 4789 を指定しないと 8472 を使う',
  },
  udpChecksum: {
    en: 'The UDP checksum SHOULD be sent as zero (RFC 7348 §5)',
    ja: 'UDP のチェックサムは 0 で送るべき（RFC 7348 §5）',
  },
  vxlanHeader: {
    en: 'The 8-byte VXLAN header: flags (I = 0x08: the VNI is valid), reserved bits, the 24-bit VNI, a reserved byte',
    ja: '8 バイトの VXLAN のヘッダー。フラグ（I = 0x08。VNI が有効）、予約のビット、24 ビットの VNI、予約のバイト',
  },
  vni: {
    en: 'The VXLAN Network Identifier: which segment (tenant) the inner frame belongs to',
    ja: 'VXLAN のネットワークの識別子。内側のフレームがどのセグメント（テナント）のものか',
  },
  path: {
    en: 'Which of the equal-cost paths the underlay chose, from a hash of the outer headers',
    ja: 'アンダーレイが外側のヘッダーのハッシュで選んだ、等コストの経路',
  },
} as const satisfies Record<string, LocalizedText>

/** 内側のフレーム（コンテナーが送り、受け取るもの） */
interface Frame {
  readonly label: string
  /** カプセル化したときの [ ] の中（40 文字に収めるため短くすることがある） */
  readonly innerLabel: string
  readonly ethSrc: string
  readonly ethDst: string
  /** 内側の IP パケット（または ARP のメッセージ）の長さ */
  readonly length: number
  readonly body: readonly PacketField[]
  readonly description: LocalizedText
  /** TCP などの流れ（外側の送信元ポートのハッシュに使う） */
  readonly flow?: FlowTuple
}

function arpRequest(
  senderIp: string,
  senderMac: string,
  targetIp: string,
  description: LocalizedText,
): Frame {
  const label = `ARP who-has ${targetIp}`
  return {
    label,
    innerLabel: label,
    ethSrc: senderMac,
    ethDst: BROADCAST,
    length: 28,
    body: [
      { name: 'OPER', value: '1 (request)', description: FIELD_TEXT.oper },
      { name: 'SPA', value: senderIp, description: FIELD_TEXT.spa },
      { name: 'SHA', value: senderMac, description: FIELD_TEXT.sha },
      { name: 'TPA', value: targetIp, highlight: true, description: FIELD_TEXT.tpa },
    ],
    description,
  }
}

function arpReply(
  senderIp: string,
  senderMac: string,
  targetMac: string,
  description: LocalizedText,
): Frame {
  const label = `ARP is-at ${senderMac}`
  return {
    label,
    innerLabel: label,
    ethSrc: senderMac,
    ethDst: targetMac,
    length: 28,
    body: [
      { name: 'OPER', value: '2 (reply)', description: FIELD_TEXT.oper },
      { name: 'SPA', value: senderIp, description: FIELD_TEXT.spa },
      { name: 'SHA', value: senderMac, highlight: true, description: FIELD_TEXT.sha },
    ],
    description,
  }
}

function echo(kind: 'Request' | 'Reply', from: 'a' | 'b', description: LocalizedText): Frame {
  const [src, dst] = from === 'a' ? [IP.a, IP.b] : [IP.b, IP.a]
  const [ethSrc, ethDst] = from === 'a' ? [MAC.a, MAC.b] : [MAC.b, MAC.a]
  return {
    label: `Echo ${kind} ${src} → ${dst}`,
    innerLabel: `Echo ${kind}`,
    ethSrc,
    ethDst,
    length: 84,
    body: [
      { name: 'Src', value: src, description: FIELD_TEXT.src },
      { name: 'Dst', value: dst, description: FIELD_TEXT.dst },
      { name: 'Length', value: '84', description: FIELD_TEXT.length },
    ],
    description,
  }
}

function tcp(
  flow: FlowTuple,
  from: 'a' | 'b',
  length: number,
  label: string,
  innerLabel: string,
  description: LocalizedText,
): Frame {
  const [ethSrc, ethDst] = from === 'a' ? [MAC.a, MAC.b] : [MAC.b, MAC.a]
  return {
    label,
    innerLabel,
    ethSrc,
    ethDst,
    length,
    body: [
      { name: 'Src', value: `${flow.srcIp}:${String(flow.srcPort)}`, description: FIELD_TEXT.src },
      { name: 'Dst', value: `${flow.dstIp}:${String(flow.dstPort)}`, description: FIELD_TEXT.dst },
      { name: 'Length', value: String(length), description: FIELD_TEXT.length },
    ],
    description,
    flow,
  }
}

// ---------- VTEP とアンダーレイ ----------

interface ModelConfig {
  /** VNI ごとの、ホストのポート */
  readonly ports: Readonly<Record<Side, Readonly<Record<number, readonly string[]>>>>
  readonly flood: Readonly<Record<Side, Readonly<Record<number, FloodTarget>>>>
  /** トンネルの向こうを学習しない（コントロールプレーンが表を配る） */
  readonly noLearning?: boolean
  /** アンダーレイに等コストの経路が 2 つある（ECMP の状況だけ） */
  readonly ecmp?: boolean
}

/** ポートがレーンに対応するか（テナントの状況の vethC・vethD はレーンを持たない） */
function actorOfPort(port: string): ActorId | null {
  if (port === 'vethA') {
    return A
  }
  return port === 'vethB' ? B : null
}

function floodText(target: FloodTarget | null): string {
  if (target === null) {
    return ''
  }
  return target.kind === 'group' ? `group ${target.group}` : target.ips.join(', ')
}

/**
 * VTEP の表、コンテナーの ARP キャッシュ、アンダーレイの経路の表を持ち回り、矢印とともにイベントを作る。
 * 転送の判断は vtep.ts、送信元ポートと経路は entropy.ts から求めるので、表と矢印は食い違わない
 */
class VxlanModel {
  readonly config: ModelConfig
  fdb: Record<Side, readonly VtepEntry[]> = { host1: [], host2: [] }
  // 状態のイベントは表の配列をそのまま持つので、書き換えずに作り直す（前のステップの表が後の行を見せないように）
  private arp: Record<'a' | 'b', readonly (readonly string[])[]> = { a: [], b: [] }
  private paths: readonly (readonly string[])[] = []

  constructor(config: ModelConfig) {
    this.config = config
  }

  private localPorts(side: Side, vni: number): readonly string[] {
    return this.config.ports[side][vni] ?? []
  }

  private floodTarget(side: Side, vni: number): FloodTarget {
    return this.config.flood[side][vni] ?? { kind: 'vteps', ips: [] }
  }

  private fdbEvent(side: Side): StepEvent {
    return set(vtepOf(side), FDB, table(FDB_COLUMNS, fdbRows(this.fdb[side])))
  }

  /** コンテナーの ARP キャッシュに書く */
  containerLearns(who: 'a' | 'b', ip: string, mac: string): StepEvent {
    this.arp = { ...this.arp, [who]: [...this.arp[who], [ip, mac]] }
    return set(who === 'a' ? A : B, ARP, table(ARP_COLUMNS, this.arp[who]))
  }

  private vethMessage(
    id: string,
    from: ActorId,
    to: ActorId,
    frame: Frame,
    status: Message['status'],
  ) {
    return send({
      id,
      from,
      to,
      label: frame.label,
      status,
      description: frame.description,
      fields: [
        { name: 'Link', value: 'veth pair', description: FIELD_TEXT.link },
        { name: 'Eth Dst', value: frame.ethDst, description: FIELD_TEXT.ethDst },
        { name: 'Eth Src', value: frame.ethSrc, description: FIELD_TEXT.ethSrc },
        ...frame.body,
      ],
    })
  }

  /**
   * フレームがホストのポートから VTEP に入る。arrow が false なら、レーンのないコンテナー（vethC・vethD）から来た。
   * 戻り値の decision で、次に何をするかを決める
   */
  enter(
    id: string,
    side: Side,
    port: string,
    vni: number,
    frame: Frame,
    options: { readonly status?: Message['status'] } = {},
  ): { events: StepEvent[]; decision: VtepDecision } {
    const from = actorOfPort(port)
    const events: StepEvent[] = []
    if (from !== null) {
      events.push(this.vethMessage(id, from, vtepOf(side), frame, options.status ?? 'delivered'))
    }
    const before = this.fdb[side]
    this.fdb[side] = learnLocal(this.fdb[side], vni, frame.ethSrc, port)
    if (this.fdb[side] !== before) {
      events.push(this.fdbEvent(side))
    }
    const ingress: Ingress = { kind: 'port', port }
    const decision = decide(
      this.fdb[side],
      this.floodTarget(side, vni),
      vni,
      frame.ethDst,
      ingress,
      this.localPorts(side, vni),
    )
    return { events, decision }
  }

  /** 外側の送信元ポート（内側の流れのハッシュ。流れのない ARP などは固定の例の値） */
  outerSourcePort(frame: Frame): number {
    return frame.flow === undefined ? 49152 : sourcePort(frame.flow)
  }

  /**
   * VTEP がフレームを包み、アンダーレイを通して相手の VTEP へ届ける（2 本の矢印）。
   * toGroup ならマルチキャストグループへ送り、アンダーレイが参加している VTEP に複製する
   */
  tunnel(
    id: string,
    side: Side,
    vni: number,
    frame: Frame,
    options: { readonly toGroup?: boolean } = {},
  ): StepEvent[] {
    const toGroup = options.toGroup ?? false
    const dstIp = toGroup ? GROUP : hostIp(other(side))
    const srcPort = this.outerSourcePort(frame)
    const outer: FlowTuple = {
      proto: 'UDP',
      srcIp: hostIp(side),
      srcPort,
      dstIp,
      dstPort: VXLAN_PORT,
    }
    const path = this.config.ecmp === true ? `spine ${String(ecmpIndex(outer, 2) + 1)}` : null
    const label = `VXLAN ${String(vni)} [${frame.innerLabel}]`
    const [firstDst, secondDst] = toGroup
      ? [multicastMac(GROUP), multicastMac(GROUP)]
      : [side === 'host1' ? MAC.router1 : MAC.router2, side === 'host1' ? MAC.host2 : MAC.host1]
    const [firstSrc, secondSrc] =
      side === 'host1' ? [MAC.host1, MAC.router2] : [MAC.host2, MAC.router1]
    const fields = (ethDst: string, ethSrc: string, ttl: number): PacketField[] => [
      { name: 'Outer Eth Dst', value: ethDst, description: FIELD_TEXT.outerEthDst },
      { name: 'Outer Eth Src', value: ethSrc, description: FIELD_TEXT.outerEthSrc },
      {
        name: 'Outer IP Src',
        value: hostIp(side),
        highlight: true,
        description: FIELD_TEXT.outerIpSrc,
      },
      { name: 'Outer IP Dst', value: dstIp, highlight: true, description: FIELD_TEXT.outerIpDst },
      { name: 'TTL', value: String(ttl), description: FIELD_TEXT.ttl },
      {
        name: 'Total Length',
        value: String(outerIpLength(frame.length)),
        description: FIELD_TEXT.totalLength,
      },
      { name: 'UDP Src', value: String(srcPort), description: FIELD_TEXT.udpSrc },
      { name: 'UDP Dst', value: String(VXLAN_PORT), description: FIELD_TEXT.udpDst },
      { name: 'UDP Checksum', value: '0', description: FIELD_TEXT.udpChecksum },
      {
        name: 'VXLAN',
        value: formatHeaderBytes(encodeVxlanHeader(vni)),
        description: FIELD_TEXT.vxlanHeader,
      },
      { name: 'VNI', value: String(vni), highlight: true, description: FIELD_TEXT.vni },
      ...(path === null ? [] : [{ name: 'Path', value: path, description: FIELD_TEXT.path }]),
      { name: 'Inner Eth Dst', value: frame.ethDst, description: FIELD_TEXT.ethDst },
      { name: 'Inner Eth Src', value: frame.ethSrc, description: FIELD_TEXT.ethSrc },
      ...frame.body.map((field) => ({ ...field, name: `Inner ${field.name}` })),
    ]
    const events: StepEvent[] = [
      send({
        id: `${id}-out`,
        from: vtepOf(side),
        to: U,
        label,
        status: 'delivered',
        description: frame.description,
        fields: fields(firstDst, firstSrc, TTL),
      }),
    ]
    if (path !== null) {
      if (!this.paths.some((row) => row[0] === String(srcPort))) {
        this.paths = [...this.paths, [String(srcPort), path]]
      }
      events.push(set(U, PATHS, table(PATH_COLUMNS, this.paths)))
    }
    events.push(
      set(
        U,
        DECISION,
        toGroup
          ? `multicast: copy to ${hostIp(other(side))}`
          : path === null
            ? `route: → ${dstIp}, TTL ${String(TTL - 1)}`
            : `ECMP: via ${path}`,
      ),
      send({
        id: `${id}-in`,
        from: U,
        to: vtepOf(other(side)),
        label,
        status: 'delivered',
        description: frame.description,
        fields: fields(secondDst, secondSrc, TTL - 1),
      }),
    )
    return events
  }

  /** 相手の VTEP がカプセル化を解き、学習して、ホストのポートへ送る */
  exit(id: string, side: Side, vni: number, frame: Frame): StepEvent[] {
    const events: StepEvent[] = []
    const remoteIp = hostIp(other(side))
    if (this.config.noLearning !== true) {
      const before = this.fdb[side]
      this.fdb[side] = learnRemote(this.fdb[side], vni, frame.ethSrc, remoteIp)
      if (this.fdb[side] !== before) {
        events.push(this.fdbEvent(side))
      }
    }
    const decision = decide(
      this.fdb[side],
      this.floodTarget(side, vni),
      vni,
      frame.ethDst,
      { kind: 'tunnel' },
      this.localPorts(side, vni),
    )
    const out =
      decision.kind === 'flood' ? decision.ports : decision.kind === 'local' ? [decision.port] : []
    const where = out.length === 0 ? 'nobody' : out.join(', ')
    events.push(
      set(
        vtepOf(side),
        DECISION,
        decision.kind === 'flood'
          ? `decap: VNI ${String(vni)}, flood: ${where}`
          : `decap: VNI ${String(vni)} → ${where}`,
      ),
    )
    for (const port of out) {
      const to = actorOfPort(port)
      if (to !== null) {
        events.push(this.vethMessage(`${id}-deliver`, vtepOf(side), to, frame, 'delivered'))
      }
    }
    return events
  }

  /** ホストのポートから入り、カプセル化してアンダーレイを通り、相手のポートに届くまで（4 本の矢印） */
  carry(id: string, side: Side, port: string, vni: number, frame: Frame): StepEvent[] {
    const { events, decision } = this.enter(id, side, port, vni, frame)
    if (decision.kind !== 'encap') {
      throw new Error(`${id}: 相手の VTEP が表にない（${decision.kind}）`)
    }
    return [
      ...events,
      set(vtepOf(side), DECISION, `encap: VNI ${String(vni)} → ${decision.vtep}`),
      ...this.tunnel(id, side, vni, frame),
      ...this.exit(id, other(side), vni, frame),
    ]
  }

  /** 準備: 前の通信で両方の VTEP が A と B を学習している */
  preLearned(): void {
    this.fdb.host1 = learnRemote(learnLocal([], RED, MAC.a, 'vethA'), RED, MAC.b, HOST2_IP)
    this.fdb.host2 = learnRemote(learnLocal([], RED, MAC.b, 'vethB'), RED, MAC.a, HOST1_IP)
  }

  setupEvents(): StepEvent[] {
    return [this.fdbEvent('host1'), this.fdbEvent('host2')]
  }
}

// ---------- 準備 ----------

const HEAD_END: ModelConfig['flood'] = {
  host1: { [RED]: { kind: 'vteps', ips: [HOST2_IP] } },
  host2: { [RED]: { kind: 'vteps', ips: [HOST1_IP] } },
}
const RED_PORTS: ModelConfig['ports'] = {
  host1: { [RED]: ['vethA'] },
  host2: { [RED]: ['vethB'] },
}

const deviceConfig = (side: Side, extra = '') =>
  `vxlan${String(RED)}: VNI ${String(RED)}, local ${hostIp(side)}, dstport ${String(VXLAN_PORT)}${extra}`

function baseSetup(mtu: number, flood: ModelConfig['flood'], extra = ''): StepEvent[] {
  const floodRows = (side: Side) =>
    Object.entries(flood[side]).map(([vni, target]) => [
      vni,
      target.kind === 'group' ? `${target.group} (group)` : target.ips.join(', '),
    ])
  return [
    set(A, IFACE, `eth0 ${IP.a}/24 mtu ${String(mtu)}`),
    set(B, IFACE, `eth0 ${IP.b}/24 mtu ${String(mtu)}`),
    set(V1, CONFIG, deviceConfig('host1', extra)),
    set(V2, CONFIG, deviceConfig('host2', extra)),
    set(V1, FLOOD, table(FLOOD_COLUMNS, floodRows('host1'))),
    set(V2, FLOOD, table(FLOOD_COLUMNS, floodRows('host2'))),
    set(
      U,
      ROUTES,
      table(ROUTE_COLUMNS, [
        ['192.0.2.0/24', 'connected'],
        ['198.51.100.0/24', 'connected'],
      ]),
    ),
  ]
}

const SETUP_BASE = {
  en: `Containers A and B are on two different hosts, but both are on one overlay segment, 10.0.0.0/24, VNI ${String(RED)}. Each host has a VTEP: a VXLAN device attached to the host’s bridge. The hosts can reach each other only over an ordinary routed IP network, the underlay (${HOST1_IP} and ${HOST2_IP}).`,
  ja: `コンテナー A と B は別々のホストにいるが、どちらも 1 つのオーバーレイのセグメント 10.0.0.0/24（VNI ${String(RED)}）にいる。各ホストには VTEP がある。ホストのブリッジにつながった VXLAN のデバイス。ホスト同士は、ふつうの経路制御の IP ネットワーク（アンダーレイ。${HOST1_IP} と ${HOST2_IP}）でしかつながっていない。`,
} as const

const SETUP_TEXT = {
  en: `${SETUP_BASE.en} The containers’ MTU is 1450, so that 50 bytes are left for the VXLAN headers.`,
  ja: `${SETUP_BASE.ja}コンテナーの MTU は 1450 で、VXLAN のヘッダーのために 50 バイトを残してある。`,
} as const

const insideText = {
  en: 'Inside the overlay: an ordinary Ethernet frame.',
  ja: 'オーバーレイの中。ふつうの Ethernet のフレーム。',
}
const tunnelText = {
  en: 'In the underlay: the whole frame is carried inside UDP.',
  ja: 'アンダーレイの中。フレーム全体が UDP の中に入って運ばれる。',
}

// ---------- 状況ごとのステップ ----------

/** 最初の通信: 送信元での複製で流し、学習する */
function firstContactSteps(): Step[] {
  const model = new VxlanModel({ ports: RED_PORTS, flood: HEAD_END })
  const request = arpRequest(IP.a, MAC.a, IP.b, {
    en: `Who has ${IP.b}? A thinks it is on the same LAN as B.`,
    ja: `${IP.b} は誰？ A は B と同じ LAN にいると思っている。`,
  })
  const reply = arpReply(IP.b, MAC.b, MAC.a, {
    en: `${IP.b} is at ${MAC.b}.`,
    ja: `${IP.b} は ${MAC.b}。`,
  })
  const requestIn = model.enter('arp-request', 'host1', 'vethA', RED, request)
  const replyIn = (): StepEvent[] => {
    const entered = model.enter('arp-reply', 'host2', 'vethB', RED, reply)
    if (entered.decision.kind !== 'encap') {
      throw new Error('arp-reply: A が表にない')
    }
    return [
      ...entered.events,
      set(V2, DECISION, `encap: VNI ${String(RED)} → ${entered.decision.vtep}`),
      ...model.tunnel('arp-reply', 'host2', RED, reply),
    ]
  }
  return [
    {
      id: 'setup',
      title: { en: 'Two hosts, one overlay LAN', ja: '2 台のホスト、1 つのオーバーレイの LAN' },
      description: {
        en: `${SETUP_TEXT.en} Each VTEP has a flood list for VNI ${String(RED)}: the other VTEP’s address, written by the operator. Both forwarding tables are empty.`,
        ja: `${SETUP_TEXT.ja}各 VTEP は VNI ${String(RED)} の流す先の一覧（相手の VTEP のアドレス。運用者が書いた）を持つ。どちらの転送の表も空。`,
      },
      events: baseSetup(1450, HEAD_END),
    },
    {
      id: 'arp-request',
      title: { en: 'A asks for B’s MAC address', ja: 'A が B の MAC アドレスを尋ねる' },
      description: {
        en: 'A sends an ordinary ARP broadcast. VTEP 1 learns that A is behind vethA. The destination is a broadcast, so it must go to every member of VNI 100, including those on the other host: VTEP 1 floods it to the addresses in its flood list.',
        ja: 'A はふつうの ARP のブロードキャストを送る。VTEP 1 は A が vethA の先にいると学習する。宛先はブロードキャストなので、VNI 100 のすべての参加者（別のホストにいるものも）に届けなければならない。VTEP 1 は、流す先の一覧のアドレスに流す。',
      },
      events: [
        ...requestIn.events,
        set(
          V1,
          DECISION,
          `flood: ${floodText(requestIn.decision.kind === 'flood' ? requestIn.decision.remote : null)} (head-end)`,
        ),
      ],
    },
    {
      id: 'encap',
      title: { en: 'VTEP 1 wraps the frame in UDP', ja: 'VTEP 1 がフレームを UDP で包む' },
      description: {
        en: `VTEP 1 puts the whole Ethernet frame behind an 8-byte VXLAN header with VNI ${String(RED)}, then a UDP header (destination port ${String(VXLAN_PORT)}) and an outer IP header from ${HOST1_IP} to ${HOST2_IP}. For the underlay this is just a UDP packet between two hosts, and it routes it like any other (TTL 64 → 63). The 28-byte ARP message becomes a 78-byte IP packet.`,
        ja: `VTEP 1 は Ethernet のフレーム全体の前に、VNI ${String(RED)} の 8 バイトの VXLAN のヘッダー、UDP のヘッダー（宛先ポート ${String(VXLAN_PORT)}）、${HOST1_IP} から ${HOST2_IP} への外側の IP のヘッダーを付ける。アンダーレイにとっては 2 台のホストの間のただの UDP のパケットで、ほかと同じように経路を選んで送る（TTL は 64 → 63）。28 バイトの ARP のメッセージは、78 バイトの IP パケットになる。`,
      },
      events: model.tunnel('arp-request', 'host1', RED, { ...request, description: tunnelText }),
    },
    {
      id: 'decap-learn',
      title: {
        en: 'VTEP 2 unwraps it and learns where A is',
        ja: 'VTEP 2 が包みを解き、A の居場所を学習する',
      },
      description: {
        en: `VTEP 2 checks the I flag and the VNI, removes the outer headers, and learns from the packet: in VNI ${String(RED)}, ${MAC.a} is behind ${HOST1_IP} (RFC 7348 §4.1). The inner frame is a broadcast, so it floods it to its own ports only, never back into the tunnel. B is the target of the ARP request and records A in its ARP cache.`,
        ja: `VTEP 2 はフラグ I と VNI を確かめ、外側のヘッダーを外し、パケットから学習する。VNI ${String(RED)} では ${MAC.a} は ${HOST1_IP} の先にいる（RFC 7348 §4.1）。内側のフレームはブロードキャストなので、自分のポートにだけ流し、トンネルには流し返さない。B は ARP の要求の対象なので、A を ARP キャッシュに書く。`,
      },
      events: [
        ...model.exit('arp-request', 'host2', RED, request),
        model.containerLearns('b', IP.a, MAC.a),
      ],
    },
    {
      id: 'arp-reply',
      title: { en: 'The reply goes straight to VTEP 1', ja: '応答は VTEP 1 へまっすぐ届く' },
      description: {
        en: `B answers with a unicast ARP reply. VTEP 2 learns B on vethB. It already knows that ${MAC.a} is behind ${HOST1_IP}, learned from the request, so it sends the reply only to VTEP 1, without flooding.`,
        ja: `B はユニキャストの ARP の応答を返す。VTEP 2 は B を vethB で学習する。要求から ${MAC.a} が ${HOST1_IP} の先にいると知っているので、流さずに VTEP 1 にだけ送る。`,
      },
      events: replyIn(),
    },
    {
      id: 'learn-back',
      title: { en: 'VTEP 1 learns where B is', ja: 'VTEP 1 が B の居場所を学習する' },
      description: {
        en: `VTEP 1 learns that ${MAC.b} is behind ${HOST2_IP} and delivers the reply to A. Both VTEPs now know both containers, and nothing needs to be flooded any more.`,
        ja: `VTEP 1 は ${MAC.b} が ${HOST2_IP} の先にいると学習し、応答を A に渡す。これで両方の VTEP が両方のコンテナーを知り、もう何も流す必要はない。`,
      },
      events: [
        ...model.exit('arp-reply', 'host1', RED, reply),
        model.containerLearns('a', IP.b, MAC.b),
      ],
    },
    {
      id: 'echo',
      title: { en: 'A pings B across the underlay', ja: 'A がアンダーレイを越えて B に ping する' },
      description: {
        en: 'The 84-byte Echo Request is carried in a 134-byte outer packet: the 50 bytes are the inner Ethernet header (14), VXLAN (8), UDP (8) and the outer IP header (20).',
        ja: '84 バイトの Echo Request は、134 バイトの外側のパケットで運ばれる。50 バイトは、内側の Ethernet のヘッダー（14）、VXLAN（8）、UDP（8）、外側の IP のヘッダー（20）。',
      },
      events: model.carry('echo', 'host1', 'vethA', RED, echo('Request', 'a', insideText)),
    },
    {
      id: 'echo-reply',
      title: { en: 'B answers', ja: 'B が答える' },
      description: {
        en: 'The reply takes the same path back. Neither container ever saw a VXLAN header: to them, the other host’s container is just another machine on their LAN.',
        ja: '返事も同じ道を戻る。どちらのコンテナーも VXLAN のヘッダーを見ることはない。コンテナーにとって、別のホストのコンテナーは同じ LAN の上のほかの機械にすぎない。',
      },
      events: model.carry('echo-reply', 'host2', 'vethB', RED, echo('Reply', 'b', insideText)),
    },
  ]
}

/** マルチキャストグループで流す */
function multicastSteps(): Step[] {
  const flood: ModelConfig['flood'] = {
    host1: { [RED]: { kind: 'group', group: GROUP } },
    host2: { [RED]: { kind: 'group', group: GROUP } },
  }
  const model = new VxlanModel({ ports: RED_PORTS, flood })
  const request = arpRequest(IP.a, MAC.a, IP.b, {
    en: `Who has ${IP.b}?`,
    ja: `${IP.b} は誰？`,
  })
  const reply = arpReply(IP.b, MAC.b, MAC.a, {
    en: `${IP.b} is at ${MAC.b}.`,
    ja: `${IP.b} は ${MAC.b}。`,
  })
  const entered = model.enter('arp-request', 'host1', 'vethA', RED, request)
  return [
    {
      id: 'setup',
      title: {
        en: 'VNI 100 is mapped to a multicast group',
        ja: 'VNI 100 をマルチキャストグループに対応づける',
      },
      description: {
        en: `${SETUP_TEXT.en} Here the operator mapped VNI ${String(RED)} to the multicast group ${GROUP} instead of listing the other VTEPs. Both VTEPs have joined the group (with IGMP), and the underlay knows the members.`,
        ja: `${SETUP_TEXT.ja}ここでは運用者は、相手の VTEP を並べる代わりに、VNI ${String(RED)} をマルチキャストグループ ${GROUP} に対応づけた。両方の VTEP は（IGMP で）グループに参加していて、アンダーレイは参加者を知っている。`,
      },
      events: [
        ...baseSetup(1450, flood, `, group ${GROUP}, ttl 64`),
        set(U, GROUPS, table(GROUP_COLUMNS, [[GROUP, `${HOST1_IP}, ${HOST2_IP}`]])),
      ],
    },
    {
      id: 'arp-request',
      title: { en: 'A asks for B’s MAC address', ja: 'A が B の MAC アドレスを尋ねる' },
      description: {
        en: 'VTEP 1 learns A on vethA and floods the broadcast to the group of VNI 100.',
        ja: 'VTEP 1 は A を vethA で学習し、ブロードキャストを VNI 100 のグループに流す。',
      },
      events: [...entered.events, set(V1, DECISION, `flood: group ${GROUP}`)],
    },
    {
      id: 'to-group',
      title: {
        en: 'One copy to the group; the underlay replicates it',
        ja: 'グループに 1 つ送り、アンダーレイが複製する',
      },
      description: {
        en: `VTEP 1 sends a single packet to ${GROUP}. Its outer destination MAC address is the group’s multicast MAC, ${multicastMac(GROUP)} (the low 23 bits of the group address, RFC 1112). The underlay copies it to every member except the sender. With many VTEPs, the sender still sends only one copy.`,
        ja: `VTEP 1 は ${GROUP} に 1 つのパケットだけを送る。外側の宛先の MAC アドレスは、グループのマルチキャストの MAC アドレス ${multicastMac(GROUP)}（グループのアドレスの下位 23 ビット。RFC 1112）。アンダーレイは、送った VTEP 以外のすべての参加者に複製する。VTEP がたくさんあっても、送る側は 1 つ送るだけ。`,
      },
      events: model.tunnel(
        'arp-request',
        'host1',
        RED,
        { ...request, description: tunnelText },
        { toGroup: true },
      ),
    },
    {
      id: 'decap-learn',
      title: {
        en: 'VTEP 2 learns A behind VTEP 1, not behind the group',
        ja: 'VTEP 2 は、A がグループではなく VTEP 1 の先にいると学習する',
      },
      description: {
        en: `VTEP 2 learns from the outer source address, ${HOST1_IP}, which is a unicast address; the group is only where the packet was sent. B records A.`,
        ja: `VTEP 2 は外側の送信元のアドレス ${HOST1_IP}（ユニキャストのアドレス）から学習する。グループはパケットの送り先にすぎない。B は A を記録する。`,
      },
      events: [
        ...model.exit('arp-request', 'host2', RED, request),
        model.containerLearns('b', IP.a, MAC.a),
      ],
    },
    {
      id: 'unicast-reply',
      title: { en: 'The reply is unicast', ja: '応答はユニキャスト' },
      description: {
        en: 'VTEP 2 knows where A is, so the reply goes to VTEP 1 as unicast, not to the group (RFC 7348 §4.2). The group is only for broadcasts and unknown destinations.',
        ja: 'VTEP 2 は A の居場所を知っているので、応答はグループではなく、ユニキャストで VTEP 1 に送る（RFC 7348 §4.2）。グループを使うのは、ブロードキャストと知らない宛先だけ。',
      },
      events: [
        ...model.carry('arp-reply', 'host2', 'vethB', RED, reply),
        model.containerLearns('a', IP.b, MAC.b),
      ],
    },
  ]
}

/** コントロールプレーンが表を配る */
function controlPlaneSteps(): Step[] {
  const model = new VxlanModel({ ports: RED_PORTS, flood: HEAD_END, noLearning: true })
  model.fdb.host1 = [{ vni: RED, mac: MAC.b, where: HOST2_IP, remote: true, type: 'static' }]
  model.fdb.host2 = [{ vni: RED, mac: MAC.a, where: HOST1_IP, remote: true, type: 'static' }]
  const request = arpRequest(IP.a, MAC.a, IP.b, { en: `Who has ${IP.b}?`, ja: `${IP.b} は誰？` })
  const entered = model.enter('arp-request', 'host1', 'vethA', RED, request)
  const proxied = arpReply(IP.b, MAC.b, MAC.a, {
    en: `VTEP 1 answers for B: ${IP.b} is at ${MAC.b}.`,
    ja: `VTEP 1 が B の代わりに答える。${IP.b} は ${MAC.b}。`,
  })
  return [
    {
      id: 'setup',
      title: {
        en: 'A control plane has filled in the tables',
        ja: 'コントロールプレーンが表を埋めた',
      },
      description: {
        en: `${SETUP_TEXT.en} Here the VTEPs do not learn from the tunnel (nolearning). A control plane, for example EVPN routes carried by BGP (RFC 8365), has told each VTEP which MAC and IP addresses are behind the other one. VTEP 1 also knows B’s IP address, so it can answer ARP itself.`,
        ja: `${SETUP_TEXT.ja}ここでは VTEP はトンネルから学習しない（nolearning）。コントロールプレーン（例えば BGP で運ぶ EVPN の経路。RFC 8365）が、相手の VTEP の先にどの MAC アドレスと IP アドレスがあるかを各 VTEP に伝えた。VTEP 1 は B の IP アドレスも知っているので、ARP に自分で答えられる。`,
      },
      events: [
        ...baseSetup(1450, HEAD_END, ', nolearning, proxy'),
        ...model.setupEvents(),
        set(V1, NEIGH, table(ARP_COLUMNS, [[IP.b, MAC.b]])),
      ],
    },
    {
      id: 'proxy-arp',
      title: { en: 'VTEP 1 answers the ARP itself', ja: 'VTEP 1 が ARP に自分で答える' },
      description: {
        en: 'VTEP 1 finds 10.0.0.2 in its neighbor table and answers for B (proxy ARP, RFC 9161). The broadcast never crosses the underlay: with a control plane, most flooding disappears.',
        ja: 'VTEP 1 は近隣の表で 10.0.0.2 を見つけ、B の代わりに答える（代理 ARP。RFC 9161）。ブロードキャストはアンダーレイを越えない。コントロールプレーンがあれば、流すことはほとんどなくなる。',
      },
      events: [
        ...entered.events,
        set(V1, DECISION, `proxy ARP: ${IP.b} is at ${MAC.b}`),
        send({
          id: 'proxy-arp-reply',
          from: V1,
          to: A,
          label: proxied.label,
          status: 'delivered',
          description: proxied.description,
          fields: [
            { name: 'Link', value: 'veth pair', description: FIELD_TEXT.link },
            { name: 'Eth Dst', value: proxied.ethDst, description: FIELD_TEXT.ethDst },
            { name: 'Eth Src', value: proxied.ethSrc, description: FIELD_TEXT.ethSrc },
            ...proxied.body,
          ],
        }),
        model.containerLearns('a', IP.b, MAC.b),
      ],
    },
    {
      id: 'echo',
      title: { en: 'A pings B', ja: 'A が B に ping する' },
      description: {
        en: 'VTEP 1 already has a row for B, so it sends the frame straight to VTEP 2. VTEP 2 does not learn from it: its row for A came from the control plane.',
        ja: 'VTEP 1 には B の行がもうあるので、フレームをそのまま VTEP 2 に送る。VTEP 2 はここから学習しない。A の行はコントロールプレーンから来た。',
      },
      events: model.carry('echo', 'host1', 'vethA', RED, echo('Request', 'a', insideText)),
    },
    {
      id: 'echo-reply',
      title: { en: 'B answers', ja: 'B が答える' },
      description: {
        en: 'The reply follows the static row back to VTEP 1.',
        ja: '返事は静的な行に従って VTEP 1 へ戻る。',
      },
      events: model.carry('echo-reply', 'host2', 'vethB', RED, echo('Reply', 'b', insideText)),
    },
  ]
}

/** 1 つのアンダーレイに 2 つのテナント */
function tenantsSteps(): Step[] {
  const ports: ModelConfig['ports'] = {
    host1: { [RED]: ['vethA'], [BLUE]: ['vethC'] },
    host2: { [RED]: ['vethB'], [BLUE]: ['vethD'] },
  }
  const flood: ModelConfig['flood'] = {
    host1: {
      [RED]: { kind: 'vteps', ips: [HOST2_IP] },
      [BLUE]: { kind: 'vteps', ips: [HOST2_IP] },
    },
    host2: {
      [RED]: { kind: 'vteps', ips: [HOST1_IP] },
      [BLUE]: { kind: 'vteps', ips: [HOST1_IP] },
    },
  }
  const model = new VxlanModel({ ports, flood })
  const redRequest = arpRequest(IP.a, MAC.a, IP.b, {
    en: `Red tenant: who has ${IP.b}?`,
    ja: `赤のテナント: ${IP.b} は誰？`,
  })
  const redReply = arpReply(IP.b, MAC.b, MAC.a, {
    en: `${IP.b} is at ${MAC.b}.`,
    ja: `${IP.b} は ${MAC.b}。`,
  })
  const blueRequest = arpRequest(IP.b, MAC.d, IP.a, {
    en: `Blue tenant: who has ${IP.a}?`,
    ja: `青のテナント: ${IP.a} は誰？`,
  })
  const red = model.enter('red-arp', 'host1', 'vethA', RED, redRequest)
  const blue = (): StepEvent[] => {
    const entered = model.enter('blue-arp', 'host2', 'vethD', BLUE, blueRequest)
    return [
      ...entered.events,
      set(V2, DECISION, `flood: VNI ${String(BLUE)} only (from vethD)`),
      ...model.tunnel('blue-arp', 'host2', BLUE, { ...blueRequest, description: tunnelText }),
    ]
  }
  return [
    {
      id: 'setup',
      title: { en: 'Two tenants share the hosts', ja: '2 つのテナントがホストを分け合う' },
      description: {
        en: `${SETUP_TEXT.en} A second tenant (blue) also runs containers on both hosts: C on host 1 and D on host 2, on VNI ${String(BLUE)}. It uses the same addresses, 10.0.0.0/24: C is also 10.0.0.1 and D is also 10.0.0.2. C and D are not drawn as lanes.`,
        ja: `${SETUP_TEXT.ja}2 つ目のテナント（青）も、両方のホストでコンテナーを動かしている。ホスト 1 の C とホスト 2 の D で、VNI は ${String(BLUE)}。同じアドレス 10.0.0.0/24 を使い、C も 10.0.0.1、D も 10.0.0.2。C と D はレーンとして描かない。`,
      },
      events: [
        ...baseSetup(1450, flood),
        set(
          V1,
          SEGMENTS,
          table(SEGMENT_COLUMNS, [
            [String(RED), 'vethA'],
            [String(BLUE), 'vethC'],
          ]),
        ),
        set(
          V2,
          SEGMENTS,
          table(SEGMENT_COLUMNS, [
            [String(RED), 'vethB'],
            [String(BLUE), 'vethD'],
          ]),
        ),
      ],
    },
    {
      id: 'red-arp',
      title: { en: 'A (red) asks for 10.0.0.2', ja: 'A（赤）が 10.0.0.2 を尋ねる' },
      description: {
        en: `VTEP 1 floods the broadcast within VNI ${String(RED)} only. The blue container C on the same host is on another segment and does not get it.`,
        ja: `VTEP 1 はブロードキャストを VNI ${String(RED)} の中にだけ流す。同じホストの青のコンテナー C は別のセグメントにいて、受け取らない。`,
      },
      events: [
        ...red.events,
        set(V1, DECISION, `flood: VNI ${String(RED)} only (${HOST2_IP})`),
        ...model.tunnel('red-arp', 'host1', RED, { ...redRequest, description: tunnelText }),
      ],
    },
    {
      id: 'red-decap',
      title: { en: 'Only B receives it', ja: 'B だけが受け取る' },
      description: {
        en: `VTEP 2 reads VNI ${String(RED)} and floods the frame to the ports of that segment only. D, the blue container with the same address 10.0.0.2, never sees it.`,
        ja: `VTEP 2 は VNI ${String(RED)} を読み、そのセグメントのポートにだけ流す。同じアドレス 10.0.0.2 を持つ青のコンテナー D には届かない。`,
      },
      events: [
        ...model.exit('red-arp', 'host2', RED, redRequest),
        model.containerLearns('b', IP.a, MAC.a),
      ],
    },
    {
      id: 'red-reply',
      title: { en: 'B answers A', ja: 'B が A に答える' },
      description: {
        en: 'The reply returns within the red segment.',
        ja: '応答は赤のセグメントの中を戻る。',
      },
      events: [
        ...model.carry('red-reply', 'host2', 'vethB', RED, redReply),
        model.containerLearns('a', IP.b, MAC.b),
      ],
    },
    {
      id: 'blue-arp',
      title: { en: 'D (blue) asks for 10.0.0.1', ja: 'D（青）が 10.0.0.1 を尋ねる' },
      description: {
        en: `In the blue tenant, D asks for 10.0.0.1, which is C. VTEP 2 floods it within VNI ${String(BLUE)}. In the underlay, the only difference from the red packets is the VNI in the VXLAN header.`,
        ja: `青のテナントで、D が 10.0.0.1（C）を尋ねる。VTEP 2 は VNI ${String(BLUE)} の中に流す。アンダーレイの中で赤のパケットと違うのは、VXLAN のヘッダーの VNI だけ。`,
      },
      events: blue(),
    },
    {
      id: 'blue-decap',
      title: { en: 'Only C receives it, not A', ja: 'C だけが受け取り、A は受け取らない' },
      description: {
        en: `VTEP 1 floods the frame to the ports of VNI ${String(BLUE)}: only C. A also has 10.0.0.1, but it gets nothing, and its ARP cache is unchanged. The forwarding tables now hold rows for both VNIs, and the same kind of address can appear in both without any conflict.`,
        ja: `VTEP 1 はフレームを VNI ${String(BLUE)} のポート（C だけ）に流す。A も 10.0.0.1 を持つが、何も受け取らず、ARP キャッシュも変わらない。転送の表には両方の VNI の行があり、同じようなアドレスが両方にあってもぶつからない。`,
      },
      events: model.exit('blue-arp', 'host1', BLUE, blueRequest),
    },
  ]
}

/** オーバーレイの MTU が大きすぎる */
function mtuSteps(): Step[] {
  const model = new VxlanModel({ ports: RED_PORTS, flood: HEAD_END })
  model.preLearned()
  const flow: FlowTuple = { proto: 'TCP', srcIp: IP.a, srcPort: 40001, dstIp: IP.b, dstPort: 443 }
  const segment = (data: number, description: LocalizedText) =>
    tcp(
      flow,
      'a',
      data + 40,
      `TCP data (${String(data)} bytes)`,
      `TCP data (${String(data)} bytes)`,
      description,
    )
  const big = segment(1460, {
    en: 'A full-sized segment: a 1500-byte IP packet.',
    ja: '最大の大きさのセグメント。1500 バイトの IP パケット。',
  })
  const enterBig = (id: string) => {
    const entered = model.enter(id, 'host1', 'vethA', RED, big, { status: 'rejected' })
    return [...entered.events, set(V1, DECISION, 'drop: 1550 > MTU 1500')]
  }
  return [
    {
      id: 'setup',
      title: { en: 'The containers still use MTU 1500', ja: 'コンテナーの MTU が 1500 のまま' },
      description: {
        en: `${SETUP_BASE.en} But here the containers were given MTU 1500, like ordinary hosts, and every underlay link also has MTU 1500. A has opened a TCP connection to B. The handshake packets were small, so they passed, and both sides announced MSS 1460.`,
        ja: `${SETUP_BASE.ja}しかしここでは、コンテナーの MTU をふつうのホストと同じ 1500 にしてしまい、アンダーレイのリンクもすべて MTU 1500。A は B に TCP の接続を開いた。ハンドシェイクのパケットは小さいので通り、両側が MSS 1460 を通知した。`,
      },
      events: [
        ...baseSetup(1500, HEAD_END),
        ...model.setupEvents(),
        model.containerLearns('a', IP.b, MAC.b),
        model.containerLearns('b', IP.a, MAC.a),
        set(A, SOCKET, `TCP ${IP.a}:40001 → ${IP.b}:443 (MSS 1460)`),
      ],
    },
    {
      id: 'small',
      title: { en: 'Small segments get through', ja: '小さなセグメントは通る' },
      description: {
        en: 'A sends 100 bytes of data: a 140-byte IP packet, carried in a 190-byte outer packet.',
        ja: 'A は 100 バイトのデータを送る。140 バイトの IP パケットで、190 バイトの外側のパケットで運ばれる。',
      },
      events: model.carry('small', 'host1', 'vethA', RED, segment(100, insideText)),
    },
    {
      id: 'big',
      title: {
        en: 'A full-sized segment does not fit',
        ja: '最大の大きさのセグメントは収まらない',
      },
      description: {
        en: 'A sends 1460 bytes: a 1500-byte IP packet, which fits A’s own MTU. With VXLAN it would become 1550 bytes, more than the underlay’s 1500. The VTEP MUST NOT fragment VXLAN packets (RFC 7348 §4.3), and it is only a bridge for the inner packet, so it cannot fragment that either. It drops the frame. RFC 7348 defines no error message for this, and nothing comes back to A.',
        ja: 'A は 1460 バイトを送る。1500 バイトの IP パケットで、A 自身の MTU には収まる。VXLAN で包むと 1550 バイトになり、アンダーレイの 1500 を超える。VTEP は VXLAN のパケットを断片化してはならず（RFC 7348 §4.3）、内側のパケットにとってはブリッジにすぎないので、それも断片化できない。フレームを捨てる。RFC 7348 はこのときのエラーのメッセージを決めておらず、A には何も返らない。',
      },
      events: enterBig('big'),
    },
    {
      id: 'rto',
      title: { en: 'A retransmits into a black hole', ja: 'A はブラックホールへ再送する' },
      description: {
        en: 'No acknowledgment arrives, so A retransmits after its retransmission timeout, with the same size, and it is dropped again. Small packets pass and big ones vanish: the same black hole as in the path MTU discovery theme.',
        ja: '確認応答が来ないので、A は再送タイムアウトのあと同じ大きさで再送し、また捨てられる。小さなパケットは通り、大きなものは消える。パス MTU 探索のテーマと同じブラックホール。',
      },
      events: [
        { kind: 'timer', actorId: A, name: 'RTO', durationMs: 1000 },
        ...enterBig('retransmit'),
      ],
    },
    {
      id: 'fix',
      title: { en: 'The fix: leave room for 50 bytes', ja: '直し方: 50 バイトの余裕を残す' },
      description: {
        en: 'The operator sets the containers’ MTU to 1450, the underlay MTU minus 50. That is also the MTU Linux gives a VXLAN device created with a lower device (dev). On a new connection, both sides announce MSS 1410. The other fix is to raise the underlay MTU to at least 1550, for example with 9000-byte jumbo frames: RFC 7348 §4.3 recommends that the underlay MTU accommodate the encapsulated size.',
        ja: '運用者はコンテナーの MTU を 1450（アンダーレイの MTU − 50）にする。Linux が下のデバイス（dev）を指定して作った VXLAN のデバイスに既定で設定するのも、この値。新しい接続では、両側が MSS 1410 を通知する。もう 1 つの直し方は、アンダーレイの MTU を 1550 以上（例えば 9000 バイトのジャンボフレーム）にすること。RFC 7348 §4.3 が推奨するのはこちら（アンダーレイの MTU を包んだ大きさに合わせること）。',
      },
      events: [
        set(A, IFACE, `eth0 ${IP.a}/24 mtu 1450`),
        set(B, IFACE, `eth0 ${IP.b}/24 mtu 1450`),
        set(A, SOCKET, `TCP ${IP.a}:40001 → ${IP.b}:443 (MSS 1410)`),
      ],
    },
    {
      id: 'fits',
      title: { en: 'Now it fits exactly', ja: 'これでちょうど収まる' },
      description: {
        en: 'A full-sized segment is now 1410 bytes of data: a 1450-byte IP packet and a 1500-byte outer packet.',
        ja: '最大の大きさのセグメントは 1410 バイトのデータになる。1450 バイトの IP パケットと、1500 バイトの外側のパケット。',
      },
      events: model.carry('fits', 'host1', 'vethA', RED, segment(1410, insideText)),
    },
  ]
}

/** 外側の送信元ポートと等コストの経路 */
function ecmpSteps(): Step[] {
  const model = new VxlanModel({ ports: RED_PORTS, flood: HEAD_END, ecmp: true })
  model.preLearned()
  const flow1: FlowTuple = { proto: 'TCP', srcIp: IP.a, srcPort: 40001, dstIp: IP.b, dstPort: 443 }
  const flow2: FlowTuple = { proto: 'TCP', srcIp: IP.a, srcPort: 40002, dstIp: IP.b, dstPort: 5432 }
  const back1: FlowTuple = { proto: 'TCP', srcIp: IP.b, srcPort: 443, dstIp: IP.a, dstPort: 40001 }
  const frame = (flow: FlowTuple, from: 'a' | 'b') =>
    tcp(
      flow,
      from,
      540,
      `TCP ${flow.srcIp}:${String(flow.srcPort)} → ${flow.dstIp}:${String(flow.dstPort)}`,
      `TCP :${String(flow.srcPort)} → :${String(flow.dstPort)}`,
      insideText,
    )
  const port1 = sourcePort(flow1)
  const port2 = sourcePort(flow2)
  return [
    {
      id: 'setup',
      title: {
        en: 'Two equal-cost paths in the underlay',
        ja: 'アンダーレイに 2 つの等コストの経路',
      },
      description: {
        en: `${SETUP_TEXT.en} The underlay has two equal-cost paths between the hosts (spine 1 and spine 2), and its routers choose between them with a hash of each packet’s headers. A has two TCP connections to B: to port 443 and to port 5432.`,
        ja: `${SETUP_TEXT.ja}アンダーレイにはホストの間に 2 つの等コストの経路（spine 1 と spine 2）があり、ルーターはパケットのヘッダーのハッシュでどちらを使うかを選ぶ。A は B に 2 つの TCP の接続を持つ。ポート 443 と 5432。`,
      },
      events: [
        ...baseSetup(1450, HEAD_END),
        set(
          U,
          ROUTES,
          table(ROUTE_COLUMNS, [
            ['192.0.2.0/24', 'spine 1, spine 2'],
            ['198.51.100.0/24', 'spine 1, spine 2'],
          ]),
        ),
        ...model.setupEvents(),
        model.containerLearns('a', IP.b, MAC.b),
        model.containerLearns('b', IP.a, MAC.a),
        set(A, SOCKET, `TCP :40001 → ${IP.b}:443, :40002 → ${IP.b}:5432`),
      ],
    },
    {
      id: 'flow1',
      title: {
        en: 'The first flow gets its own source port',
        ja: '1 つ目の流れに送信元ポートを選ぶ',
      },
      description: {
        en: `Every VXLAN packet between the two hosts has the same outer addresses and destination port. If they all looked the same, the underlay would put all of them on one path. So VTEP 1 derives the outer source port from a hash of the inner flow: here ${String(port1)} (RFC 7348 §5). The underlay hashes the outer headers and picks a path.`,
        ja: `2 台のホストの間の VXLAN のパケットは、どれも外側のアドレスと宛先ポートが同じ。すべて同じに見えると、アンダーレイはすべてを 1 つの経路に載せてしまう。そこで VTEP 1 は、内側の流れのハッシュから外側の送信元ポートを作る（ここでは ${String(port1)}。RFC 7348 §5）。アンダーレイは外側のヘッダーをハッシュして経路を選ぶ。`,
      },
      events: model.carry('flow1', 'host1', 'vethA', RED, frame(flow1, 'a')),
    },
    {
      id: 'flow2',
      title: {
        en: 'Another flow, another port, another path',
        ja: '別の流れ、別のポート、別の経路',
      },
      description: {
        en: `The second connection has a different inner flow, so it gets a different source port, ${String(port2)}, and here the hash puts it on the other path. Both paths are used.`,
        ja: `2 つ目の接続は内側の流れが違うので、別の送信元ポート ${String(port2)} になり、ここではハッシュがもう 1 つの経路を選ぶ。両方の経路が使われる。`,
      },
      events: model.carry('flow2', 'host1', 'vethA', RED, frame(flow2, 'a')),
    },
    {
      id: 'flow1-again',
      title: { en: 'The same flow stays on the same path', ja: '同じ流れは同じ経路にとどまる' },
      description: {
        en: 'The next packet of the first connection gets the same source port and the same path. Packets of one flow are never spread over two paths, so they do not arrive out of order.',
        ja: '1 つ目の接続の次のパケットは、同じ送信元ポートと同じ経路になる。1 つの流れのパケットを 2 つの経路に分けないので、順序が入れ替わらない。',
      },
      events: model.carry('flow1-again', 'host1', 'vethA', RED, frame(flow1, 'a')),
    },
    {
      id: 'reply',
      title: { en: 'The reply chooses its own port', ja: '返事は自分でポートを選ぶ' },
      description: {
        en: `VTEP 2 derives its own source port from the reply’s inner flow (${String(sourcePort(back1))}). The destination port is still ${String(VXLAN_PORT)}: VXLAN ports are not swapped like TCP ports, and the reply may take either path.`,
        ja: `VTEP 2 は、返事の内側の流れから自分で送信元ポートを作る（${String(sourcePort(back1))}）。宛先ポートは ${String(VXLAN_PORT)} のまま。VXLAN のポートは TCP のポートのように入れ替わらず、返事はどちらの経路を通ってもよい。`,
      },
      events: model.carry('reply', 'host2', 'vethB', RED, frame(back1, 'b')),
    },
  ]
}

function buildSteps(options: VxlanOptions): readonly Step[] {
  const builders: Record<Situation, () => Step[]> = {
    firstContact: firstContactSteps,
    multicast: multicastSteps,
    controlPlane: controlPlaneSteps,
    tenants: tenantsSteps,
    mtu: mtuSteps,
    ecmp: ecmpSteps,
  }
  return builders[options.situation]()
}

export const vxlanScenario: Scenario<VxlanOptions> = {
  id: 'vxlan',
  title: {
    en: 'VXLAN: stretching a LAN over an IP network',
    ja: 'VXLAN: IP ネットワークの上に LAN を延ばす',
  },
  actors,
  optionDefs: {
    situation: {
      kind: 'select',
      label: { en: 'Situation', ja: '状況' },
      choices: [
        {
          value: 'firstContact',
          label: { en: 'First contact: flood and learn', ja: '最初の通信: 流して学習する' },
        },
        {
          value: 'multicast',
          label: { en: 'Flooding through a multicast group', ja: 'マルチキャストグループで流す' },
        },
        {
          value: 'controlPlane',
          label: { en: 'Tables from a control plane', ja: 'コントロールプレーンが表を配る' },
        },
        {
          value: 'tenants',
          label: { en: 'Two tenants (VNI 100 and 200)', ja: '2 つのテナント（VNI 100 と 200）' },
        },
        {
          value: 'mtu',
          label: { en: 'The overlay MTU is too big', ja: 'オーバーレイの MTU が大きすぎる' },
        },
        {
          value: 'ecmp',
          label: {
            en: 'Outer source port and equal-cost paths',
            ja: '外側の送信元ポートと等コストの経路',
          },
        },
      ],
      defaultValue: 'firstContact',
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
