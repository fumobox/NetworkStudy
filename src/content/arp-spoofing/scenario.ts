/**
 * ARP スプーフィングと Dynamic ARP Inspection: 偽の ARP の応答と、スイッチでの防ぎ方
 *
 * 根拠（標準）:
 * - RFC 826「Packet Reception」: 送信元の IP アドレスがもう表にあれば、操作（要求か応答か）を見る前に MAC アドレスを書き換える。
 *   応答が自分の要求への答えかは確かめない（arpCache.ts）。パケットの形式（HTYPE、PTYPE、HLEN、PLEN、OPER、SHA、SPA、THA、TPA）
 * - RFC 5227 §2.3（ARP Announcement）、§2.4（自分のアドレスを別の MAC アドレスで名乗るパケットを見たら衝突として扱い、
 *   既定のルーターのように変えられないホストは自分の Announcement で守ってよい）。守れるのは、そのパケットが届いたときだけ
 * - RFC 2131（DHCPACK の yiaddr、chaddr）、RFC 2132（オプション 51、53）
 * - RFC 7513 §6（SAVI for DHCP: 束縛は、信頼するポートから届いたサーバーの応答で記録する）、§8.2（送信元の IP アドレスが
 *   そのポートに束縛されていない ARP と、対象の IP アドレスが束縛されていない ARP の応答を捨てる）、RFC 7039（SAVI の枠組み）。
 *   SAVI は仕様で、束縛はポート（binding anchor）に結びつき、データのパケットの送信元も確かめる。製品の機能は DAI など
 * - RFC 9542 §2.1.4（説明用の MAC アドレス 00-00-5E-00-53-00〜FF）、RFC 5737・RFC 1918（アドレス）
 *
 * 標準ではなく実装で決まるもの（概要で書き分ける）:
 * - DHCP スヌーピングと DAI は Cisco などのスイッチの機能（dai.ts）。Cisco IOS XE の「Configuring Dynamic ARP Inspection」
 *   「Configuring DHCP」の文書にならう（信頼するポートは確かめない、ARP ACL は束縛表より先、静的な IP アドレスのホストには ACL が要る）
 * - 静的な ARP エントリーは OS の機能で、ARP では書き換わらない
 * - Linux（net/ipv4/arp.c、ip-sysctl の arp_accept）: 行がないときに頼んでいない ARP で行を作るかは arp_accept（既定 0 は作らない）。
 *   行があれば、arp_accept によらず書き換える
 *
 * 学習用の単純化: スイッチは 1 台、VLAN は 1 つ。攻撃者は PC A の向きだけをだます（逆の向きは説明だけ）。
 * DHCP の DISCOVER・OFFER・REQUEST と、ARP の再送、キャッシュの寿命は描かない。攻撃者はパケットをそのまま
 * ゲートウェイに渡す（TTL の扱いは描かない）。DAI の追加の検査とレート制限は扱わない
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
import {
  applyArpPacket,
  CACHE_COLUMNS,
  type ArpEntry,
  type ArpPacket,
  type CacheAction,
} from './arpCache'
import {
  BINDING_COLUMNS,
  bindingFromAck,
  describeDai,
  inspectArp,
  type AclEntry,
  type Binding,
  type DaiConfig,
} from './dai'

const SITUATIONS = ['poison', 'dai', 'arpAcl', 'staticEntry'] as const

const optionsSchema = z.object({
  situation: z.enum(SITUATIONS).catch('poison'),
})
export type ArpSpoofingOptions = z.infer<typeof optionsSchema>
type Situation = ArpSpoofingOptions['situation']

const PC: ActorId = 'pc'
const SWITCH: ActorId = 'switch'
const ATTACKER: ActorId = 'attacker'
const GATEWAY: ActorId = 'gateway'

const NEXT_HOP: StateKey = 'nextHop'
const CACHE: StateKey = 'cache'
const DECISION: StateKey = 'decision'
const MAC_TABLE: StateKey = 'macTable'
const TRUSTED: StateKey = 'trusted'
const BINDINGS: StateKey = 'bindings'
const ACL: StateKey = 'acl'
const DAI: StateKey = 'dai'
const CAPTURED: StateKey = 'captured'

export const MAC_COLUMNS = ['MAC', 'Port'] as const
export const CAPTURED_COLUMNS = ['Packet', 'Forwarded to'] as const

/** 説明用のアドレス（RFC 1918 / RFC 5737）と MAC アドレス（RFC 9542 §2.1.4）。MAC の最後のバイトは IP の最後の数の 16 進 */
export const ADDRESSES = {
  pc: { ip: '192.168.1.10', mac: '00:00:5e:00:53:0a', port: 1 },
  gateway: { ip: '192.168.1.1', mac: '00:00:5e:00:53:01', port: 2 },
  attacker: { ip: '192.168.1.66', mac: '00:00:5e:00:53:42', port: 3 },
  server: { ip: '192.0.2.10' },
} as const
const BROADCAST_MAC = 'ff:ff:ff:ff:ff:ff'
const UNKNOWN_MAC = '00:00:00:00:00:00'
const LEASE_S = 3600

// ---------- 状態 ----------

const cacheTable = (entries: readonly ArpEntry[]): StateTable => ({
  columns: CACHE_COLUMNS,
  rows: entries.map((entry) => [entry.ip, entry.mac, entry.type]),
})
const macTable = (rows: readonly (readonly [string, number])[]): StateTable => ({
  columns: MAC_COLUMNS,
  rows: rows.map(([mac, port]) => [mac, String(port)]),
})
const bindingTable = (bindings: readonly Binding[]): StateTable => ({
  columns: BINDING_COLUMNS,
  rows: bindings.map((b) => [b.ip, b.mac, String(b.port), `${String(b.leaseS)} s`]),
})
const capturedTable = (rows: readonly (readonly [string, string])[]): StateTable => ({
  columns: CAPTURED_COLUMNS,
  rows,
})

