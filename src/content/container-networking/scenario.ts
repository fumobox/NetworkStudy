/**
 * コンテナーのネットワーク: veth、ブリッジ、NAT
 *
 * 根拠（標準）:
 * - RFC 826（ARP。要求の宛先のホストは、送信元の対応を自分の表に書く）、RFC 1122 §3.3.1（宛先が同じネットワークになければ、
 *   デフォルトゲートウェイに送る）
 * - IEEE Std 802.1Q-2022 clause 8.6〜8.8（ブリッジの転送・学習・表。スイッチのテーマと同じ引き方）
 * - RFC 3022 §2.2（NAPT）、RFC 4787（用語。概要でだけ使う）、RFC 1918 §3（172.16.0.0/12）
 * - RFC 5737（説明用の IPv4 アドレス 198.51.100.0/24、203.0.113.0/24）、RFC 9542 §2.1.4（説明用の MAC アドレス）
 * - RFC 9293 §3.5（3 ウェイハンドシェイク）、§3.10.7.1（待ち受けのないポートへの SYN には RST を返す）
 *
 * 根拠（Linux の実装）:
 * - veth(4): 2 つ 1 組で作られ、片方に送ったパケットはすぐもう片方で受け取られる。network_namespaces(7): 名前空間ごとに
 *   インターフェース、経路、ファイアウォールを持つ
 * - docs.kernel.org「Ethernet Bridging」（学習と FDB）、「IP Sysctl」（ip_forward、ip_local_port_range の既定 32768〜60999、
 *   ip_default_ttl 64）
 * - nftables wiki「Performing Network Address Translation (NAT)」、iptables-extensions(8)。接続の追跡は conntrack.ts
 *
 * 根拠（Docker のドキュメント。2026 年 9 月に参照。Engine 28 の時点）:
 * - 「Networking overview」: 既定のアドレスのプール（最初は 172.17.0.0/16）、組み込みの DNS サーバー 127.0.0.11、
 *   外への名前はホストの DNS サーバーに転送する
 * - 「Bridge network driver」: 既定のブリッジネットワーク（docker0）の上のコンテナーは（古い --link を除いて）IP アドレスでしか互いに届かない。
 *   ユーザー定義のネットワークは名前解決を持つ。送信元はマスカレードされる
 * - 「Port publishing and mapping」: -p 8080:80 はホストのポート 8080 をコンテナーの TCP のポート 80 に対応づける。
 *   公開していないポートには、ホストの外から届かない
 * - 「Packet filtering and firewalls」「Docker with iptables」: nat 表の規則でマスカレードとポートの対応づけを行う。
 *   ip_forward を有効にする
 *
 * 標準ではなく Linux と Docker の実装・設定で決まるもの（概要で書き分ける）: 172.17.0.0/16 と 172.17.0.1、docker0 と br- で始まる
 * ブリッジの名前、127.0.0.11、iptables と nftables のどちらを使うか、docker-proxy、コンテナーの MAC アドレスの作り方
 * （Engine 28 から乱数）、br_netfilter
 *
 * 学習用の単純化: ホストは 1 台で、IPv4 だけ。ホストのアドレスはインターネットで届くものとし、ホストから外への区間の
 * Ethernet と、ホストの上流のルーターへの ARP は描かない。MAC アドレスは説明用の値（最後のバイトは IP アドレスの最後の
 * 数字）。veth のホスト側の名前は vethA、vethB（実際は乱数の名前）。FDB にはブリッジ自身の行と学習した行だけを示す。
 * TCP はハンドシェイクだけで、シーケンス番号は描かない。NAT の規則は iptables・nftables のどちらの書き方でもない表で示す。
 * 送信元のポートが重なったときの 40001 は例の値。br_netfilter、docker-proxy、組み込みの DNS サーバーのしくみは描かない
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
import { decide, FDB_COLUMNS, fdbRows, learn, type BridgeDecision, type FdbEntry } from './bridge'
import {
  CONNTRACK_COLUMNS,
  conntrackRow,
  dnat,
  formatEndpoint,
  masquerade,
  nextState,
  untranslated,
  type ConntrackEntry,
  type Endpoint,
  type TcpFlags,
} from './conntrack'

const SITUATIONS = [
  'outbound',
  'published',
  'sameBridge',
  'userNetwork',
  'twoContainers',
  'unpublished',
] as const

const optionsSchema = z.object({
  situation: z.enum(SITUATIONS).catch('outbound'),
})
export type ContainerNetworkingOptions = z.infer<typeof optionsSchema>
type Situation = ContainerNetworkingOptions['situation']

const A: ActorId = 'containerA'
const B: ActorId = 'containerB'
const BRIDGE: ActorId = 'bridge'
const HOST: ActorId = 'host'
const EXTERNAL: ActorId = 'external'

const IFACE: StateKey = 'iface'
const ROUTES: StateKey = 'routes'
const ARP: StateKey = 'arp'
const SOCKET: StateKey = 'socket'
const DNS: StateKey = 'dns'
const FDB: StateKey = 'fdb'
const DECISION: StateKey = 'decision'
const RULES: StateKey = 'rules'
const NEIGH: StateKey = 'neigh'
const CONNTRACK: StateKey = 'conntrack'
const PEER: StateKey = 'peer'

export const ROUTE_COLUMNS = ['Destination', 'Gateway', 'Dev'] as const
export const ARP_COLUMNS = ['IP', 'MAC'] as const
export const RULE_COLUMNS = ['Hook', 'Match', 'Action'] as const

/** RFC 9542 §2.1.4 の説明用の MAC アドレス。最後のバイトは IP アドレスの最後の数字 */
export const MAC = {
  bridge: '00:00:5e:00:53:01',
  a: '00:00:5e:00:53:02',
  b: '00:00:5e:00:53:03',
} as const
const BROADCAST_MAC = 'ff:ff:ff:ff:ff:ff'

/** ホストの外側のアドレスと、外部のホスト（RFC 5737） */
export const HOST_IP = '198.51.100.10'
const UPSTREAM_ROUTER = '198.51.100.1'
export const EXTERNAL_IP = '203.0.113.80'

interface Network {
  /** ブリッジの名前（ホストの中のインターフェースの名前でもある） */
  readonly bridge: string
  readonly prefix: string
  readonly gateway: string
  readonly a: string
  readonly b: string
}

/** 既定のブリッジネットワーク（Docker の既定のアドレスのプールの最初） */
export const DEFAULT_NETWORK: Network = {
  bridge: 'docker0',
  prefix: '172.17.0.0/16',
  gateway: '172.17.0.1',
  a: '172.17.0.2',
  b: '172.17.0.3',
}

/** docker network create で作るユーザー定義のネットワーク（次のプール）。ブリッジの名前は br- とネットワーク ID の先頭（例の値） */
export const USER_NETWORK: Network = {
  bridge: 'br-7c3f9e2a1d4b',
  prefix: '172.18.0.0/16',
  gateway: '172.18.0.1',
  a: '172.18.0.2',
  b: '172.18.0.3',
}

const CONTAINER_PORT = 40000
const TTL = 64

const table = (
  columns: readonly string[],
  rows: readonly (readonly string[])[] = [],
): StateTable => ({ columns, rows })

const set = (actorId: ActorId, key: StateKey, value: string | StateTable): StepEvent => ({
  kind: 'stateChange',
  actorId,
  key,
  value,
})
const send = (message: Message): StepEvent => ({ kind: 'message', message })

const containerSlots = (dns: boolean): Actor['stateSlots'] => [
  { key: IFACE, label: { en: 'Interface', ja: 'インターフェース' }, initial: '-' },
  { key: ROUTES, label: { en: 'Routes', ja: '経路表' }, initial: table(ROUTE_COLUMNS) },
  { key: ARP, label: { en: 'ARP cache', ja: 'ARP キャッシュ' }, initial: table(ARP_COLUMNS) },
  {
    key: SOCKET,
    label: { en: 'Connection (as the container sees it)', ja: '接続（コンテナーから見たもの）' },
    initial: '-',
  },
  ...(dns ? [{ key: DNS, label: { en: 'Name lookup', ja: '名前解決' }, initial: '-' }] : []),
]

