/**
 * VLAN: 1 台のスイッチを別々のネットワークに分ける
 *
 * 根拠（IEEE の規格は RFC のように本文へ直接リンクできないので、規格名・年・節の題名で引く）:
 * - IEEE Std 802.1Q-2022
 *   - clause 9 "Tagged frame format"（9.5 "Tag Protocol Identifier (TPID) formats"、9.6 "VLAN Tag Control Information"）: タグは TPID 0x8100 と
 *     TCI（PCP 3 ビット、DEI 1 ビット、VID 12 ビット）。VID 0 は優先度だけのタグ、4095（0xFFF）は予約
 *   - clause 8.6 "The Forwarding Process"、8.8 "The Filtering Database": フレームは同じ VLAN のポートにだけ転送し、流す。
 *     MAC アドレステーブルは VLAN ごとに持つ（IVL。VID ごとに FID を分ける場合）
 *   - アクセスポートはタグなし（その VLAN に属する）、トランクポートは複数の VLAN のフレームをタグ付きで運ぶ
 * - RFC 1812 §5.2（ルーターは直接つながったネットワークの間でパケットを転送する）、§5.3.1（転送するパケットの TTL を 1 減らす）、
 *   §5.2.7.2（ICMP Redirect は、来たのと同じインターフェースに出し、送信元が次のホップと同じ論理サブネットのときだけ。
 *   VLAN を使わない場合もサブネットが違うので Redirect は送らない）
 * - RFC 826（ARP）、RFC 9542 §2.1.2（説明用の MAC アドレス）、RFC 1918（プライベートアドレス）
 * - VLAN ID には説明用の範囲がないので 10 と 20 を使う（1 は既定の VLAN、0 と 4095 は予約）
 *
 * 学習用の単純化: スイッチは 1 台。ルーターはトランクの 1 本のリンクにサブインターフェースを持つ（L3 スイッチは概要で触れる）。
 * ネイティブ VLAN、STP、VLAN を配る独自のプロトコルは扱わない。ルーターは PC C の MAC アドレスを ARP で知っているものとする。
 * PCP と DEI は 0
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

const optionsSchema = z.object({
  destination: z.enum(['other', 'same']).catch('other'),
  vlans: z.stringbool().catch(true),
})
export type VlanOptions = z.infer<typeof optionsSchema>

const PC_A: ActorId = 'pcA'
const PC_B: ActorId = 'pcB'
const SWITCH: ActorId = 'switch'
const ROUTER: ActorId = 'router'
const PC_C: ActorId = 'pcC'
const VLAN_TABLE: StateKey = 'vlanTable'
const MAC_TABLE: StateKey = 'macTable'
const DECISION: StateKey = 'decision'
const INTERFACES: StateKey = 'interfaces'
const ROUTING: StateKey = 'routing'
const NEXT_HOP: StateKey = 'nextHop'
const LAST_FRAME: StateKey = 'lastFrame'
export const VLAN_COLUMNS = ['Port', 'Mode', 'VLAN'] as const
export const MAC_COLUMNS = ['VLAN', 'MAC', 'Port'] as const
export const INTERFACE_COLUMNS = ['Interface', 'VLAN', 'IP'] as const

/** 機器のアドレス（RFC 1918、RFC 9542 §2.1.2）、ポート、VLAN */
export const HOSTS = {
  pcA: { ip: '192.168.10.10', mac: '00:00:5e:00:53:0a', port: 1, vlan: 10 },
  pcB: { ip: '192.168.10.20', mac: '00:00:5e:00:53:14', port: 2, vlan: 10 },
  pcC: { ip: '192.168.20.30', mac: '00:00:5e:00:53:1e', port: 3, vlan: 20 },
  router: {
    mac: '00:00:5e:00:53:01',
    port: 4,
    gateway10: '192.168.10.1',
    gateway20: '192.168.20.1',
  },
} as const
const BROADCAST_MAC = 'ff:ff:ff:ff:ff:ff'
/** VLAN を使わないときは、すべてのポートが既定の VLAN 1 */
const DEFAULT_VLAN = 1

const lastFrameSlot = {
  key: LAST_FRAME,
  label: { en: 'Last frame from the switch', ja: 'スイッチから届いた最後のフレーム' },
  initial: '-',
}