const FULL_MAC_TABLE = macTable([
  [ADDRESSES.pc.mac, ADDRESSES.pc.port],
  [ADDRESSES.gateway.mac, ADDRESSES.gateway.port],
  [ADDRESSES.attacker.mac, ADDRESSES.attacker.port],
])
const TRUSTED_PORT = `port ${String(ADDRESSES.gateway.port)} (gateway, DHCP server)`
const ATTACKER_BINDING: Binding = {
  ip: ADDRESSES.attacker.ip,
  mac: ADDRESSES.attacker.mac,
  port: ADDRESSES.attacker.port,
  leaseS: LEASE_S,
}
const GATEWAY_ENTRY: ArpEntry = {
  ip: ADDRESSES.gateway.ip,
  mac: ADDRESSES.gateway.mac,
  type: 'dynamic',
}
const PC_ENTRY: ArpEntry = { ip: ADDRESSES.pc.ip, mac: ADDRESSES.pc.mac, type: 'dynamic' }

const nextHopOf = (mac: string): string =>
  mac === ADDRESSES.gateway.mac ? `${mac} (gateway)` : `${mac} (attacker)`

const actors: readonly Actor[] = [
  {
    id: PC,
    kind: 'client',
    name: { en: 'PC A (192.168.1.10)', ja: 'PC A（192.168.1.10）' },
    shortName: { en: 'PC A', ja: 'PC A' },
    stateSlots: [
      {
        key: NEXT_HOP,
        label: { en: 'Frames to the Internet go to', ja: 'インターネットへのフレームの宛先' },
        initial: '-',
      },
      {
        key: CACHE,
        label: { en: 'ARP cache', ja: 'ARP キャッシュ' },
        initial: cacheTable([]),
      },
      {
        key: DECISION,
        label: {
          en: 'What PC A did with the last ARP packet',
          ja: '最後の ARP のパケットで PC A がしたこと',
        },
        initial: '-',
      },
    ],
  },
  {
    id: SWITCH,
    kind: 'switch',
    name: { en: 'Switch', ja: 'スイッチ' },
    stateSlots: [
      {
        key: MAC_TABLE,
        label: { en: 'MAC address table', ja: 'MAC アドレステーブル' },
        initial: macTable([]),
      },
      { key: TRUSTED, label: { en: 'Trusted ports', ja: '信頼するポート' }, initial: '-' },
      {
        key: BINDINGS,
        label: { en: 'DHCP snooping binding table', ja: 'DHCP スヌーピングの束縛表' },
        initial: bindingTable([]),
      },
      { key: ACL, label: { en: 'ARP ACL', ja: 'ARP ACL' }, initial: '-' },
      { key: DAI, label: { en: 'What the switch did', ja: 'スイッチがしたこと' }, initial: '-' },
    ],
  },
  {
    id: ATTACKER,
    kind: 'client',
    name: { en: 'Attacker (192.168.1.66)', ja: '攻撃者（192.168.1.66）' },
    shortName: { en: 'Attacker', ja: '攻撃者' },
    stateSlots: [
      {
        key: CAPTURED,
        label: { en: 'Packets it received', ja: '受け取ったパケット' },
        initial: capturedTable([]),
      },
    ],
  },
  {
    id: GATEWAY,
    kind: 'router',
    name: { en: 'Gateway (192.168.1.1)', ja: 'ゲートウェイ（192.168.1.1）' },
    shortName: { en: 'Gateway', ja: 'ゲートウェイ' },
    stateSlots: [
      {
        key: CACHE,
        label: { en: 'ARP cache', ja: 'ARP キャッシュ' },
        initial: cacheTable([]),
      },
    ],
  },
]

const set = (actorId: ActorId, key: StateKey, value: string | StateTable): StepEvent => ({
  kind: 'stateChange',
  actorId,
  key,
  value,
})
const send = (message: Message): StepEvent => ({ kind: 'message', message })

// ---------- フレーム ----------

const ETH_FIELDS = new Set(['Eth Dst', 'Eth Src', 'EtherType'])
const ARP_FIELDS = new Set(['HTYPE', 'PTYPE', 'HLEN', 'PLEN', 'OPER', 'SHA', 'SPA', 'THA', 'TPA'])
const SUMMARY_FIELDS = new Set(['Eth Dst', 'Eth Src', 'OPER', 'SHA', 'SPA', 'IP Src', 'IP Dst'])

/** パケットの詳細の層（Ethernet II と ARP、または Ethernet II と IPv4）。フィールドの名前から層を決める */
function withLayers(fields: readonly PacketField[]): PacketField[] {
  return fields.map((field) => ({
    ...field,
    layer: ETH_FIELDS.has(field.name) ? 'eth' : ARP_FIELDS.has(field.name) ? 'arp' : 'ipv4',
    ...(SUMMARY_FIELDS.has(field.name) ? { inLayerSummary: true } : {}),
  }))
}

const FIELD_TEXT = {
  ethDst: { en: 'Ethernet destination MAC address', ja: 'Ethernet の宛先の MAC アドレス' },
  ethSrc: { en: 'Ethernet source MAC address', ja: 'Ethernet の送信元の MAC アドレス' },
  arpType: { en: 'EtherType: 0x0806 is ARP', ja: 'EtherType。0x0806 は ARP' },
  ipType: { en: 'EtherType: 0x0800 is IPv4', ja: 'EtherType。0x0800 は IPv4' },
  htype: { en: 'Hardware type: 1 is Ethernet', ja: 'ハードウェアの種類。1 は Ethernet' },
  ptype: { en: 'Protocol type: 0x0800 is IPv4', ja: 'プロトコルの種類。0x0800 は IPv4' },
  hlen: { en: 'Length of a MAC address (bytes)', ja: 'MAC アドレスの長さ（バイト）' },
  plen: { en: 'Length of an IPv4 address (bytes)', ja: 'IPv4 アドレスの長さ（バイト）' },
  request: { en: 'Operation: 1 is a request', ja: '操作。1 は要求' },
  reply: { en: 'Operation: 2 is a reply', ja: '操作。2 は応答' },
  sha: { en: 'Sender MAC address', ja: '送信元の MAC アドレス' },
  spa: { en: 'Sender IP address', ja: '送信元の IP アドレス' },
  tha: { en: 'Target MAC address', ja: '対象の MAC アドレス' },
  thaUnknown: {
    en: 'Target MAC address: unknown yet, so all zeros',
    ja: '対象の MAC アドレス。まだわからないので 0 を入れる',
  },
  tpa: { en: 'Target IP address', ja: '対象の IP アドレス' },
  ipSrc: { en: 'Source IP address', ja: '送信元の IP アドレス' },
  ipDst: { en: 'Destination IP address', ja: '宛先の IP アドレス' },
} satisfies Record<string, LocalizedText>