const actors: readonly Actor[] = [
  {
    id: A,
    kind: 'client',
    name: { en: 'Container A', ja: 'コンテナー A' },
    shortName: { en: 'A', ja: 'A' },
    stateSlots: containerSlots(true),
  },
  {
    id: B,
    kind: 'client',
    name: { en: 'Container B', ja: 'コンテナー B' },
    shortName: { en: 'B', ja: 'B' },
    stateSlots: containerSlots(false),
  },
  {
    id: BRIDGE,
    kind: 'switch',
    name: { en: 'Bridge (in the host)', ja: 'ブリッジ（ホストの中）' },
    shortName: { en: 'Bridge', ja: 'ブリッジ' },
    stateSlots: [
      {
        key: IFACE,
        label: { en: 'Bridge interface', ja: 'ブリッジのインターフェース' },
        initial: '-',
      },
      {
        key: FDB,
        label: { en: 'MAC address table (FDB)', ja: 'MAC アドレステーブル（FDB）' },
        initial: table(FDB_COLUMNS),
      },
      { key: DECISION, label: { en: 'What the bridge did', ja: 'ブリッジの判断' }, initial: '-' },
    ],
  },
  {
    id: HOST,
    kind: 'router',
    name: { en: `Host (${HOST_IP})`, ja: `ホスト（${HOST_IP}）` },
    shortName: { en: 'Host', ja: 'ホスト' },
    stateSlots: [
      { key: ROUTES, label: { en: 'Routes', ja: '経路表' }, initial: table(ROUTE_COLUMNS) },
      { key: RULES, label: { en: 'NAT rules', ja: 'NAT の規則' }, initial: table(RULE_COLUMNS) },
      {
        key: NEIGH,
        label: { en: 'ARP cache (bridge side)', ja: 'ARP キャッシュ（ブリッジの側）' },
        initial: table(ARP_COLUMNS),
      },
      {
        key: CONNTRACK,
        label: { en: 'Connection tracking', ja: '接続の追跡' },
        initial: table(CONNTRACK_COLUMNS),
      },
      {
        key: DECISION,
        label: { en: 'What the host did', ja: 'ホストの判断' },
        initial: '-',
      },
    ],
  },
  {
    id: EXTERNAL,
    kind: 'server',
    name: { en: `External host (${EXTERNAL_IP})`, ja: `外部のホスト（${EXTERNAL_IP}）` },
    shortName: { en: 'External', ja: '外部' },
    stateSlots: [
      {
        key: PEER,
        label: { en: 'Connection as it sees it', ja: '外部のホストから見た接続' },
        initial: '-',
      },
    ],
  },
]

// ---------- パケット ----------

const FIELD_TEXT = {
  link: {
    en: 'Where the frame travels. A veth pair is a virtual cable: what one end sends, the other end receives at once',
    ja: 'フレームが通るところ。veth ペアは仮想のケーブルで、片方の端から送ったものは、すぐもう片方の端で受け取られる',
  },
  bridgeLink: {
    en: 'The bridge’s own interface, through which frames go up to (or come down from) the host’s IP stack',
    ja: 'ブリッジ自身のインターフェース。ここを通って、フレームはホストの IP の処理に上がる（または、そこから下りてくる）',
  },
  wan: {
    en: 'The host’s own interface to the outside network. The Ethernet header of this leg is not drawn',
    ja: 'ホスト自身の、外のネットワークへのインターフェース。この区間の Ethernet のヘッダーは描かない',
  },
  ethDst: { en: 'Destination MAC address', ja: '宛先の MAC アドレス' },
  ethSrc: { en: 'Source MAC address', ja: '送信元の MAC アドレス' },
  oper: { en: 'ARP operation: 1 = request, 2 = reply', ja: 'ARP の操作。1 = 要求、2 = 応答' },
  spa: { en: 'Sender IP address', ja: '送信元の IP アドレス' },
  sha: { en: 'Sender MAC address', ja: '送信元の MAC アドレス' },
  tpa: {
    en: 'Target IP address: whose MAC address is asked for',
    ja: '対象の IP アドレス。誰の MAC アドレスを尋ねているか',
  },
  src: { en: 'Source IP address and port', ja: '送信元の IP アドレスとポート' },
  dst: { en: 'Destination IP address and port', ja: '宛先の IP アドレスとポート' },
  ttl: {
    en: 'Time to live. Each router (here, the host) lowers it by 1. A bridge does not touch it',
    ja: '生存時間。ルーター（ここではホスト）を通るたびに 1 減る。ブリッジは変えない',
  },
  flags: { en: 'TCP flags (see the TCP theme)', ja: 'TCP のフラグ（TCP のテーマを参照）' },
  translation: {
    en: 'What the host rewrote in this packet',
    ja: 'ホストがこのパケットで書き換えたところ',
  },
  checksums: {
    en: 'The IP and TCP checksums include the addresses and ports, so the host recomputes them',
    ja: 'IP と TCP のチェックサムにはアドレスとポートが含まれるので、ホストが計算し直す',
  },
} as const satisfies Record<string, LocalizedText>

/** フレームの中身（通る区間によらないもの） */
interface Frame {
  readonly label: string
  readonly ethSrc: string
  readonly ethDst: string
  readonly body: readonly PacketField[]
  readonly description: LocalizedText
  readonly status?: Message['status']
}

function arpRequest(
  senderIp: string,
  senderMac: string,
  targetIp: string,
  who: LocalizedText,
): Frame {
  return {
    label: `ARP who-has ${targetIp}`,
    ethSrc: senderMac,
    ethDst: BROADCAST_MAC,
    body: [
      { name: 'OPER', value: '1 (request)', description: FIELD_TEXT.oper },
      { name: 'SPA', value: senderIp, description: FIELD_TEXT.spa },
      { name: 'SHA', value: senderMac, description: FIELD_TEXT.sha },
      { name: 'TPA', value: targetIp, highlight: true, description: FIELD_TEXT.tpa },
    ],
    description: who,
  }
}

function arpReply(
  senderIp: string,
  senderMac: string,
  targetMac: string,
  who: LocalizedText,
): Frame {
  return {
    label: `ARP is-at ${senderMac}`,
    ethSrc: senderMac,
    ethDst: targetMac,
    body: [
      { name: 'OPER', value: '2 (reply)', description: FIELD_TEXT.oper },
      { name: 'SPA', value: senderIp, description: FIELD_TEXT.spa },
      { name: 'SHA', value: senderMac, highlight: true, description: FIELD_TEXT.sha },
    ],
    description: who,
  }
}

interface SegmentSpec {
  readonly flags: TcpFlags
  readonly src: Endpoint
  readonly dst: Endpoint
  /** 送った直後の TTL。外から来るパケットでは描かない */
  readonly ttl?: number
  /** 変換した場合は、変換前と後 */
  readonly translation?: string
  readonly status?: Message['status']
  readonly description: LocalizedText
}

function segmentBody(spec: SegmentSpec): PacketField[] {
  const translated = spec.translation !== undefined
  const fields: PacketField[] = [
    {
      name: 'Src',
      value: formatEndpoint(spec.src),
      highlight: translated,
      description: FIELD_TEXT.src,
    },
    {
      name: 'Dst',
      value: formatEndpoint(spec.dst),
      highlight: translated,
      description: FIELD_TEXT.dst,
    },
  ]
  if (spec.ttl !== undefined) {
    fields.push({ name: 'TTL', value: String(spec.ttl), description: FIELD_TEXT.ttl })
  }
  fields.push({ name: 'Flags', value: spec.flags, description: FIELD_TEXT.flags })
  if (spec.translation !== undefined) {
    fields.push(
      {
        name: 'Translation',
        value: spec.translation,
        highlight: true,
        description: FIELD_TEXT.translation,
      },
      { name: 'Checksums', value: 'recomputed', description: FIELD_TEXT.checksums },
    )
  }
  return fields
}