const actors: readonly Actor[] = [
  {
    id: PC_A,
    kind: 'client',
    name: { en: 'PC A (port 1, 192.168.10.10)', ja: 'PC A（ポート 1、192.168.10.10）' },
    shortName: { en: 'PC A', ja: 'PC A' },
    stateSlots: [{ key: NEXT_HOP, label: { en: 'Next hop', ja: 'ネクストホップ' }, initial: '-' }],
  },
  {
    id: PC_B,
    kind: 'client',
    name: { en: 'PC B (port 2, 192.168.10.20)', ja: 'PC B（ポート 2、192.168.10.20）' },
    shortName: { en: 'PC B', ja: 'PC B' },
    stateSlots: [lastFrameSlot],
  },
  {
    id: SWITCH,
    kind: 'switch',
    name: { en: 'Switch', ja: 'スイッチ' },
    stateSlots: [
      {
        key: VLAN_TABLE,
        label: { en: 'Ports and VLANs', ja: 'ポートと VLAN' },
        initial: { columns: VLAN_COLUMNS, rows: [] },
      },
      {
        key: MAC_TABLE,
        label: { en: 'MAC address table', ja: 'MAC アドレステーブル' },
        initial: { columns: MAC_COLUMNS, rows: [] },
      },
      { key: DECISION, label: { en: 'What the switch did', ja: 'スイッチの判断' }, initial: '-' },
    ],
  },
  {
    id: ROUTER,
    kind: 'router',
    name: { en: 'Router (port 4)', ja: 'ルーター（ポート 4）' },
    shortName: { en: 'Router', ja: 'ルーター' },
    stateSlots: [
      {
        key: INTERFACES,
        label: { en: 'Interfaces', ja: 'インターフェース' },
        initial: { columns: INTERFACE_COLUMNS, rows: [] },
      },
      { key: ROUTING, label: { en: 'Routing', ja: 'ルーティング' }, initial: '-' },
      lastFrameSlot,
    ],
  },
  {
    id: PC_C,
    kind: 'client',
    name: { en: 'PC C (port 3, 192.168.20.30)', ja: 'PC C（ポート 3、192.168.20.30）' },
    shortName: { en: 'PC C', ja: 'PC C' },
    stateSlots: [lastFrameSlot],
  },
]

const set = (actorId: ActorId, key: StateKey, value: string | StateTable): StepEvent => ({
  kind: 'stateChange',
  actorId,
  key,
  value,
})
const send = (message: Message): StepEvent => ({ kind: 'message', message })

const TAG_TEXT = {
  tpid: {
    en: '0x8100 in place of the EtherType marks an 802.1Q tag',
    ja: 'EtherType の位置の 0x8100 は、802.1Q のタグがあるしるし',
  },
  vid: {
    en: 'VLAN ID (12 bits): which VLAN this frame belongs to',
    ja: 'VLAN ID（12 ビット）。このフレームがどの VLAN のものか',
  },
  untagged: {
    en: 'Access ports carry frames without a tag; the port itself decides the VLAN',
    ja: 'アクセスポートはタグのないフレームを運ぶ。VLAN はポートで決まる',
  },
} satisfies Record<string, LocalizedText>

interface FrameSpec {
  readonly text: string
  readonly dst: string
  readonly src: string
  readonly etherType: string
  readonly payload: readonly PacketField[]
}

/** 送る場所（ポート）と、タグを付けるか */
interface Hop {
  readonly id: string
  readonly from: ActorId
  readonly to: ActorId
  /** トランクで運ぶなら VLAN ID（タグを付ける） */
  readonly tag: number | null
  readonly status?: Message['status']
}

function frame(spec: FrameSpec, hop: Hop, vlans: boolean): Message {
  const tagFields: PacketField[] =
    hop.tag !== null
      ? [
          { name: 'TPID', value: '0x8100', description: TAG_TEXT.tpid },
          { name: 'PCP / DEI', value: '0 / 0' },
          { name: 'VID', value: String(hop.tag), highlight: true, description: TAG_TEXT.vid },
        ]
      : vlans
        ? [{ name: '802.1Q tag', value: '(none)', description: TAG_TEXT.untagged }]
        : []
  return {
    id: hop.id,
    from: hop.from,
    to: hop.to,
    label: hop.tag === null ? spec.text : `${spec.text} [tag ${String(hop.tag)}]`,
    status: hop.status ?? 'delivered',
    fields: [
      { name: 'Eth Dst', value: spec.dst, highlight: spec.dst === BROADCAST_MAC },
      { name: 'Eth Src', value: spec.src },
      ...tagFields,
      { name: 'EtherType', value: spec.etherType },
      ...spec.payload,
    ],
  }
}