interface ArpFrame {
  readonly label: string
  readonly ethDst: string
  readonly ethSrc: string
  readonly packet: ArpPacket
  /** SHA と SPA の説明（偽の応答では、うそであることを書く） */
  readonly shaText?: LocalizedText
  readonly spaText?: LocalizedText
}

function arpFields(frame: ArpFrame): PacketField[] {
  const { packet } = frame
  const request = packet.oper === 1
  return withLayers([
    { name: 'Eth Dst', value: frame.ethDst, highlight: true, description: FIELD_TEXT.ethDst },
    { name: 'Eth Src', value: frame.ethSrc, description: FIELD_TEXT.ethSrc },
    { name: 'EtherType', value: '0x0806', description: FIELD_TEXT.arpType },
    { name: 'HTYPE', value: '1', description: FIELD_TEXT.htype },
    { name: 'PTYPE', value: '0x0800', description: FIELD_TEXT.ptype },
    { name: 'HLEN', value: '6', description: FIELD_TEXT.hlen },
    { name: 'PLEN', value: '4', description: FIELD_TEXT.plen },
    {
      name: 'OPER',
      value: request ? '1 (request)' : '2 (reply)',
      description: request ? FIELD_TEXT.request : FIELD_TEXT.reply,
    },
    {
      name: 'SHA',
      value: packet.sha,
      highlight: true,
      description: frame.shaText ?? FIELD_TEXT.sha,
    },
    {
      name: 'SPA',
      value: packet.spa,
      highlight: true,
      description: frame.spaText ?? FIELD_TEXT.spa,
    },
    {
      name: 'THA',
      value: packet.tha,
      description: packet.tha === UNKNOWN_MAC ? FIELD_TEXT.thaUnknown : FIELD_TEXT.tha,
    },
    { name: 'TPA', value: packet.tpa, description: FIELD_TEXT.tpa },
  ])
}

/** PC A がゲートウェイを尋ねる要求（ブロードキャスト） */
const ARP_REQUEST: ArpFrame = {
  label: `ARP who-has ${ADDRESSES.gateway.ip}`,
  ethDst: BROADCAST_MAC,
  ethSrc: ADDRESSES.pc.mac,
  packet: {
    oper: 1,
    sha: ADDRESSES.pc.mac,
    spa: ADDRESSES.pc.ip,
    tha: UNKNOWN_MAC,
    tpa: ADDRESSES.gateway.ip,
  },
}

/** ゲートウェイの本当の応答 */
const ARP_REPLY: ArpFrame = {
  label: `ARP ${ADDRESSES.gateway.ip} is-at ${ADDRESSES.gateway.mac}`,
  ethDst: ADDRESSES.pc.mac,
  ethSrc: ADDRESSES.gateway.mac,
  packet: {
    oper: 2,
    sha: ADDRESSES.gateway.mac,
    spa: ADDRESSES.gateway.ip,
    tha: ADDRESSES.pc.mac,
    tpa: ADDRESSES.pc.ip,
  },
}

/** 攻撃者の偽の応答。どの状況でも同じ（違うのはネットワークの守り方だけ） */
export const FORGED_REPLY: ArpFrame = {
  label: `ARP ${ADDRESSES.gateway.ip} is-at ${ADDRESSES.attacker.mac}`,
  ethDst: ADDRESSES.pc.mac,
  ethSrc: ADDRESSES.attacker.mac,
  packet: {
    oper: 2,
    sha: ADDRESSES.attacker.mac,
    spa: ADDRESSES.gateway.ip,
    tha: ADDRESSES.pc.mac,
    tpa: ADDRESSES.pc.ip,
  },
  shaText: {
    en: 'Sender MAC address: the attacker’s own, the same as Eth Src, so the frame looks consistent',
    ja: '送信元の MAC アドレス。攻撃者自身のもので、Eth Src と同じなので、フレームに矛盾はない',
  },
  spaText: {
    en: 'Sender IP address: the gateway’s address, but the gateway did not send this. Nothing in ARP proves it',
    ja: '送信元の IP アドレス。ゲートウェイのアドレスだが、送ったのはゲートウェイではない。ARP には、それを確かめる手段がない',
  },
}

function arpMessage(
  id: string,
  from: ActorId,
  to: ActorId,
  frame: ArpFrame,
  description: LocalizedText,
  status: Message['status'] = 'delivered',
): Message {
  return { id, from, to, label: frame.label, status, description, fields: arpFields(frame) }
}

interface IpFrame {
  readonly ethDst: string
  readonly ethSrc: string
  readonly ipSrc: string
  readonly ipDst: string
}

function ipMessage(
  id: string,
  from: ActorId,
  to: ActorId,
  frame: IpFrame,
  description: LocalizedText,
): Message {
  return {
    id,
    from,
    to,
    label: `IP ${frame.ipSrc} → ${frame.ipDst}`,
    status: 'delivered',
    description,
    fields: withLayers([
      { name: 'Eth Dst', value: frame.ethDst, highlight: true, description: FIELD_TEXT.ethDst },
      { name: 'Eth Src', value: frame.ethSrc, description: FIELD_TEXT.ethSrc },
      { name: 'EtherType', value: '0x0800', description: FIELD_TEXT.ipType },
      { name: 'IP Src', value: frame.ipSrc, description: FIELD_TEXT.ipSrc },
      { name: 'IP Dst', value: frame.ipDst, highlight: true, description: FIELD_TEXT.ipDst },
    ]),
  }
}

const toServer = (ethDst: string, ethSrc: string = ADDRESSES.pc.mac): IpFrame => ({
  ethDst,
  ethSrc,
  ipSrc: ADDRESSES.pc.ip,
  ipDst: ADDRESSES.server.ip,
})
const FROM_SERVER: IpFrame = {
  ethDst: ADDRESSES.pc.mac,
  ethSrc: ADDRESSES.gateway.mac,
  ipSrc: ADDRESSES.server.ip,
  ipDst: ADDRESSES.pc.ip,
}
const PACKET_toServer = `IP ${ADDRESSES.pc.ip} → ${ADDRESSES.server.ip}`