function segmentLabel(spec: SegmentSpec): string {
  return `${spec.flags} ${spec.src.ip} → ${spec.dst.ip}`
}

/** ブリッジを通るセグメント（Ethernet のフレームに入っている） */
function segmentFrame(spec: SegmentSpec, ethSrc: string, ethDst: string): Frame {
  return {
    label: segmentLabel(spec),
    ethSrc,
    ethDst,
    body: segmentBody(spec),
    description: spec.description,
    ...(spec.status === undefined ? {} : { status: spec.status }),
  }
}

/** ホストと外部のホストの間のセグメント */
function wanSegment(id: string, from: ActorId, to: ActorId, spec: SegmentSpec): Message {
  return {
    id,
    from,
    to,
    label: segmentLabel(spec),
    status: spec.status ?? 'delivered',
    description: spec.description,
    fields: [
      { name: 'Link', value: 'eth0 (host)', description: FIELD_TEXT.wan },
      ...segmentBody(spec),
    ],
  }
}

// ---------- ブリッジと、その先のホスト ----------

type Port = 'vethA' | 'vethB' | 'bridge'

/**
 * 1 つの状況の中で、ブリッジの表・接続の追跡・ARP キャッシュを持ち回り、ステップのイベントを作る。
 * ブリッジの転送先は bridge.ts、変換は conntrack.ts で求めるので、表と矢印は食い違わない
 */
class HostModel {
  fdb: readonly FdbEntry[]
  conntrack: readonly ConntrackEntry[] = []
  // 状態のイベントは表の配列をそのまま持つので、書き換えずに作り直す（前のステップの表が後の行を見せないように）
  private neigh: readonly (readonly string[])[] = []
  private arpCache: Record<'a' | 'b', readonly (readonly string[])[]> = { a: [], b: [] }

  readonly net: Network

  constructor(net: Network) {
    this.net = net
    this.fdb = [{ mac: MAC.bridge, port: net.bridge, type: 'local' }]
  }

  private portName(port: Port): string {
    return port === 'bridge' ? this.net.bridge : port
  }

  private actorOf(port: string): ActorId {
    if (port === 'vethA') {
      return A
    }
    return port === 'vethB' ? B : HOST
  }

  private link(port: string): PacketField {
    if (port === 'vethA' || port === 'vethB') {
      return { name: 'Link', value: `eth0 ⇄ ${port} (veth pair)`, description: FIELD_TEXT.link }
    }
    return { name: 'Link', value: `${port} (bridge interface)`, description: FIELD_TEXT.bridgeLink }
  }

  private message(id: string, from: ActorId, to: ActorId, port: string, frame: Frame): Message {
    return {
      id,
      from,
      to,
      label: frame.label,
      status: frame.status ?? 'delivered',
      description: frame.description,
      fields: [
        this.link(port),
        { name: 'Eth Dst', value: frame.ethDst, description: FIELD_TEXT.ethDst },
        { name: 'Eth Src', value: frame.ethSrc, description: FIELD_TEXT.ethSrc },
        ...frame.body,
      ],
    }
  }

  private decisionText(decision: BridgeDecision, ingress: string): string {
    switch (decision.kind) {
      case 'flood':
        return `flood: ${decision.ports.join(', ')}`
      case 'forward':
        return `forward: ${ingress} → ${decision.port}`
      case 'local':
        return `local: up to the host (${this.net.bridge})`
      case 'filter':
        return 'filter'
    }
  }

  /**
   * フレームがポートからブリッジに入り、ブリッジが学習して転送する。
   * 戻り値は、入る矢印、表の更新、判断、出ていく矢印（流すときは複数）
   */
  bridge(id: string, ingress: Port, frame: Frame): StepEvent[] {
    const port = this.portName(ingress)
    const events: StepEvent[] = [
      send(this.message(`${id}-bridge`, this.actorOf(port), BRIDGE, port, frame)),
    ]
    const before = this.fdb
    this.fdb = learn(this.fdb, frame.ethSrc, port)
    if (this.fdb !== before) {
      events.push(set(BRIDGE, FDB, table(FDB_COLUMNS, fdbRows(this.fdb))))
    }
    const decision = decide(this.fdb, frame.ethDst, port, [this.net.bridge, 'vethA', 'vethB'])
    events.push(set(BRIDGE, DECISION, this.decisionText(decision, port)))
    const out =
      decision.kind === 'flood'
        ? decision.ports
        : decision.kind === 'forward'
          ? [decision.port]
          : decision.kind === 'local'
            ? [this.net.bridge]
            : []
    for (const egress of out) {
      const to = this.actorOf(egress)
      events.push(send(this.message(`${id}-${to}`, BRIDGE, to, egress, frame)))
    }
    return events
  }

  /** ホストの ARP キャッシュ（ブリッジの側）に書く */
  hostLearns(ip: string, mac: string): StepEvent {
    this.neigh = [...this.neigh, [ip, mac]]
    return set(HOST, NEIGH, table(ARP_COLUMNS, this.neigh))
  }

  containerLearns(who: 'a' | 'b', ip: string, mac: string): StepEvent {
    this.arpCache = { ...this.arpCache, [who]: [...this.arpCache[who], [ip, mac]] }
    return set(who === 'a' ? A : B, ARP, table(ARP_COLUMNS, this.arpCache[who]))
  }

  /** 接続の追跡に記録を足すか、書き換える */
  track(entry: ConntrackEntry): StepEvent {
    const index = this.conntrack.findIndex((e) => e.original === entry.original)
    this.conntrack =
      index < 0
        ? [...this.conntrack, entry]
        : this.conntrack.map((e, i) => (i === index ? entry : e))
    return set(HOST, CONNTRACK, table(CONNTRACK_COLUMNS, this.conntrack.map(conntrackRow)))
  }

  advance(entry: ConntrackEntry, flags: TcpFlags, direction: 'original' | 'reply'): ConntrackEntry {
    return { ...entry, state: nextState(entry.state, flags, direction) }
  }
}

// ---------- 準備 ----------

const containerRoutes = (net: Network) =>
  table(ROUTE_COLUMNS, [
    [net.prefix, 'on-link', 'eth0'],
    ['default', net.gateway, 'eth0'],
  ])

function hostRoutes(net: Network): StateTable {
  const rows: string[][] = [[DEFAULT_NETWORK.prefix, 'on-link', DEFAULT_NETWORK.bridge]]
  if (net !== DEFAULT_NETWORK) {
    rows.push([net.prefix, 'on-link', net.bridge])
  }
  rows.push(['default', UPSTREAM_ROUTER, 'eth0'])
  return table(ROUTE_COLUMNS, rows)
}

/** Docker はネットワークごとに、その範囲から来て別のインターフェースへ出るパケットをマスカレードする規則を足す */
const masqueradeRule = (net: Network): readonly string[] => [
  'postrouting',
  `src ${net.prefix}, out ≠ ${net.bridge}`,
  'masquerade',
]
const MASQUERADE_RULE = masqueradeRule(DEFAULT_NETWORK)
const DNAT_RULE = [
  'prerouting',
  'dst a host address, tcp dport 8080',
  'dnat to 172.17.0.2:80',
] as const

function setupEvents(model: HostModel, rules: readonly (readonly string[])[]): StepEvent[] {
  const net = model.net
  return [
    set(A, IFACE, `eth0 ${net.a}/16`),
    set(A, ROUTES, containerRoutes(net)),
    set(B, IFACE, `eth0 ${net.b}/16`),
    set(B, ROUTES, containerRoutes(net)),
    set(BRIDGE, IFACE, `${net.bridge} ${net.gateway}/16`),
    set(BRIDGE, FDB, table(FDB_COLUMNS, fdbRows(model.fdb))),
    set(HOST, ROUTES, hostRoutes(net)),
    set(HOST, RULES, table(RULE_COLUMNS, rules)),
  ]
}