const macTable = (rows: readonly (readonly [number, string, number])[]): StateTable => ({
  columns: MAC_COLUMNS,
  rows: rows.map(([vlan, mac, port]) => [String(vlan), mac, String(port)]),
})

function buildSteps(options: VlanOptions): readonly Step[] {
  const { destination, vlans } = options
  const other = destination === 'other'
  const v10 = vlans ? 10 : DEFAULT_VLAN
  const v20 = vlans ? 20 : DEFAULT_VLAN
  // トランクのタグ（VLAN を使わないときはタグなし）
  const trunkTag = (vlan: number) => (vlans ? vlan : null)
  const target = other
    ? { id: ROUTER, ip: HOSTS.router.gateway10, mac: HOSTS.router.mac, port: HOSTS.router.port }
    : { id: PC_B, ...HOSTS.pcB }
  const bystander = other ? PC_B : ROUTER
  const rows: [number, string, number][] = []
  // 同じ VLAN と MAC アドレスの行がすでにあれば、足さずに新しくする（ポートを書き換える）
  const learn = (vlan: number, mac: string, port: number) => {
    const existing = rows.find(([rowVlan, rowMac]) => rowVlan === vlan && rowMac === mac)
    if (existing === undefined) {
      rows.push([vlan, mac, port])
    } else {
      existing[2] = port
    }
    return set(SWITCH, MAC_TABLE, macTable(rows))
  }

  const arpRequest: FrameSpec = {
    text: `ARP who-has ${target.ip}`,
    dst: BROADCAST_MAC,
    src: HOSTS.pcA.mac,
    etherType: '0x0806 (ARP)',
    payload: [
      { name: 'OPER', value: '1 (request)' },
      { name: 'TPA', value: target.ip },
    ],
  }
  const arpReply: FrameSpec = {
    text: `ARP is-at ${target.mac}`,
    dst: HOSTS.pcA.mac,
    src: target.mac,
    etherType: '0x0806 (ARP)',
    payload: [
      { name: 'OPER', value: '2 (reply)' },
      { name: 'SHA', value: target.mac },
    ],
  }
  const destinationIp = other ? HOSTS.pcC.ip : HOSTS.pcB.ip
  const ipPacket = (dst: string, src: string, ttl: number): FrameSpec => ({
    text: `IP → ${destinationIp}`,
    dst,
    src,
    etherType: '0x0800 (IPv4)',
    payload: [
      { name: 'IP Src → Dst', value: `${HOSTS.pcA.ip} → ${destinationIp}` },
      { name: 'TTL', value: String(ttl) },
    ],
  })

  const floodTargets: { id: ActorId; port: number; delivered: boolean }[] = [
    { id: PC_B, port: 2, delivered: !other },
    { id: ROUTER, port: 4, delivered: other },
    ...(vlans ? [] : [{ id: PC_C, port: 3, delivered: false }]),
  ]
  const floodPorts = floodTargets
    .map((t) => t.port)
    .sort((a, b) => a - b)
    .join(', ')

  const steps: Step[] = [
    {
      id: 'setup',
      title: vlans
        ? { en: 'Two VLANs on one switch', ja: '1 台のスイッチに 2 つの VLAN' }
        : { en: 'One switch, no VLANs', ja: '1 台のスイッチ、VLAN なし' },
      description: vlans
        ? {
            en: `Ports 1 and 2 are access ports in VLAN 10 (192.168.10.0/24), and port 3 is in VLAN 20 (192.168.20.0/24). Port 4 is a trunk that carries both VLANs to the router, which has one subinterface per VLAN. PC A wants to send to ${destinationIp}. ${other ? 'That is on another subnet, so the next hop is its default gateway, 192.168.10.1.' : 'That is on its own subnet, so it sends directly.'}`,
            ja: `ポート 1 と 2 は VLAN 10（192.168.10.0/24）、ポート 3 は VLAN 20（192.168.20.0/24）のアクセスポート。ポート 4 は両方の VLAN をルーターまで運ぶトランクで、ルーターは VLAN ごとにサブインターフェースを持つ。PC A は ${destinationIp} に送りたい。${other ? '別のサブネットなので、ネクストホップはデフォルトゲートウェイの 192.168.10.1。' : '同じサブネットなので、直接送る。'}`,
          }
        : {
            en: `Every port is in the default VLAN 1, so all four devices share one broadcast domain, although PC C is on another subnet (192.168.20.0/24). The router has both gateway addresses on one interface. PC A wants to send to ${destinationIp}.`,
            ja: `すべてのポートが既定の VLAN 1 にあるので、PC C は別のサブネット（192.168.20.0/24）なのに、4 台がみな 1 つのブロードキャストドメインにいる。ルーターは 1 つのインターフェースに両方のゲートウェイのアドレスを持つ。PC A は ${destinationIp} に送りたい。`,
          },
      events: [
        set(SWITCH, VLAN_TABLE, {
          columns: VLAN_COLUMNS,
          rows: vlans
            ? [
                ['1', 'access', '10'],
                ['2', 'access', '10'],
                ['3', 'access', '20'],
                ['4', 'trunk', '10, 20'],
              ]
            : [
                ['1', 'access', '1'],
                ['2', 'access', '1'],
                ['3', 'access', '1'],
                ['4', 'access', '1'],
              ],
        }),
        set(ROUTER, INTERFACES, {
          columns: INTERFACE_COLUMNS,
          rows: vlans
            ? [
                ['eth0.10', '10', HOSTS.router.gateway10],
                ['eth0.20', '20', HOSTS.router.gateway20],
              ]
            : [
                ['eth0', '-', HOSTS.router.gateway10],
                ['eth0', '-', HOSTS.router.gateway20],
              ],
        }),
        set(
          PC_A,
          NEXT_HOP,
          other ? `${HOSTS.router.gateway10} (gateway)` : `${HOSTS.pcB.ip} (on-link)`,
        ),
      ],
    },
    {
      id: 'arp',
      title: {
        en: `PC A broadcasts an ARP request for ${target.ip}`,
        ja: `PC A が ${target.ip} の ARP の要求をブロードキャストする`,
      },
      description: {
        en: `The frame enters port 1${vlans ? ', so it belongs to VLAN 10. The switch learns the source address in VLAN 10' : ' and the switch learns its source address'}.`,
        ja: `フレームはポート 1 から入る${vlans ? 'ので、VLAN 10 のフレームになる。スイッチは送信元のアドレスを VLAN 10 の中で学習する' : '。スイッチは送信元のアドレスを学習する'}。`,
      },
      events: [
        send(frame(arpRequest, { id: 'arp', from: PC_A, to: SWITCH, tag: null }, vlans)),
        learn(v10, HOSTS.pcA.mac, 1),
        set(SWITCH, DECISION, 'learn: port 1'),
      ],
    },
    {
      id: 'flood',
      title: vlans
        ? { en: 'Flooded only inside VLAN 10', ja: 'VLAN 10 の中にだけ流す' }
        : { en: 'Flooded to every other port', ja: 'ほかの全ポートに流す' },
      description: vlans
        ? {
            en: `A broadcast is flooded only to the ports of the same VLAN: port 2 and the trunk, port 4. On the trunk the switch adds an 802.1Q tag with VLAN ID 10, so the router knows which VLAN the frame came from. Port 3 is in VLAN 20, so PC C receives nothing. ${other ? 'PC B is not the target and ignores the request.' : 'The router is not the target and ignores the request.'}`,
            ja: `ブロードキャストは、同じ VLAN のポートにだけ流す。ポート 2 とトランクのポート 4。トランクではスイッチが VLAN ID 10 の 802.1Q のタグを付けるので、ルーターはどの VLAN から来たフレームかがわかる。ポート 3 は VLAN 20 なので、PC C には何も届かない。${other ? 'PC B は対象ではないので要求を無視する。' : 'ルーターは対象ではないので要求を無視する。'}`,
          }
        : {
            en: 'Without VLANs, the broadcast reaches every other port, including PC C on the other subnet. Every extra device on the LAN receives and processes every broadcast.',
            ja: 'VLAN がなければ、ブロードキャストは別のサブネットの PC C も含め、ほかのすべてのポートに届く。LAN の機器が増えるほど、どの機器もすべてのブロードキャストを受け取って処理することになる。',
          },
      events: [
        ...floodTargets.map((t) =>
          send(
            frame(
              arpRequest,
              {
                id: `flood-${t.id}`,
                from: SWITCH,
                to: t.id,
                tag: t.id === ROUTER ? trunkTag(10) : null,
                status: t.delivered ? 'delivered' : 'rejected',
              },
              vlans,
            ),
          ),
        ),
        set(bystander, LAST_FRAME, 'ignored (not the target)'),
        ...(vlans ? [] : [set(PC_C, LAST_FRAME, 'ignored (not the target)')]),
        set(
          SWITCH,
          DECISION,
          vlans ? `flood: ports ${floodPorts} (VLAN 10)` : `flood: ports ${floodPorts}`,
        ),
      ],
    },
    {
      id: 'reply',
      title: { en: 'The ARP reply comes back', ja: 'ARP の応答が戻る' },
      description: other
        ? vlans
          ? {
              en: `The router answers on its VLAN 10 subinterface. The reply comes back on the trunk tagged with VLAN 10, and the switch removes the tag before sending it out of access port 1. The switch learns the router in VLAN 10 on port 4.`,
              ja: `ルーターは VLAN 10 のサブインターフェースで答える。応答はトランクで戻り（VLAN 10 のタグ付き）、スイッチはアクセスポートの 1 に送る前にタグを外す。スイッチはルーターを VLAN 10 のポート 4 として学習する。`,
            }
          : {
              en: 'The router answers. The switch learns the router on port 4 and sends the reply to port 1 only.',
              ja: 'ルーターが答える。スイッチはルーターをポート 4 として学習し、応答をポート 1 にだけ送る。',
            }
        : {
            en: `PC B answers. The switch learns PC B on port 2 and sends the reply to port 1 only.`,
            ja: 'PC B が答える。スイッチは PC B をポート 2 として学習し、応答をポート 1 にだけ送る。',
          },
      events: [
        send(
          frame(
            arpReply,
            { id: 'reply', from: target.id, to: SWITCH, tag: other ? trunkTag(10) : null },
            vlans,
          ),
        ),
        learn(v10, target.mac, target.port),
        send(frame(arpReply, { id: 'reply-forward', from: SWITCH, to: PC_A, tag: null }, vlans)),
        set(SWITCH, DECISION, 'forward: port 1'),
      ],
    },
  ]

  if (!other) {
    steps.push({
      id: 'send',
      title: vlans
        ? {
            en: 'Within one VLAN, the switch delivers directly',
            ja: '同じ VLAN の中なら、スイッチが直接届ける',
          }
        : { en: 'The switch delivers directly', ja: 'スイッチが直接届ける' },
      description: {
        en: 'PC A sends the packet to PC B’s MAC address. The switch forwards it from port 1 to port 2. The router is never involved: traffic inside one VLAN is just switched.',
        ja: 'PC A は PC B の MAC アドレスにパケットを送る。スイッチはポート 1 からポート 2 に転送する。ルーターは関わらない。同じ VLAN の中の通信は、スイッチが運ぶだけ。',
      },
      events: [
        send(
          frame(
            ipPacket(HOSTS.pcB.mac, HOSTS.pcA.mac, 64),
            { id: 'send', from: PC_A, to: SWITCH, tag: null },
            vlans,
          ),
        ),
        send(
          frame(
            ipPacket(HOSTS.pcB.mac, HOSTS.pcA.mac, 64),
            { id: 'send-forward', from: SWITCH, to: PC_B, tag: null },
            vlans,
          ),
        ),
        set(SWITCH, DECISION, 'forward: port 2'),
        set(PC_B, LAST_FRAME, 'accepted'),
      ],
    })
    return steps
  }

  const toRouter = ipPacket(HOSTS.router.mac, HOSTS.pcA.mac, 64)
  const toPcC = ipPacket(HOSTS.pcC.mac, HOSTS.router.mac, 63)
  // ルーターから出たフレームの宛先（PC C）はまだ学習していないので、スイッチはその VLAN の中で流す
  const floodC: { id: ActorId; port: number; delivered: boolean }[] = vlans
    ? [{ id: PC_C, port: 3, delivered: true }]
    : [
        { id: PC_A, port: 1, delivered: false },
        { id: PC_B, port: 2, delivered: false },
        { id: PC_C, port: 3, delivered: true },
      ]
  steps.push(
    {
      id: 'send',
      title: { en: 'PC A sends the packet to the router', ja: 'PC A がパケットをルーターに送る' },
      description: {
        en: `The packet is addressed to 192.168.20.30, but the frame goes to the router’s MAC address. The switch knows the router is on port 4 and forwards it there${vlans ? ', tagged with VLAN 10' : ''}.`,
        ja: `パケットの宛先は 192.168.20.30 だが、フレームはルーターの MAC アドレス宛て。スイッチはルーターがポート 4 にいると知っているので、${vlans ? 'VLAN 10 のタグを付けて' : ''}そこに転送する。`,
      },
      events: [
        send(frame(toRouter, { id: 'send', from: PC_A, to: SWITCH, tag: null }, vlans)),
        send(
          frame(toRouter, { id: 'send-trunk', from: SWITCH, to: ROUTER, tag: trunkTag(10) }, vlans),
        ),
        set(SWITCH, DECISION, 'forward: port 4'),
      ],
    },
    {
      id: 'route',
      title: vlans
        ? {
            en: 'The router moves the packet to VLAN 20',
            ja: 'ルーターがパケットを VLAN 20 に移す',
          }
        : {
            en: 'The router forwards between the subnets',
            ja: 'ルーターがサブネットの間で転送する',
          },
      description: vlans
        ? {
            en: 'Between VLANs, only a router can forward: the switch never moves a frame from one VLAN to another. The router receives the packet on eth0.10, decreases the TTL, and sends it out of eth0.20 to PC C’s MAC address, so it goes back on the same trunk tagged with VLAN 20. The switch has not learned PC C yet, so it floods the frame inside VLAN 20, which only reaches port 3.',
            ja: 'VLAN の間はルーターしか転送できない。スイッチはフレームを別の VLAN に移すことはない。ルーターは eth0.10 でパケットを受け取り、TTL を 1 減らし、PC C の MAC アドレス宛てに eth0.20 から送る。そのため同じトランクを VLAN 20 のタグ付きで戻る。スイッチは PC C をまだ学習していないので、VLAN 20 の中で流し、それはポート 3 にだけ届く。',
          }
        : {
            en: 'PC C is on another subnet, so even without VLANs the packet has to go through the router, which sends it back out of the same interface to PC C’s MAC address. The switch has not learned PC C yet and floods the frame to every other port; PC A and PC B drop it.',
            ja: 'PC C は別のサブネットなので、VLAN がなくてもパケットはルーターを通る。ルーターは同じインターフェースから PC C の MAC アドレス宛てに送り返す。スイッチは PC C をまだ学習していないので、ほかのすべてのポートに流し、PC A と PC B は捨てる。',
          },
      events: [
        set(ROUTER, ROUTING, vlans ? 'eth0.10 → eth0.20' : 'eth0 → eth0'),
        send(frame(toPcC, { id: 'route', from: ROUTER, to: SWITCH, tag: trunkTag(20) }, vlans)),
        learn(v20, HOSTS.router.mac, 4),
        ...floodC.map((t) =>
          send(
            frame(
              toPcC,
              {
                id: `deliver-${t.id}`,
                from: SWITCH,
                to: t.id,
                tag: null,
                status: t.delivered ? 'delivered' : 'rejected',
              },
              vlans,
            ),
          ),
        ),
        set(PC_C, LAST_FRAME, 'accepted'),
        ...(vlans ? [] : [set(PC_B, LAST_FRAME, 'dropped (not my MAC)')]),
        set(SWITCH, DECISION, vlans ? 'flood: port 3 (VLAN 20)' : 'flood: ports 1, 2, 3'),
      ],
    },
  )
  return steps
}

export const vlanScenario: Scenario<VlanOptions> = {
  id: 'vlan',
  title: {
    en: 'VLAN: one switch, separate networks',
    ja: 'VLAN: 1 台のスイッチを別々のネットワークに分ける',
  },
  actors,
  optionDefs: {
    destination: {
      kind: 'select',
      label: { en: 'PC A sends to', ja: 'PC A の送り先' },
      choices: [
        { value: 'other', label: { en: 'PC C (VLAN 20)', ja: 'PC C（VLAN 20）' } },
        { value: 'same', label: { en: 'PC B (VLAN 10)', ja: 'PC B（VLAN 10）' } },
      ],
      defaultValue: 'other',
    },
    vlans: {
      kind: 'toggle',
      label: { en: 'Use VLANs', ja: 'VLAN を使う' },
      defaultValue: true,
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