/** DHCPACK（RFC 2131、RFC 2132）。層は付けない（DHCP のテーマと同じく平らな一覧） */
function dhcpAckMessage(
  id: string,
  from: ActorId,
  to: ActorId,
  description: LocalizedText,
): Message {
  return {
    id,
    from,
    to,
    label: `DHCPACK ${ADDRESSES.pc.ip}`,
    status: 'delivered',
    description,
    fields: [
      { name: 'Eth Dst', value: ADDRESSES.pc.mac, description: FIELD_TEXT.ethDst },
      { name: 'Eth Src', value: ADDRESSES.gateway.mac, description: FIELD_TEXT.ethSrc },
      { name: 'IP Src → Dst', value: `${ADDRESSES.gateway.ip} → ${ADDRESSES.pc.ip}` },
      { name: 'UDP port', value: '67 → 68' },
      { name: 'op', value: '2 (BOOTREPLY)' },
      {
        name: 'yiaddr',
        value: ADDRESSES.pc.ip,
        highlight: true,
        description: { en: 'The address given to the client', ja: 'クライアントに渡すアドレス' },
      },
      {
        name: 'chaddr',
        value: ADDRESSES.pc.mac,
        highlight: true,
        description: { en: 'Client’s MAC address', ja: 'クライアントの MAC アドレス' },
      },
      { name: 'Option 53 (Message type)', value: '5 (DHCPACK)' },
      { name: 'Option 51 (Lease time)', value: `${String(LEASE_S)} s` },
    ],
  }
}

// ---------- 判断の文言（翻訳しない） ----------

function describeCache(action: CacheAction, packet: ArpPacket): string {
  switch (action) {
    case 'updated':
      return `updated: ${packet.spa} → ${packet.sha}`
    case 'added':
      return `added: ${packet.spa} → ${packet.sha}`
    case 'refreshed':
      return `unchanged: ${packet.spa} → ${packet.sha}`
    case 'static':
      return 'ignored: static entry'
    case 'notTarget':
      return 'ignored: not the target'
  }
}

const forward = (port: number) => `forward: port ${String(port)}`

// ---------- 共通のステップ ----------

/** PC A からインターネットへのパケットが、ゲートウェイに届く */
function normalStep(id: string, title: LocalizedText, description: LocalizedText): Step {
  const frame = toServer(ADDRESSES.gateway.mac)
  return {
    id,
    title,
    description,
    events: [
      send(
        ipMessage(`${id}-pc`, PC, SWITCH, frame, {
          en: 'A packet for a server on the Internet, in a frame addressed to the gateway’s MAC address.',
          ja: 'インターネットのサーバー宛てのパケット。フレームはゲートウェイの MAC アドレス宛て。',
        }),
      ),
      send(
        ipMessage(`${id}-gw`, SWITCH, GATEWAY, frame, {
          en: 'The switch finds the gateway’s MAC address on port 2 and sends the frame there only.',
          ja: 'スイッチは、ゲートウェイの MAC アドレスをポート 2 に見つけ、そこにだけ送る。',
        }),
      ),
      set(SWITCH, DAI, forward(ADDRESSES.gateway.port)),
    ],
  }
}

/** 攻撃者が偽の応答を送る。DAI がなければ PC A に届き、あれば信頼しないポートで捨てる */
function forgeStep(dai: DaiConfig | null): Step {
  const fromAttacker = {
    port: ADDRESSES.attacker.port,
    sha: FORGED_REPLY.packet.sha,
    spa: FORGED_REPLY.packet.spa,
  }
  if (dai === null) {
    return {
      id: 'forge',
      title: {
        en: 'The attacker sends PC A a reply it never asked for',
        ja: '攻撃者が、PC A が頼んでいない応答を送る',
      },
      description: {
        en: `The attacker sends an ARP reply saying “${ADDRESSES.gateway.ip} is at ${ADDRESSES.attacker.mac}”, straight to PC A. The frame is honest about its own source (Eth Src and SHA are both the attacker’s MAC address), so the switch’s MAC address table stays correct and the switch simply delivers it. Only SPA lies. The attacker sends it to PC A alone: a broadcast would also reach the gateway, and a host that sees its own address claimed by another MAC address treats it as a conflict (RFC 5227 §2.4) and may defend its address with an announcement of its own.`,
        ja: `攻撃者は「${ADDRESSES.gateway.ip} は ${ADDRESSES.attacker.mac}」という ARP の応答を、PC A に直接送る。フレームは自分の送信元についてはうそをつかない（Eth Src も SHA も攻撃者の MAC アドレス）ので、スイッチの MAC アドレステーブルは正しいままで、スイッチはただ届ける。うそは SPA だけ。攻撃者は PC A にだけ送る。ブロードキャストにするとゲートウェイにも届き、自分のアドレスを別の MAC アドレスが名乗るのを見たホストは衝突として扱い（RFC 5227 §2.4）、自分の Announcement でアドレスを守ることがあるから。`,
      },
      events: [
        send(
          arpMessage('forge-attacker', ATTACKER, SWITCH, FORGED_REPLY, {
            en: 'A forged ARP reply. Nothing in it proves who sent it.',
            ja: '偽の ARP の応答。誰が送ったかを確かめられるものは、何も入っていない。',
          }),
        ),
        send(
          arpMessage('forge-pc', SWITCH, PC, FORGED_REPLY, {
            en: 'The switch delivers it to port 1 like any other frame. It does not look inside ARP.',
            ja: 'スイッチは、ほかのフレームと同じようにポート 1 に届ける。ARP の中は見ない。',
          }),
        ),
        set(SWITCH, DAI, `${forward(ADDRESSES.pc.port)} (no inspection)`),
      ],
    }
  }
  const result = inspectArp(fromAttacker, dai)
  return {
    id: 'forge',
    title: {
      en: 'The attacker tries the same forged reply: the switch drops it',
      ja: '攻撃者が同じ偽の応答を送る: スイッチが捨てる',
    },
    description: {
      en: `The same forged reply arrives on port 3, which is not trusted, so DAI inspects it before forwarding. The binding table has no row for the pair ${ADDRESSES.gateway.ip} ↔ ${ADDRESSES.attacker.mac}: the attacker’s MAC address is bound to ${ADDRESSES.attacker.ip}, the address its own DHCP lease gave it. The switch drops the reply and logs it. PC A never sees it.`,
      ja: `同じ偽の応答が、信頼しないポート 3 に届くので、DAI は転送する前に確かめる。束縛表には ${ADDRESSES.gateway.ip} ↔ ${ADDRESSES.attacker.mac} の組の行がない。攻撃者の MAC アドレスに結びついているのは、自分の DHCP のリースで得た ${ADDRESSES.attacker.ip}。スイッチは応答を捨てて記録する。PC A には届かない。`,
    },
    events: [
      send(
        arpMessage(
          'forge-attacker',
          ATTACKER,
          SWITCH,
          FORGED_REPLY,
          {
            en: 'The same forged ARP reply, byte for byte. Only the network’s defence is different.',
            ja: '1 バイトも違わない同じ偽の ARP の応答。違うのはネットワークの守りだけ。',
          },
          'rejected',
        ),
      ),
      set(SWITCH, DAI, describeDai(result, fromAttacker)),
    ],
  }
}