const SETUP_TEXT = {
  en: 'When Docker starts a container, it gives the container its own network namespace: its own interfaces, routes and ARP cache. It creates a veth pair, puts one end in the container as eth0 and attaches the other end to the bridge. The container gets an address from the bridge’s network and a default route to the bridge’s own address.',
  ja: 'Docker はコンテナーを起動するとき、コンテナーに専用のネットワーク名前空間（インターフェース、経路、ARP キャッシュ）を与える。veth ペアを作り、片方の端を eth0 としてコンテナーに入れ、もう片方の端をブリッジにつなぐ。コンテナーはブリッジのネットワークのアドレスと、ブリッジ自身のアドレスへのデフォルトの経路を持つ。',
} as const

// ---------- 状況ごとのステップ ----------

const SERVER: Endpoint = { ip: EXTERNAL_IP, port: 443 }

/** コンテナー A からインターネットへ。MASQUERADE と、接続の追跡による戻り */
function outboundSteps(): Step[] {
  const net = DEFAULT_NETWORK
  const model = new HostModel(net)
  const a: Endpoint = { ip: net.a, port: CONTAINER_PORT }
  const original = { src: a, dst: SERVER }
  const entry = masquerade(model.conntrack, original, HOST_IP)
  const outside = entry.reply.dst
  const synText = {
    en: 'Inside the container: the source is the container’s own private address.',
    ja: 'コンテナーの中。送信元はコンテナー自身のプライベートアドレス。',
  }
  const wanText = {
    en: 'Outside the host: the source is the host’s address.',
    ja: 'ホストの外。送信元はホストのアドレス。',
  }

  const synAck = model.advance(entry, 'SYN, ACK', 'reply')
  const established = model.advance(synAck, 'ACK', 'original')
  return [
    {
      id: 'setup',
      title: { en: 'Docker has set up the network', ja: 'Docker がネットワークを用意した' },
      description: {
        en: `${SETUP_TEXT.en} On the host, the bridge ${net.bridge} has ${net.gateway}, IP forwarding is on, and a NAT rule masquerades traffic from ${net.prefix} that leaves through another interface.`,
        ja: `${SETUP_TEXT.ja}ホストでは、ブリッジ ${net.bridge} が ${net.gateway} を持ち、IP 転送が有効で、${net.prefix} から来てほかのインターフェースへ出ていくパケットをマスカレードする NAT の規則がある。`,
      },
      events: setupEvents(model, [MASQUERADE_RULE]),
    },
    {
      id: 'arp-request',
      title: {
        en: 'A asks for the gateway’s MAC address',
        ja: 'A がゲートウェイの MAC アドレスを尋ねる',
      },
      description: {
        en: `A wants to connect to ${formatEndpoint(SERVER)}. That address is not on A’s network, so the packet goes to the default gateway ${net.gateway} (RFC 1122 §3.3.1), and A needs its MAC address. The broadcast crosses the veth pair; the bridge learns A’s MAC address on vethA and floods the frame to every other port, including its own interface ${net.bridge}, which leads to the host.`,
        ja: `A は ${formatEndpoint(SERVER)} に接続したい。このアドレスは A のネットワークにないので、パケットはデフォルトゲートウェイ ${net.gateway} に送る（RFC 1122 §3.3.1）。そのため A はその MAC アドレスが要る。ブロードキャストは veth ペアを通り、ブリッジは A の MAC アドレスを vethA で学習し、ほかのすべてのポートに流す。そこにはホストにつながるブリッジ自身のインターフェース ${net.bridge} も含まれる。`,
      },
      events: [
        set(A, SOCKET, `TCP ${formatEndpoint(a)} → ${formatEndpoint(SERVER)}`),
        ...model.bridge(
          'arp-request',
          'vethA',
          arpRequest(net.a, MAC.a, net.gateway, {
            en: `Who has ${net.gateway}? B ignores it: it is not the target.`,
            ja: `${net.gateway} は誰？ B は対象でないので無視する。`,
          }),
        ),
        model.hostLearns(net.a, MAC.a),
        set(HOST, DECISION, `ARP: ${net.gateway} is mine`),
      ],
    },
    {
      id: 'arp-reply',
      title: {
        en: 'The host answers for the bridge’s address',
        ja: 'ホストがブリッジのアドレスについて答える',
      },
      description: {
        en: `${net.gateway} belongs to the host (on ${net.bridge}), so the host answers. It has also written A into its own ARP cache, because the target of a request records the sender (RFC 826), so the reply will not need another ARP. The bridge already knows A, so the reply goes only to vethA.`,
        ja: `${net.gateway} はホストの（${net.bridge} の）アドレスなので、ホストが答える。要求の対象は送信元を記録する（RFC 826）ので、ホストは A を自分の ARP キャッシュにも書いていて、返事のために ARP をもう一度する必要はない。ブリッジはもう A を知っているので、応答は vethA にだけ送る。`,
      },
      events: [
        ...model.bridge(
          'arp-reply',
          'bridge',
          arpReply(net.gateway, MAC.bridge, MAC.a, {
            en: `${net.gateway} is at ${MAC.bridge}.`,
            ja: `${net.gateway} は ${MAC.bridge}。`,
          }),
        ),
        model.containerLearns('a', net.gateway, MAC.bridge),
      ],
    },
    {
      id: 'syn',
      title: { en: 'A sends a SYN to the gateway', ja: 'A がゲートウェイに SYN を送る' },
      description: {
        en: `The IP destination is ${SERVER.ip}, but the frame is addressed to the bridge’s own MAC address. So the bridge does not forward it to another port: it passes it up to the host’s IP stack through ${net.bridge}.`,
        ja: `IP の宛先は ${SERVER.ip} だが、フレームの宛先はブリッジ自身の MAC アドレス。そのためブリッジはほかのポートに転送せず、${net.bridge} を通してホストの IP の処理に上げる。`,
      },
      events: model.bridge(
        'syn',
        'vethA',
        segmentFrame(
          { flags: 'SYN', src: a, dst: SERVER, ttl: TTL, description: synText },
          MAC.a,
          MAC.bridge,
        ),
      ),
    },
    {
      id: 'masquerade',
      title: {
        en: 'The host routes it and rewrites the source',
        ja: 'ホストが経路を選び、送信元を書き換える',
      },
      description: {
        en: `The host routes the packet to eth0 (TTL 64 → 63). It is the first packet of a new connection, so the MASQUERADE rule applies: the source becomes the address of the interface it leaves by, ${HOST_IP}. The port 40000 is kept because no other connection to the same server uses it (the reply tuple is unique). Connection tracking records the original direction and the reply it now expects.`,
        ja: `ホストはパケットを eth0 へ送る経路を選ぶ（TTL は 64 → 63）。新しい接続の最初のパケットなので MASQUERADE の規則が当てはまり、送信元は出ていくインターフェースのアドレス ${HOST_IP} になる。同じサーバーへのほかの接続が使っていない（返事の向きの組が重ならない）ので、ポート 40000 はそのまま。接続の追跡は、元の向きと、これから来るはずの返事の向きを記録する。`,
      },
      events: [
        model.track(entry),
        set(HOST, DECISION, `masquerade: src → ${formatEndpoint(outside)}`),
        send(
          wanSegment('syn-out', HOST, EXTERNAL, {
            flags: 'SYN',
            src: outside,
            dst: SERVER,
            ttl: TTL - 1,
            translation: `src ${formatEndpoint(a)} → ${formatEndpoint(outside)}`,
            description: wanText,
          }),
        ),
        set(EXTERNAL, PEER, `from ${formatEndpoint(outside)}`),
      ],
    },
    {
      id: 'reply',
      title: { en: 'The reply is translated back', ja: '返事が元に戻される' },
      description: {
        en: `The external host sees only ${HOST_IP} and replies there. The packet matches the reply direction of the tracked connection, so the host rewrites the destination back to ${formatEndpoint(a)} without looking at any rule, and sends it to A through the bridge using the MAC address it learned from A’s ARP request.`,
        ja: `外部のホストに見えるのは ${HOST_IP} だけで、そこに返事をする。パケットは追跡している接続の返事の向きに当たるので、ホストは規則を見ずに宛先を ${formatEndpoint(a)} に戻し、A の ARP の要求で知った MAC アドレスを使って、ブリッジを通して A に送る。`,
      },
      events: [
        send(
          wanSegment('synack-in', EXTERNAL, HOST, {
            flags: 'SYN, ACK',
            src: SERVER,
            dst: outside,
            description: wanText,
          }),
        ),
        model.track(synAck),
        set(HOST, DECISION, `conntrack: dst → ${formatEndpoint(a)}`),
        ...model.bridge(
          'synack',
          'bridge',
          segmentFrame(
            {
              flags: 'SYN, ACK',
              src: SERVER,
              dst: a,
              translation: `dst ${formatEndpoint(outside)} → ${formatEndpoint(a)}`,
              description: synText,
            },
            MAC.bridge,
            MAC.a,
          ),
        ),
      ],
    },
    {
      id: 'ack',
      title: { en: 'Every packet takes the same path', ja: 'どのパケットも同じ道を通る' },
      description: {
        en: 'A finishes the handshake. This packet and every later one is translated from the same record, in both directions. A never sees the host’s address, and the external host never sees A’s.',
        ja: 'A はハンドシェイクを終える。このパケットもその後のパケットも、両方の向きで同じ記録から変換される。A にホストのアドレスは見えず、外部のホストに A のアドレスは見えない。',
      },
      events: [
        ...model.bridge(
          'ack',
          'vethA',
          segmentFrame(
            { flags: 'ACK', src: a, dst: SERVER, ttl: TTL, description: synText },
            MAC.a,
            MAC.bridge,
          ),
        ),
        model.track(established),
        send(
          wanSegment('ack-out', HOST, EXTERNAL, {
            flags: 'ACK',
            src: outside,
            dst: SERVER,
            ttl: TTL - 1,
            translation: `src ${formatEndpoint(a)} → ${formatEndpoint(outside)}`,
            description: wanText,
          }),
        ),
        set(A, SOCKET, `TCP ${formatEndpoint(a)} → ${formatEndpoint(SERVER)} ESTABLISHED`),
      ],
    },
  ]
}