/** DAI があるときの、PC A の要求（ブロードキャスト）とゲートウェイの応答 */
function resolveSteps(dai: DaiConfig): Step[] {
  const fromPc = {
    port: ADDRESSES.pc.port,
    sha: ARP_REQUEST.packet.sha,
    spa: ARP_REQUEST.packet.spa,
  }
  const fromGateway = {
    port: ADDRESSES.gateway.port,
    sha: ARP_REPLY.packet.sha,
    spa: ARP_REPLY.packet.spa,
  }
  const gatewayCache = applyArpPacket([], ARP_REQUEST.packet, ADDRESSES.gateway.ip)
  const pcCache = applyArpPacket([], ARP_REPLY.packet, ADDRESSES.pc.ip)
  const byAcl = inspectArp(fromPc, dai)
  return [
    {
      id: 'arp-request',
      title: {
        en: 'PC A asks for the gateway: the switch checks and floods',
        ja: 'PC A がゲートウェイを尋ねる: スイッチが確かめてから流す',
      },
      description:
        byAcl.verdict === 'permit' && byAcl.by === 'acl'
          ? {
              en: 'This time the ARP ACL has a row for PC A’s pair, so DAI permits the request without looking at the binding table, and the switch floods it as usual. The gateway is the target and adds PC A to its cache; the attacker is not the target.',
              ja: '今度は ARP ACL に PC A の組の行があるので、DAI は束縛表を見ずに要求を許し、スイッチはいつものように流す。ゲートウェイは対象なので PC A をキャッシュに加え、攻撃者は対象ではない。',
            }
          : {
              en: 'PC A broadcasts an ARP request for the gateway. It arrives on port 1, which is not trusted, so DAI checks the sender pair (SPA and SHA) against the binding table. The pair is there, so the switch floods the request as usual. The gateway is the target and adds PC A to its cache; the attacker is not the target.',
              ja: 'PC A は、ゲートウェイを尋ねる ARP の要求をブロードキャストする。信頼しないポート 1 に届くので、DAI は送信元の組（SPA と SHA）を束縛表で確かめる。組はあるので、スイッチはいつものように要求を流す。ゲートウェイは対象なので PC A をキャッシュに加え、攻撃者は対象ではない。',
            },
      events: [
        send(
          arpMessage('req-pc', PC, SWITCH, ARP_REQUEST, {
            en: 'An ARP request, broadcast: “Who has 192.168.1.1? Tell 192.168.1.10.”',
            ja: 'ARP の要求。ブロードキャストで「192.168.1.1 を持っているのは誰？ 192.168.1.10 に教えて」。',
          }),
        ),
        set(SWITCH, DAI, describeDai(byAcl, fromPc)),
        send(
          arpMessage('req-gw', SWITCH, GATEWAY, ARP_REQUEST, {
            en: 'The permitted request, flooded to port 2.',
            ja: '許された要求を、ポート 2 に流す。',
          }),
        ),
        send(
          arpMessage(
            'req-attacker',
            SWITCH,
            ATTACKER,
            ARP_REQUEST,
            {
              en: 'Also flooded to port 3. The attacker is not the target.',
              ja: 'ポート 3 にも流す。攻撃者は対象ではない。',
            },
            'rejected',
          ),
        ),
        set(GATEWAY, CACHE, cacheTable(gatewayCache.cache)),
      ],
    },
    {
      id: 'arp-reply',
      title: {
        en: 'The gateway answers from a trusted port',
        ja: 'ゲートウェイが信頼するポートから答える',
      },
      description: {
        en: 'The gateway’s reply arrives on port 2, which is trusted, so DAI lets it through without checking. That is why the gateway needs no binding. PC A is the target and adds the gateway to its cache.',
        ja: 'ゲートウェイの応答は信頼するポート 2 に届くので、DAI は確かめずに通す。だからゲートウェイには束縛が要らない。PC A は対象なので、ゲートウェイをキャッシュに加える。',
      },
      events: [
        send(
          arpMessage('reply-gw', GATEWAY, SWITCH, ARP_REPLY, {
            en: 'The genuine reply: “192.168.1.1 is at 00:00:5e:00:53:01.”',
            ja: '本当の応答。「192.168.1.1 は 00:00:5e:00:53:01」。',
          }),
        ),
        set(SWITCH, DAI, describeDai(inspectArp(fromGateway, dai), fromGateway)),
        send(
          arpMessage('reply-pc', SWITCH, PC, ARP_REPLY, {
            en: 'Forwarded to port 1.',
            ja: 'ポート 1 に送る。',
          }),
        ),
        set(PC, CACHE, cacheTable(pcCache.cache)),
        set(PC, NEXT_HOP, nextHopOf(ADDRESSES.gateway.mac)),
        set(PC, DECISION, describeCache(pcCache.action, ARP_REPLY.packet)),
      ],
    },
  ]
}

/** 最後に、PC A のパケットが正しくゲートウェイに届く */
const intactStep = (description: LocalizedText): Step =>
  normalStep(
    'intact',
    {
      en: 'PC A’s traffic still goes to the gateway',
      ja: 'PC A の通信は、今もゲートウェイに届く',
    },
    description,
  )

// ---------- 状況ごと ----------

function poisonSteps(): Step[] {
  const poisoned = applyArpPacket([GATEWAY_ENTRY], FORGED_REPLY.packet, ADDRESSES.pc.ip)
  const hijacked = toServer(ADDRESSES.attacker.mac)
  const relayed = toServer(ADDRESSES.gateway.mac, ADDRESSES.attacker.mac)
  return [
    {
      id: 'setup',
      title: { en: 'An ordinary LAN', ja: 'ふつうの LAN' },
      description: {
        en: 'PC A got its address by DHCP and has already asked for the gateway’s MAC address with ARP (see the ARP theme). The attacker is an ordinary host on port 3 of the same switch. Nothing on this LAN checks ARP.',
        ja: 'PC A は DHCP でアドレスを得て、ゲートウェイの MAC アドレスも ARP ですでに調べてある（ARP のテーマを参照）。攻撃者は、同じスイッチのポート 3 につながったふつうのホスト。この LAN には、ARP を確かめるものが何もない。',
      },
      events: [
        set(PC, CACHE, cacheTable([GATEWAY_ENTRY])),
        set(PC, NEXT_HOP, nextHopOf(ADDRESSES.gateway.mac)),
        set(SWITCH, MAC_TABLE, FULL_MAC_TABLE),
        set(GATEWAY, CACHE, cacheTable([PC_ENTRY])),
      ],
    },
    normalStep(
      'normal',
      {
        en: 'Packets to the Internet go to the gateway',
        ja: 'インターネットへのパケットはゲートウェイへ',
      },
      {
        en: 'PC A sends a packet to a server on the Internet. The IP destination is the server, and the frame is addressed to the MAC address its ARP cache has for the gateway.',
        ja: 'PC A がインターネットのサーバーにパケットを送る。IP の宛先はサーバーで、フレームは、ARP キャッシュにあるゲートウェイの MAC アドレス宛て。',
      },
    ),
    forgeStep(null),
    {
      id: 'poisoned',
      title: { en: 'PC A overwrites its cache', ja: 'PC A がキャッシュを書き換える' },
      description: {
        en: `RFC 826 says: if the sender’s IP address is already in the table, replace its MAC address with the new one, before even looking at whether the packet is a request or a reply. Nothing asks whether PC A sent a request. So PC A now maps ${ADDRESSES.gateway.ip} to the attacker. Operating systems add their own rules (Linux, for example, does not create new entries from unsolicited ARP by default), but they update an entry that already exists, and PC A always has one for its gateway.`,
        ja: `RFC 826 は、送信元の IP アドレスがもう表にあれば、要求か応答かを見る前に、その MAC アドレスを新しいものに書き換える、とする。PC A が要求を送ったかは問わない。そのため PC A は、${ADDRESSES.gateway.ip} を攻撃者に結びつける。OS は独自の規則を足す（たとえば Linux は、既定では頼んでいない ARP で新しい行を作らない）が、すでにある行は書き換える。そして PC A には、ゲートウェイの行がいつもある。`,
      },
      events: [
        set(PC, CACHE, cacheTable(poisoned.cache)),
        set(PC, NEXT_HOP, nextHopOf(ADDRESSES.attacker.mac)),
        set(PC, DECISION, describeCache(poisoned.action, FORGED_REPLY.packet)),
      ],
    },
    {
      id: 'hijacked',
      title: { en: 'PC A’s next packet goes to the attacker', ja: 'PC A の次のパケットは攻撃者へ' },
      description: {
        en: 'PC A sends the next packet exactly as before, and the IP header still says the server. Only the frame’s destination MAC address has changed, so the switch correctly delivers it to port 3. PC A notices nothing.',
        ja: 'PC A は、前とまったく同じように次のパケットを送り、IP のヘッダーの宛先もサーバーのまま。フレームの宛先の MAC アドレスだけが変わったので、スイッチは正しくポート 3 に届ける。PC A は何も気づかない。',
      },
      events: [
        send(
          ipMessage('hijacked-pc', PC, SWITCH, hijacked, {
            en: 'The same IP packet, now in a frame addressed to the attacker’s MAC address.',
            ja: '同じ IP パケット。フレームは攻撃者の MAC アドレス宛てになった。',
          }),
        ),
        send(
          ipMessage('hijacked-attacker', SWITCH, ATTACKER, hijacked, {
            en: 'The switch delivers it to the MAC address the frame asks for.',
            ja: 'スイッチは、フレームが求める MAC アドレスに届ける。',
          }),
        ),
        set(SWITCH, DAI, forward(ADDRESSES.attacker.port)),
        set(ATTACKER, CAPTURED, capturedTable([[PACKET_toServer, '-']])),
      ],
    },
    {
      id: 'relay',
      title: {
        en: 'The attacker passes it on: a man in the middle',
        ja: '攻撃者が先へ渡す: 中間者',
      },
      description: {
        en: 'The attacker forwards the packet to the real gateway, so nothing breaks and nobody complains. It can read everything that is not encrypted (plain DNS, plain HTTP), sees where PC A connects even under TLS, and could change unencrypted data. Encryption and authentication at higher layers (TLS with HSTS, DNSSEC) are what keep such an attacker from reading or changing the content.',
        ja: '攻撃者はパケットを本当のゲートウェイに渡すので、何も壊れず、誰も困らない。暗号化されていないもの（ふつうの DNS、ふつうの HTTP）はすべて読め、TLS でも PC A がどこにつなぐかは見え、暗号化されていないデータなら書き換えられる。中身を読ませず、書き換えさせないのは、上の層の暗号化と認証（HSTS 付きの TLS、DNSSEC）。',
      },
      events: [
        send(
          ipMessage('relay-attacker', ATTACKER, SWITCH, relayed, {
            en: 'The attacker sends the packet on, now in a frame from its MAC address to the gateway’s.',
            ja: '攻撃者はパケットを先へ送る。フレームは攻撃者の MAC アドレスからゲートウェイの MAC アドレス宛て。',
          }),
        ),
        send(
          ipMessage('relay-gw', SWITCH, GATEWAY, relayed, {
            en: 'Delivered to the gateway on port 2.',
            ja: 'ポート 2 のゲートウェイに届く。',
          }),
        ),
        set(SWITCH, DAI, forward(ADDRESSES.gateway.port)),
        set(
          ATTACKER,
          CAPTURED,
          capturedTable([[PACKET_toServer, `gateway (${ADDRESSES.gateway.mac})`]]),
        ),
      ],
    },
    {
      id: 'reply',
      title: {
        en: 'The answer comes back directly: only one direction is hijacked',
        ja: '答えは直接戻る: 奪われたのは片方の向きだけ',
      },
      description: {
        en: `The gateway’s cache was not touched, so the server’s answer goes straight to PC A. To see both directions, the attacker also sends the gateway a forged reply claiming ${ADDRESSES.pc.ip}. And it has to keep repeating the lies: entries expire and are checked again, and a genuine ARP packet from the gateway would repair PC A’s cache. That stream of conflicting ARP packets is what monitoring tools look for.`,
        ja: `ゲートウェイのキャッシュは変わっていないので、サーバーからの答えは PC A に直接届く。両方の向きを見るには、攻撃者はゲートウェイにも ${ADDRESSES.pc.ip} を名乗る偽の応答を送る。そして、うそを繰り返し続けなければならない。行は期限が来ると確かめ直され、ゲートウェイからの本当の ARP のパケットが届けば PC A のキャッシュは直る。監視の道具が探すのは、この食い違う ARP のパケットの流れ。`,
      },
      events: [
        send(
          ipMessage('reply-gw', GATEWAY, SWITCH, FROM_SERVER, {
            en: 'The server’s answer, in a frame from the gateway to PC A’s real MAC address.',
            ja: 'サーバーからの答え。フレームはゲートウェイから PC A の本当の MAC アドレス宛て。',
          }),
        ),
        send(
          ipMessage('reply-pc', SWITCH, PC, FROM_SERVER, {
            en: 'Delivered to PC A on port 1, bypassing the attacker.',
            ja: '攻撃者を通らず、ポート 1 の PC A に届く。',
          }),
        ),
        set(SWITCH, DAI, forward(ADDRESSES.pc.port)),
      ],
    },
  ]
}