/** -p 8080:80 で公開したポート。外から DNAT でコンテナーに入る */
function publishedSteps(): Step[] {
  const net = DEFAULT_NETWORK
  const model = new HostModel(net)
  const client: Endpoint = { ip: EXTERNAL_IP, port: 50000 }
  const published: Endpoint = { ip: HOST_IP, port: 8080 }
  const container: Endpoint = { ip: net.a, port: 80 }
  const entry = dnat({ src: client, dst: published }, container)
  const synAck = model.advance(entry, 'SYN, ACK', 'reply')
  const established = model.advance(synAck, 'ACK', 'original')
  const wanText = {
    en: 'Outside the host: the destination is the host’s published port.',
    ja: 'ホストの外。宛先はホストの公開したポート。',
  }
  const insideText = {
    en: 'Inside: the destination is the container, and the source is still the real client.',
    ja: 'ホストの中。宛先はコンテナーで、送信元は本当のクライアントのまま。',
  }
  const replyText = {
    en: 'The container answers the real client.',
    ja: 'コンテナーは本当のクライアントに答える。',
  }
  return [
    {
      id: 'setup',
      title: { en: 'A publishes port 80 as 8080', ja: 'A がポート 80 を 8080 として公開する' },
      description: {
        en: `${SETUP_TEXT.en} A was started with -p 8080:80, and a web server in it listens on port 80. Docker has added a NAT rule: TCP to port 8080 of a host address has its destination changed to ${formatEndpoint(container)}.`,
        ja: `${SETUP_TEXT.ja}A は -p 8080:80 を付けて起動し、中の Web サーバーがポート 80 で待ち受けている。Docker は、ホストのアドレスのポート 8080 への TCP の宛先を ${formatEndpoint(container)} に変える NAT の規則を足した。`,
      },
      events: [
        ...setupEvents(model, [DNAT_RULE, MASQUERADE_RULE]),
        set(A, SOCKET, 'LISTEN 0.0.0.0:80'),
      ],
    },
    {
      id: 'syn-in',
      title: {
        en: 'A client connects to the host’s port 8080',
        ja: 'クライアントがホストのポート 8080 に接続する',
      },
      description: {
        en: `The first packet matches the DNAT rule: the host changes the destination to ${formatEndpoint(container)} and records the connection. The route to ${net.a} is on ${net.bridge}, but the host has no ARP entry for it yet, so the packet waits.`,
        ja: `最初のパケットは DNAT の規則に当たる。ホストは宛先を ${formatEndpoint(container)} に変え、接続を記録する。${net.a} への経路は ${net.bridge} にあるが、まだ ARP キャッシュにないので、パケットは待つ。`,
      },
      events: [
        set(EXTERNAL, PEER, `to ${formatEndpoint(published)}`),
        send(
          wanSegment('syn-in', EXTERNAL, HOST, {
            flags: 'SYN',
            src: client,
            dst: published,
            description: wanText,
          }),
        ),
        model.track(entry),
        set(HOST, DECISION, `dnat: dst → ${formatEndpoint(container)}`),
      ],
    },
    {
      id: 'host-arp',
      title: { en: 'The host asks for A’s MAC address', ja: 'ホストが A の MAC アドレスを尋ねる' },
      description: {
        en: `The request goes down through ${net.bridge}. The bridge floods it to both veth ports. A is the target, so it answers and records the host; B ignores it.`,
        ja: `要求は ${net.bridge} を通って下りる。ブリッジは両方の veth のポートに流す。A は対象なので答え、ホストを記録する。B は無視する。`,
      },
      events: [
        ...model.bridge(
          'host-arp',
          'bridge',
          arpRequest(net.gateway, MAC.bridge, net.a, {
            en: `Who has ${net.a}?`,
            ja: `${net.a} は誰？`,
          }),
        ),
        model.containerLearns('a', net.gateway, MAC.bridge),
      ],
    },
    {
      id: 'host-arp-reply',
      title: { en: 'A answers', ja: 'A が答える' },
      description: {
        en: 'The bridge learns A on vethA and passes the reply up to the host, which can now send the waiting packet.',
        ja: 'ブリッジは A を vethA で学習し、応答をホストに上げる。ホストは待っていたパケットを送れる。',
      },
      events: [
        ...model.bridge(
          'host-arp-reply',
          'vethA',
          arpReply(net.a, MAC.a, MAC.bridge, {
            en: `${net.a} is at ${MAC.a}.`,
            ja: `${net.a} は ${MAC.a}。`,
          }),
        ),
        model.hostLearns(net.a, MAC.a),
      ],
    },
    {
      id: 'syn-to-container',
      title: { en: 'The SYN reaches the container', ja: 'SYN がコンテナーに届く' },
      description: {
        en: `Only the destination was changed. The web server in A sees the real client, ${formatEndpoint(client)}, as the source.`,
        ja: `変えたのは宛先だけ。A の中の Web サーバーには、本当のクライアント ${formatEndpoint(client)} が送信元として見える。`,
      },
      events: [
        ...model.bridge(
          'syn',
          'bridge',
          segmentFrame(
            {
              flags: 'SYN',
              src: client,
              dst: container,
              translation: `dst ${formatEndpoint(published)} → ${formatEndpoint(container)}`,
              description: insideText,
            },
            MAC.bridge,
            MAC.a,
          ),
        ),
        set(A, SOCKET, `SYN-RECEIVED from ${formatEndpoint(client)}`),
      ],
    },
    {
      id: 'synack',
      title: {
        en: 'A answers, and the host changes the source back',
        ja: 'A が答え、ホストが送信元を戻す',
      },
      description: {
        en: `A replies to ${formatEndpoint(client)} through its default gateway. The packet matches the reply direction of the record, so the host changes the source back to ${formatEndpoint(published)}. The client sees an answer from the address it connected to. The MASQUERADE rule does not apply: rules are only looked at for the first packet of a connection.`,
        ja: `A はデフォルトゲートウェイを通して ${formatEndpoint(client)} に返事をする。パケットは記録の返事の向きに当たるので、ホストは送信元を ${formatEndpoint(published)} に戻す。クライアントには、接続した相手からの返事に見える。MASQUERADE の規則は当てはまらない。規則を見るのは、接続の最初のパケットだけ。`,
      },
      events: [
        ...model.bridge(
          'synack',
          'vethA',
          segmentFrame(
            { flags: 'SYN, ACK', src: container, dst: client, ttl: TTL, description: replyText },
            MAC.a,
            MAC.bridge,
          ),
        ),
        model.track(synAck),
        set(HOST, DECISION, `conntrack: src → ${formatEndpoint(published)}`),
        send(
          wanSegment('synack-out', HOST, EXTERNAL, {
            flags: 'SYN, ACK',
            src: published,
            dst: client,
            ttl: TTL - 1,
            translation: `src ${formatEndpoint(container)} → ${formatEndpoint(published)}`,
            description: wanText,
          }),
        ),
      ],
    },
    {
      id: 'ack',
      title: { en: 'The connection is open', ja: '接続が開く' },
      description: {
        en: 'The client’s ACK is translated by the same record. From now on, every packet of this connection is rewritten in both directions.',
        ja: 'クライアントの ACK も同じ記録で変換される。これからは、この接続のすべてのパケットが両方の向きで書き換えられる。',
      },
      events: [
        send(
          wanSegment('ack-in', EXTERNAL, HOST, {
            flags: 'ACK',
            src: client,
            dst: published,
            description: wanText,
          }),
        ),
        model.track(established),
        set(HOST, DECISION, `conntrack: dst → ${formatEndpoint(container)}`),
        ...model.bridge(
          'ack',
          'bridge',
          segmentFrame(
            {
              flags: 'ACK',
              src: client,
              dst: container,
              translation: `dst ${formatEndpoint(published)} → ${formatEndpoint(container)}`,
              description: insideText,
            },
            MAC.bridge,
            MAC.a,
          ),
        ),
        set(A, SOCKET, `ESTABLISHED with ${formatEndpoint(client)}`),
      ],
    },
  ]
}