function daiSetup(description: LocalizedText, bindings: readonly Binding[]): Step {
  return {
    id: 'setup',
    title: {
      en: 'DHCP snooping and DAI are on',
      ja: 'DHCP スヌーピングと DAI が有効',
    },
    description,
    events: [
      set(SWITCH, MAC_TABLE, FULL_MAC_TABLE),
      set(SWITCH, TRUSTED, TRUSTED_PORT),
      set(SWITCH, BINDINGS, bindingTable(bindings)),
    ],
  }
}

function daiSteps(): Step[] {
  const trustedPorts = [ADDRESSES.gateway.port]
  const ack = { yiaddr: ADDRESSES.pc.ip, chaddr: ADDRESSES.pc.mac, leaseS: LEASE_S }
  const pcBinding = bindingFromAck(ack, ADDRESSES.gateway.port, ADDRESSES.pc.port, trustedPorts)
  const bindings = pcBinding === null ? [ATTACKER_BINDING] : [ATTACKER_BINDING, pcBinding]
  const config: DaiConfig = { trustedPorts, bindings, acl: [] }
  return [
    daiSetup(
      {
        en: 'The same LAN, but the switch now runs DHCP snooping and Dynamic ARP Inspection (DAI), features of switches such as Cisco’s. Port 2, where the gateway and DHCP server is, is trusted; the others are not. The attacker got its own address by DHCP too, so the binding table already has a row for it. PC A is just starting up.',
        ja: '同じ LAN だが、スイッチは DHCP スヌーピングと Dynamic ARP Inspection（DAI）を使う。Cisco などのスイッチの機能。ゲートウェイと DHCP サーバーのあるポート 2 は信頼し、ほかは信頼しない。攻撃者も DHCP で自分のアドレスを得たので、束縛表にはもうその行がある。PC A は起動したところ。',
      },
      [ATTACKER_BINDING],
    ),
    {
      id: 'dhcp-ack',
      title: {
        en: 'The switch records PC A’s address from the DHCPACK',
        ja: 'スイッチが DHCPACK から PC A のアドレスを記録する',
      },
      description: {
        en: 'PC A gets its address by DHCP (the DISCOVER, OFFER and REQUEST are not drawn; see the DHCP theme). The server’s DHCPACK arrives on trusted port 2, so the switch records the binding: 192.168.1.10 belongs to 00:00:5e:00:53:0a on port 1, for the length of the lease. A DHCPACK from an untrusted port would be dropped, which also stops a fake DHCP server. RFC 7513 (SAVI for DHCP) states the same rule for the IETF’s version of this idea.',
        ja: 'PC A は DHCP でアドレスを得る（DISCOVER、OFFER、REQUEST は描かない。DHCP のテーマを参照）。サーバーの DHCPACK は信頼するポート 2 に届くので、スイッチは束縛を記録する。192.168.1.10 は、ポート 1 の 00:00:5e:00:53:0a のもので、リース期間のあいだ有効。信頼しないポートからの DHCPACK は捨てるので、偽の DHCP サーバーも止まる。RFC 7513（SAVI for DHCP）は、IETF の同じ考え方に同じ規則を置く。',
      },
      events: [
        send(
          dhcpAckMessage('ack-gw', GATEWAY, SWITCH, {
            en: 'The DHCP server’s DHCPACK: yiaddr and chaddr are what the switch records.',
            ja: 'DHCP サーバーの DHCPACK。スイッチが記録するのは yiaddr と chaddr。',
          }),
        ),
        set(SWITCH, BINDINGS, bindingTable(bindings)),
        set(
          SWITCH,
          DAI,
          `bound: ${ack.yiaddr} ↔ ${ack.chaddr} (port ${String(ADDRESSES.pc.port)})`,
        ),
        send(
          dhcpAckMessage('ack-pc', SWITCH, PC, {
            en: 'Forwarded to PC A on port 1.',
            ja: 'ポート 1 の PC A に送る。',
          }),
        ),
      ],
    },
    ...resolveSteps(config),
    forgeStep(config),
    intactStep({
      en: 'PC A’s cache still maps 192.168.1.1 to the gateway’s MAC address, so its packets go where they should. DAI did not have to recognise an attack: it only let through ARP packets whose sender pair it could vouch for.',
      ja: 'PC A のキャッシュは今も 192.168.1.1 をゲートウェイの MAC アドレスに結びつけているので、パケットは正しい先に届く。DAI は攻撃を見分けたのではない。送信元の組を保証できる ARP のパケットだけを通した。',
    }),
  ]
}

function arpAclSteps(): Step[] {
  const trustedPorts = [ADDRESSES.gateway.port]
  const withoutAcl: DaiConfig = { trustedPorts, bindings: [ATTACKER_BINDING], acl: [] }
  const aclEntry: AclEntry = { action: 'permit', ip: ADDRESSES.pc.ip, mac: ADDRESSES.pc.mac }
  const withAcl: DaiConfig = { ...withoutAcl, acl: [aclEntry] }
  const fromPc = {
    port: ADDRESSES.pc.port,
    sha: ARP_REQUEST.packet.sha,
    spa: ARP_REQUEST.packet.spa,
  }
  return [
    daiSetup(
      {
        en: 'DAI is on as before, but PC A’s address was configured by hand, as for a printer or a server. It never used DHCP, so the binding table has no row for it.',
        ja: '前と同じく DAI が有効だが、PC A のアドレスは、プリンターやサーバーのように手で設定した。DHCP を使っていないので、束縛表に PC A の行はない。',
      },
      [ATTACKER_BINDING],
    ),
    {
      id: 'arp-dropped',
      title: {
        en: 'PC A’s own request is dropped',
        ja: 'PC A 自身の要求が捨てられる',
      },
      description: {
        en: 'PC A asks for the gateway, honestly. But DAI cannot find the pair in the binding table, and to DAI an unknown pair looks exactly like a forged one. The request is dropped, PC A retries and fails the same way (see the ARP theme), and it cannot reach anything beyond the LAN. This is the most common surprise when DAI is turned on.',
        ja: 'PC A は正直にゲートウェイを尋ねる。しかし DAI は束縛表にその組を見つけられず、DAI にとって知らない組は偽物とまったく同じに見える。要求は捨てられ、PC A は送り直しても同じように失敗し（ARP のテーマを参照）、LAN の外に届かない。DAI を有効にしたときに、いちばんよく起きる驚き。',
      },
      events: [
        send(
          arpMessage(
            'dropped-pc',
            PC,
            SWITCH,
            ARP_REQUEST,
            {
              en: 'A genuine ARP request from a host with a static address.',
              ja: '静的なアドレスのホストからの、本当の ARP の要求。',
            },
            'rejected',
          ),
        ),
        set(SWITCH, DAI, describeDai(inspectArp(fromPc, withoutAcl), fromPc)),
      ],
    },
    {
      id: 'acl',
      title: {
        en: 'The administrator adds an ARP ACL',
        ja: '管理者が ARP ACL を足す',
      },
      description: {
        en: 'Hosts with static addresses are listed by hand in an ARP ACL on the switch. DAI checks the ACL before the binding table. The ACL is a written promise from the administrator, so it must be kept up to date when the host changes.',
        ja: '静的なアドレスのホストは、スイッチの ARP ACL に手で書く。DAI は束縛表より先に ACL を見る。ACL は管理者が書いた約束なので、ホストが変わったら書き直す必要がある。',
      },
      events: [set(SWITCH, ACL, `permit ${aclEntry.ip} ↔ ${aclEntry.mac}`)],
    },
    ...resolveSteps(withAcl),
    forgeStep(withAcl),
  ]
}

function staticEntrySteps(): Step[] {
  const fixed: ArpEntry = { ...GATEWAY_ENTRY, type: 'static' }
  const result = applyArpPacket([fixed], FORGED_REPLY.packet, ADDRESSES.pc.ip)
  return [
    {
      id: 'setup',
      title: {
        en: 'PC A has a static entry for the gateway',
        ja: 'PC A にはゲートウェイの静的なエントリーがある',
      },
      description: {
        en: 'The switch checks nothing, as in the first situation. Instead, an administrator wrote the gateway’s MAC address into PC A’s ARP cache as a static entry. Static entries are a feature of the operating system, not of RFC 826.',
        ja: '最初の状況と同じく、スイッチは何も確かめない。代わりに、管理者が PC A の ARP キャッシュに、ゲートウェイの MAC アドレスを静的なエントリーとして書いた。静的なエントリーは OS の機能で、RFC 826 にはない。',
      },
      events: [
        set(PC, CACHE, cacheTable([fixed])),
        set(PC, NEXT_HOP, nextHopOf(ADDRESSES.gateway.mac)),
        set(SWITCH, MAC_TABLE, FULL_MAC_TABLE),
        set(GATEWAY, CACHE, cacheTable([PC_ENTRY])),
      ],
    },
    forgeStep(null),
    {
      id: 'ignored',
      title: { en: 'PC A ignores it', ja: 'PC A は無視する' },
      description: {
        en: 'The forged reply arrives, but ARP never overwrites a static entry, so PC A’s cache keeps the gateway’s real MAC address.',
        ja: '偽の応答は届くが、ARP は静的なエントリーを書き換えないので、PC A のキャッシュはゲートウェイの本当の MAC アドレスのまま。',
      },
      events: [
        set(PC, CACHE, cacheTable(result.cache)),
        set(PC, DECISION, describeCache(result.action, FORGED_REPLY.packet)),
      ],
    },
    intactStep({
      en: 'PC A’s packets reach the gateway. But the protection is narrow: it covers only this one entry on this one host. The gateway’s cache can still be poisoned (the other direction), every entry must be changed by hand when a network card is replaced, and it does not scale beyond a few critical machines.',
      ja: 'PC A のパケットはゲートウェイに届く。しかし守りは狭い。守れるのは、このホストのこの 1 行だけ。ゲートウェイのキャッシュはまだだませる（逆の向き）し、ネットワークカードを取り替えたらすべての行を手で直す必要があり、大事な数台より多くには広げられない。',
    }),
  ]
}

function buildSteps(options: ArpSpoofingOptions): readonly Step[] {
  const builders: Record<Situation, () => Step[]> = {
    poison: poisonSteps,
    dai: daiSteps,
    arpAcl: arpAclSteps,
    staticEntry: staticEntrySteps,
  }
  return builders[options.situation]()
}

export const arpSpoofingScenario: Scenario<ArpSpoofingOptions> = {
  id: 'arp-spoofing',
  title: {
    en: 'ARP spoofing and Dynamic ARP Inspection',
    ja: 'ARP スプーフィングと Dynamic ARP Inspection',
  },
  actors,
  optionDefs: {
    situation: {
      kind: 'select',
      label: { en: 'Situation', ja: '状況' },
      choices: [
        {
          value: 'poison',
          label: { en: 'The attack: a forged ARP reply', ja: '攻撃: 偽の ARP の応答' },
        },
        {
          value: 'dai',
          label: { en: 'DAI with DHCP snooping', ja: 'DAI と DHCP スヌーピング' },
        },
        {
          value: 'arpAcl',
          label: {
            en: 'DAI, but PC A has a static IP address',
            ja: 'DAI で、PC A の IP アドレスは静的',
          },
        },
        {
          value: 'staticEntry',
          label: { en: 'A static ARP entry on PC A', ja: 'PC A の静的な ARP エントリー' },
        },
      ],
      defaultValue: 'poison',
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