/** 同じブリッジのコンテナー同士。ブリッジだけを通り、NAT も経路の選択もない */
function sameBridgeSteps(net: Network, port: number, userNetwork: boolean): Step[] {
  const model = new HostModel(net)
  const a: Endpoint = { ip: net.a, port: CONTAINER_PORT }
  const b: Endpoint = { ip: net.b, port }
  const text = {
    en: 'Inside the bridge’s network: nothing is translated, and the TTL stays 64.',
    ja: 'ブリッジのネットワークの中。何も変換されず、TTL は 64 のまま。',
  }
  const setup: Step = userNetwork
    ? {
        id: 'setup',
        title: {
          en: 'Two containers on a user-defined network',
          ja: 'ユーザー定義のネットワークの 2 つのコンテナー',
        },
        description: {
          en: `The containers were started on a network created with docker network create. It has its own bridge, ${net.bridge}, and the next address range, ${net.prefix}. A is a web application and B (named db) is a database listening on port ${String(port)}. On a user-defined network, Docker points each container’s resolver at its embedded DNS server, 127.0.0.11.`,
          ja: `コンテナーは docker network create で作ったネットワークで起動した。このネットワークは専用のブリッジ ${net.bridge} と、次のアドレスの範囲 ${net.prefix} を持つ。A は Web アプリケーションで、B（名前は db）はポート ${String(port)} で待ち受けるデータベース。ユーザー定義のネットワークでは、Docker は各コンテナーのリゾルバーを組み込みの DNS サーバー 127.0.0.11 に向ける。`,
        },
        events: [
          ...setupEvents(model, [MASQUERADE_RULE, masqueradeRule(net)]),
          set(A, DNS, 'nameserver 127.0.0.11'),
          set(B, SOCKET, `LISTEN 0.0.0.0:${String(port)}`),
        ],
      }
    : {
        id: 'setup',
        title: {
          en: 'Two containers on the default bridge',
          ja: '既定のブリッジの 2 つのコンテナー',
        },
        description: {
          en: `${SETUP_TEXT.en} Both A and B are on the default bridge ${net.bridge}. B runs a web server on port ${String(port)}. It was not published with -p, which is not needed inside the bridge’s network.`,
          ja: `${SETUP_TEXT.ja}A と B はどちらも既定のブリッジ ${net.bridge} にいる。B はポート ${String(port)} で Web サーバーを動かしている。-p で公開していないが、ブリッジのネットワークの中では要らない。`,
        },
        events: [
          ...setupEvents(model, [MASQUERADE_RULE]),
          set(B, SOCKET, `LISTEN 0.0.0.0:${String(port)}`),
        ],
      }

  const steps: Step[] = [setup]
  if (userNetwork) {
    steps.push({
      id: 'dns',
      title: { en: 'A looks up the name db', ja: 'A が名前 db を引く' },
      description: {
        en: `A asks the embedded DNS server for db and gets ${net.b}. 127.0.0.11 is a loopback address inside A’s own namespace, so the query never crosses the veth pair. The embedded DNS server knows the containers on the same network by name and forwards other names to the DNS servers configured on the host. On the default bridge there is no such lookup: containers there reach each other by IP address only (apart from the legacy --link option).`,
        ja: `A は組み込みの DNS サーバーに db を尋ね、${net.b} を得る。127.0.0.11 は A 自身の名前空間の中のループバックアドレスなので、問い合わせは veth ペアを通らない。組み込みの DNS サーバーは同じネットワークのコンテナーを名前で知っていて、ほかの名前はホストに設定された DNS サーバーに転送する。既定のブリッジにはこの名前解決がなく、コンテナーは（古い --link を除いて）IP アドレスでしか互いに届かない。`,
      },
      events: [set(A, DNS, `db → ${net.b} (via 127.0.0.11)`)],
    })
  }
  steps.push(
    {
      id: 'arp-request',
      title: { en: 'A asks for B’s MAC address', ja: 'A が B の MAC アドレスを尋ねる' },
      description: {
        en: `${net.b} is on A’s own network (${net.prefix} on-link), so A does not use the gateway: it asks for B directly. The bridge learns A on vethA and floods the broadcast. The host also gets a copy through ${net.bridge}, but it is not the target and ignores it.`,
        ja: `${net.b} は A 自身のネットワーク（${net.prefix} は on-link）にあるので、A はゲートウェイを使わず、B を直接尋ねる。ブリッジは A を vethA で学習し、ブロードキャストを流す。ホストにも ${net.bridge} を通して届くが、対象でないので無視する。`,
      },
      events: [
        set(A, SOCKET, `TCP ${formatEndpoint(a)} → ${formatEndpoint(b)}`),
        ...model.bridge(
          'arp-request',
          'vethA',
          arpRequest(net.a, MAC.a, net.b, { en: `Who has ${net.b}?`, ja: `${net.b} は誰？` }),
        ),
        model.containerLearns('b', net.a, MAC.a),
      ],
    },
    {
      id: 'arp-reply',
      title: { en: 'B answers', ja: 'B が答える' },
      description: {
        en: 'The bridge learns B on vethB. It already knows A, so the reply goes only to vethA.',
        ja: 'ブリッジは B を vethB で学習する。A はもう知っているので、応答は vethA にだけ送る。',
      },
      events: [
        ...model.bridge(
          'arp-reply',
          'vethB',
          arpReply(net.b, MAC.b, MAC.a, {
            en: `${net.b} is at ${MAC.b}.`,
            ja: `${net.b} は ${MAC.b}。`,
          }),
        ),
        model.containerLearns('a', net.b, MAC.b),
      ],
    },
    {
      id: 'syn',
      title: { en: 'The bridge switches the SYN to B', ja: 'ブリッジが SYN を B に送る' },
      description: {
        en: 'The frame is addressed to B’s MAC address, so the bridge forwards it from vethA to vethB like a switch. It never goes up to the host: no routing, no NAT, and the TTL is still 64 when it arrives.',
        ja: 'フレームの宛先は B の MAC アドレスなので、ブリッジはスイッチと同じように vethA から vethB へ転送する。ホストには上がらない。経路の選択も NAT もなく、届いたときも TTL は 64 のまま。',
      },
      events: [
        ...model.bridge(
          'syn',
          'vethA',
          segmentFrame({ flags: 'SYN', src: a, dst: b, ttl: TTL, description: text }, MAC.a, MAC.b),
        ),
        set(B, SOCKET, `SYN-RECEIVED from ${formatEndpoint(a)}`),
      ],
    },
    {
      id: 'synack',
      title: { en: 'B answers A directly', ja: 'B が A に直接答える' },
      description: {
        en: 'B sees A’s real address as the source, and the reply goes straight back through the bridge.',
        ja: 'B には A の本当のアドレスが送信元として見え、返事はブリッジを通ってそのまま戻る。',
      },
      events: model.bridge(
        'synack',
        'vethB',
        segmentFrame(
          { flags: 'SYN, ACK', src: b, dst: a, ttl: TTL, description: text },
          MAC.b,
          MAC.a,
        ),
      ),
    },
    {
      id: 'ack',
      title: { en: 'The connection is open', ja: '接続が開く' },
      description: {
        en: userNetwork
          ? 'The web application is connected to the database by name. Containers on another network could not reach B this way: Docker isolates networks from each other.'
          : 'The containers talk over the bridge alone, as two PCs on one switch would. The host only saw the flooded ARP request.',
        ja: userNetwork
          ? 'Web アプリケーションは名前でデータベースにつながった。別のネットワークのコンテナーは、こうして B に届くことはできない。Docker はネットワーク同士を切り離している。'
          : 'コンテナーは、1 台のスイッチにつながった 2 台の PC のように、ブリッジだけを通して話す。ホストが受け取ったのは、流された ARP の要求だけ。',
      },
      events: [
        ...model.bridge(
          'ack',
          'vethA',
          segmentFrame({ flags: 'ACK', src: a, dst: b, ttl: TTL, description: text }, MAC.a, MAC.b),
        ),
        set(A, SOCKET, `TCP ${formatEndpoint(a)} → ${formatEndpoint(b)} ESTABLISHED`),
        set(B, SOCKET, `ESTABLISHED with ${formatEndpoint(a)}`),
      ],
    },
  )
  return steps
}

/** 2 つのコンテナーが、同じ送信元ポートで同じ宛先に接続する */
function twoContainersSteps(): Step[] {
  const net = DEFAULT_NETWORK
  const model = new HostModel(net)
  // 前の接続で、どちらもゲートウェイを、ホストはどちらのコンテナーも知っている
  model.fdb = learn(learn(model.fdb, MAC.a, 'vethA'), MAC.b, 'vethB')
  const a: Endpoint = { ip: net.a, port: CONTAINER_PORT }
  const b: Endpoint = { ip: net.b, port: CONTAINER_PORT }
  const entryA = masquerade(model.conntrack, { src: a, dst: SERVER }, HOST_IP)
  const entryB = masquerade([entryA], { src: b, dst: SERVER }, HOST_IP)
  const outA = entryA.reply.dst
  const outB = entryB.reply.dst
  const inside = {
    en: 'Inside the container.',
    ja: 'コンテナーの中。',
  }
  const wan = { en: 'Outside the host.', ja: 'ホストの外。' }

  const outbound = (id: string, from: 'vethA' | 'vethB', src: Endpoint, mac: string) =>
    model.bridge(
      id,
      from,
      segmentFrame(
        { flags: 'SYN', src, dst: SERVER, ttl: TTL, description: inside },
        mac,
        MAC.bridge,
      ),
    )
  const back = (id: string, dst: Endpoint, outside: Endpoint, mac: string) => [
    send(
      wanSegment(`${id}-in`, EXTERNAL, HOST, {
        flags: 'SYN, ACK',
        src: SERVER,
        dst: outside,
        description: wan,
      }),
    ),
    ...model.bridge(
      id,
      'bridge',
      segmentFrame(
        {
          flags: 'SYN, ACK',
          src: SERVER,
          dst,
          translation: `dst ${formatEndpoint(outside)} → ${formatEndpoint(dst)}`,
          description: inside,
        },
        MAC.bridge,
        mac,
      ),
    ),
  ]

  return [
    {
      id: 'setup',
      title: {
        en: 'Two containers, one host address',
        ja: '2 つのコンテナー、1 つのホストのアドレス',
      },
      description: {
        en: `${SETUP_TEXT.en} A and B have talked to the gateway before, so their ARP caches, the bridge’s table and the host’s ARP cache are already filled, as in the default situation.`,
        ja: `${SETUP_TEXT.ja}A と B は前にもゲートウェイと通信したので、ARP キャッシュ、ブリッジの表、ホストの ARP キャッシュは、既定の状況のように埋まっている。`,
      },
      events: [
        ...setupEvents(model, [MASQUERADE_RULE]),
        model.containerLearns('a', net.gateway, MAC.bridge),
        model.containerLearns('b', net.gateway, MAC.bridge),
        model.hostLearns(net.a, MAC.a),
        model.hostLearns(net.b, MAC.b),
      ],
    },
    {
      id: 'a-syn',
      title: { en: 'A connects from port 40000', ja: 'A がポート 40000 から接続する' },
      description: {
        en: `As in the default situation, the host masquerades the source to ${formatEndpoint(outA)} and records the connection.`,
        ja: `既定の状況と同じく、ホストは送信元を ${formatEndpoint(outA)} にマスカレードし、接続を記録する。`,
      },
      events: [
        set(A, SOCKET, `TCP ${formatEndpoint(a)} → ${formatEndpoint(SERVER)}`),
        ...outbound('a-syn', 'vethA', a, MAC.a),
        model.track(entryA),
        set(HOST, DECISION, `masquerade: src → ${formatEndpoint(outA)}`),
        send(
          wanSegment('a-syn-out', HOST, EXTERNAL, {
            flags: 'SYN',
            src: outA,
            dst: SERVER,
            ttl: TTL - 1,
            translation: `src ${formatEndpoint(a)} → ${formatEndpoint(outA)}`,
            description: wan,
          }),
        ),
        set(EXTERNAL, PEER, `from ${formatEndpoint(outA)}`),
      ],
    },
    {
      id: 'b-syn',
      title: {
        en: 'B connects from the same port to the same server',
        ja: 'B が同じポートから同じサーバーに接続する',
      },
      description: {
        en: `B’s kernel also chose port 40000: it knows nothing about A. If the host kept the port, the reply to ${formatEndpoint(outA)} could belong to either container. The reply tuple is already in use, so the host picks another free port, here ${String(outB.port)} (which port Linux picks is not fixed). Had B connected to a different server, it could have kept 40000, because the whole tuple is compared.`,
        ja: `B のカーネルも、A のことは知らずにポート 40000 を選んだ。ホストがポートをそのままにすると、${formatEndpoint(outA)} への返事がどちらのコンテナーのものかわからない。返事の向きの組はもう使われているので、ホストは空いている別のポートを選ぶ。ここでは ${String(outB.port)}（Linux がどのポートを選ぶかは決まっていない）。B が別のサーバーに接続したなら、組全体で比べるので 40000 のままでよかった。`,
      },
      events: [
        set(B, SOCKET, `TCP ${formatEndpoint(b)} → ${formatEndpoint(SERVER)}`),
        ...outbound('b-syn', 'vethB', b, MAC.b),
        model.track(entryB),
        set(HOST, DECISION, `masquerade: src → ${formatEndpoint(outB)}`),
        send(
          wanSegment('b-syn-out', HOST, EXTERNAL, {
            flags: 'SYN',
            src: outB,
            dst: SERVER,
            ttl: TTL - 1,
            translation: `src ${formatEndpoint(b)} → ${formatEndpoint(outB)}`,
            description: wan,
          }),
        ),
        set(EXTERNAL, PEER, `from ${formatEndpoint(outA)}, ${formatEndpoint(outB)}`),
      ],
    },
    {
      id: 'a-synack',
      title: { en: 'The reply to port 40000 goes to A', ja: 'ポート 40000 への返事は A に届く' },
      description: {
        en: 'The external host sees two connections from the same address with different ports. The reply to port 40000 matches A’s record.',
        ja: '外部のホストには、同じアドレスのポートが違う 2 つの接続に見える。ポート 40000 への返事は A の記録に当たる。',
      },
      events: [
        ...back('a-synack', a, outA, MAC.a),
        model.track(model.advance(entryA, 'SYN, ACK', 'reply')),
        set(HOST, DECISION, `conntrack: dst → ${formatEndpoint(a)}`),
      ],
    },
    {
      id: 'b-synack',
      title: {
        en: `The reply to port ${String(outB.port)} goes to B`,
        ja: `ポート ${String(outB.port)} への返事は B に届く`,
      },
      description: {
        en: `The host changes the destination back to ${formatEndpoint(b)}. B still thinks it is using port 40000, and never learns that the host changed it.`,
        ja: `ホストは宛先を ${formatEndpoint(b)} に戻す。B は自分がポート 40000 を使っていると思っていて、ホストが変えたことは知らない。`,
      },
      events: [
        ...back('b-synack', b, outB, MAC.b),
        model.track(model.advance(entryB, 'SYN, ACK', 'reply')),
        set(HOST, DECISION, `conntrack: dst → ${formatEndpoint(b)}`),
      ],
    },
  ]
}

/** 公開していないポートには、外から届かない */
function unpublishedSteps(): Step[] {
  const net = DEFAULT_NETWORK
  const model = new HostModel(net)
  const client: Endpoint = { ip: EXTERNAL_IP, port: 50000 }
  const hostPort: Endpoint = { ip: HOST_IP, port: 80 }
  const entry = untranslated({ src: client, dst: hostPort })
  const wan = { en: 'Outside the host.', ja: 'ホストの外。' }
  return [
    {
      id: 'setup',
      title: {
        en: 'A listens on port 80, but it is not published',
        ja: 'A はポート 80 で待ち受けるが、公開していない',
      },
      description: {
        en: `${SETUP_TEXT.en} A runs a web server on port 80, but it was started without -p. There is no DNAT rule for it.`,
        ja: `${SETUP_TEXT.ja}A はポート 80 で Web サーバーを動かしているが、-p を付けずに起動した。そのための DNAT の規則はない。`,
      },
      events: [...setupEvents(model, [MASQUERADE_RULE]), set(A, SOCKET, 'LISTEN 0.0.0.0:80')],
    },
    {
      id: 'syn',
      title: {
        en: 'A client tries the host’s port 80',
        ja: 'クライアントがホストのポート 80 を試す',
      },
      description: {
        en: `No DNAT rule matches, so the packet is for the host itself, not for a container. Connection tracking still records it, with a reply that is just the reverse: nothing is translated. Nothing on the host listens on port 80 (the host’s own firewall is assumed to let the SYN in).`,
        ja: `どの DNAT の規則にも当たらないので、パケットはコンテナーではなくホスト自身へのもの。接続の追跡は記録するが、返事の向きはただの逆で、何も変換しない。ホストでポート 80 を待ち受けているものはない（ホスト自身のファイアウォールは SYN を通すものとする）。`,
      },
      events: [
        set(EXTERNAL, PEER, `to ${formatEndpoint(hostPort)}`),
        send(
          wanSegment('syn-in', EXTERNAL, HOST, {
            flags: 'SYN',
            src: client,
            dst: hostPort,
            status: 'rejected',
            description: wan,
          }),
        ),
        model.track(entry),
        set(HOST, DECISION, 'no rule: for the host itself'),
      ],
    },
    {
      id: 'rst',
      title: { en: 'The host refuses the connection', ja: 'ホストが接続を断る' },
      description: {
        en: `The host answers with RST, as for any closed port (RFC 9293 §3.10.7.1). The container’s address ${net.a} cannot be reached directly either: it is a private address with no route on the Internet (RFC 1918), and Docker (since Engine 28, in the default nat gateway mode) also blocks such direct access from the host’s LAN. To make the port reachable from outside, publish it with -p.`,
        ja: `ホストは、閉じたポートと同じく RST で答える（RFC 9293 §3.10.7.1）。コンテナーのアドレス ${net.a} にも直接は届かない。インターネットに経路のないプライベートアドレス（RFC 1918）で、ホストの LAN からの直接のアクセスも、Docker（Engine 28 から。既定の nat のゲートウェイのモード）が止めている。ポートに外から届くようにするには、-p で公開する。`,
      },
      events: [
        send(
          wanSegment('rst', HOST, EXTERNAL, {
            flags: 'RST, ACK',
            src: hostPort,
            dst: client,
            ttl: TTL,
            description: wan,
          }),
        ),
        model.track(model.advance(entry, 'RST, ACK', 'reply')),
        set(HOST, DECISION, 'RST: nothing listens on port 80'),
      ],
    },
  ]
}

function buildSteps(options: ContainerNetworkingOptions): readonly Step[] {
  const builders: Record<Situation, () => Step[]> = {
    outbound: outboundSteps,
    published: publishedSteps,
    sameBridge: () => sameBridgeSteps(DEFAULT_NETWORK, 80, false),
    userNetwork: () => sameBridgeSteps(USER_NETWORK, 5432, true),
    twoContainers: twoContainersSteps,
    unpublished: unpublishedSteps,
  }
  return builders[options.situation]()
}

export const containerNetworkingScenario: Scenario<ContainerNetworkingOptions> = {
  id: 'container-networking',
  title: {
    en: 'Container networking: veth, bridge and NAT',
    ja: 'コンテナーのネットワーク: veth、ブリッジ、NAT',
  },
  actors,
  optionDefs: {
    situation: {
      kind: 'select',
      label: { en: 'Situation', ja: '状況' },
      choices: [
        {
          value: 'outbound',
          label: {
            en: 'Container → Internet (MASQUERADE)',
            ja: 'コンテナーからインターネットへ（MASQUERADE）',
          },
        },
        {
          value: 'published',
          label: { en: 'Published port -p 8080:80 (DNAT)', ja: 'ポートの公開 -p 8080:80（DNAT）' },
        },
        {
          value: 'sameBridge',
          label: { en: 'Container to container on one bridge', ja: '同じブリッジのコンテナー同士' },
        },
        {
          value: 'userNetwork',
          label: {
            en: 'User-defined network and names',
            ja: 'ユーザー定義のネットワークと名前解決',
          },
        },
        {
          value: 'twoContainers',
          label: {
            en: 'Two containers, same source port',
            ja: '2 つのコンテナーが同じ送信元ポートを使う',
          },
        },
        {
          value: 'unpublished',
          label: { en: 'Port not published', ja: 'ポートを公開していない' },
        },
      ],
      defaultValue: 'outbound',
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
