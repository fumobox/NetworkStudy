/**
 * DHCP: IP アドレスをもらう
 *
 * 根拠:
 * - RFC 2131 §2（メッセージの形式。op、htype、hlen、xid、secs、flags、ciaddr、yiaddr、siaddr、giaddr、chaddr）
 * - RFC 2131 §3.1（DISCOVER → OFFER → REQUEST → ACK）、§3.2（前に使ったアドレスをもう一度使う: INIT-REBOOT）
 * - RFC 2131 §4.1（クライアントはポート 68、サーバーは 67。アドレスがない間は 0.0.0.0 から 255.255.255.255 に送る。
 *   BROADCAST ビット、xid、再送の間隔 4 秒から倍々に 64 秒まで。giaddr が 0 なら NAK はブロードキャスト。ciaddr があれば ciaddr にユニキャスト）
 * - RFC 2131 §4.3.1（OFFER / ACK に入れる値）、§4.3.2（状態ごとの REQUEST の中身。RENEWING ではオプション 50・54 を入れてはならない）
 * - RFC 2131 §4.4（クライアントの状態の遷移）、§4.4.1（使う前にアドレスを確かめる）、§4.4.5（T1 = リースの 0.5、T2 = 0.875）
 * - RFC 2132 §3.3（1: サブネットマスク）、§3.5（3: ルーター）、§3.8（6: DNS サーバー）、§9.1（50: 要求するアドレス）、
 *   §9.2（51: リース期間）、§9.6（53: メッセージの種類）、§9.7（54: サーバーの識別子）、§9.8（55: 欲しいパラメーターの一覧）、
 *   §9.11（58: T1）、§9.12（59: T2）、§9.14（61: クライアントの識別子）
 *
 * 学習用の単純化: サーバーは 1 台（実際は複数から OFFER が届くことがある）。リレーエージェント（giaddr）はない。
 * リース期間は例（家庭のルーターは 24 時間などが多い）。DECLINE / RELEASE / INFORM は扱わない
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
  flow: z.enum(['init', 'renew', 'reboot']).catch('init'),
  serverReply: z.enum(['ack', 'nak']).catch('ack'),
  discoverLost: z.stringbool().catch(false),
})
export type DhcpOptions = z.infer<typeof optionsSchema>

const PC: ActorId = 'pc'
const SERVER: ActorId = 'dhcp'
const STATE: StateKey = 'state'
const ADDRESS: StateKey = 'address'
const CONFIG: StateKey = 'config'
const LEASES: StateKey = 'leases'
const CONFIG_COLUMNS = ['Option', 'Value'] as const
const LEASE_COLUMNS = ['IP', 'chaddr', 'State', 'Expires'] as const

export const VALUES = {
  xid: '0x1234abcd',
  pcMac: '00:00:5e:00:53:0a',
  pc2Mac: '00:00:5e:00:53:14',
  serverMac: '00:00:5e:00:53:01',
  server: '192.168.1.1',
  offered: '192.168.1.10',
  mask: '255.255.255.0',
  dns: '198.51.100.53',
  leaseS: 3600,
  t1S: 1800,
  t2S: 3150,
} as const
const BROADCAST_MAC = 'ff:ff:ff:ff:ff:ff'
const BROADCAST_IP = '255.255.255.255'
const ZERO = '0.0.0.0'
/** RFC 2131 §4.1 の最初の再送までの時間（4 秒 ±1 秒） */
const FIRST_RETRANSMIT_MS = 4000

const table = (columns: readonly string[], rows: readonly (readonly string[])[]): StateTable => ({
  columns,
  rows,
})

const actors: readonly Actor[] = [
  {
    id: PC,
    kind: 'client',
    name: { en: 'Your PC (no address yet)', ja: 'PC（まだアドレスがない）' },
    shortName: { en: 'PC', ja: 'PC' },
    stateSlots: [
      { key: STATE, label: { en: 'DHCP state', ja: 'DHCP の状態' }, initial: 'INIT' },
      { key: ADDRESS, label: { en: 'IP address', ja: 'IP アドレス' }, initial: '-' },
      {
        key: CONFIG,
        label: { en: 'Network settings', ja: 'ネットワークの設定' },
        initial: table(CONFIG_COLUMNS, []),
      },
    ],
  },
  {
    id: SERVER,
    kind: 'router',
    name: { en: 'Router (DHCP server, 192.168.1.1)', ja: 'ルーター（DHCP サーバー、192.168.1.1）' },
    shortName: { en: 'DHCP server', ja: 'DHCP サーバー' },
    stateSlots: [
      {
        key: LEASES,
        label: { en: 'Leases', ja: 'リース' },
        initial: table(LEASE_COLUMNS, []),
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

const MESSAGE_TYPES = {
  DHCPDISCOVER: '1',
  DHCPOFFER: '2',
  DHCPREQUEST: '3',
  DHCPACK: '5',
  DHCPNAK: '6',
} as const
type MessageType = keyof typeof MESSAGE_TYPES

/** オプション（RFC 2132）。[番号, 名前, 値] */
type DhcpOption = readonly [code: number, name: string, value: string]
const option = (code: number, name: string, value: string): DhcpOption => [code, name, value]
const OPT = {
  type: (type: MessageType): DhcpOption =>
    option(53, 'Message type', `${MESSAGE_TYPES[type]} (${type})`),
  clientId: option(61, 'Client identifier', `01:${VALUES.pcMac}`),
  paramList: option(55, 'Parameter request list', '1, 3, 6'),
  requested: option(50, 'Requested IP address', VALUES.offered),
  serverId: option(54, 'Server identifier', VALUES.server),
  lease: option(51, 'Lease time', `${String(VALUES.leaseS)} s`),
  t1: option(58, 'Renewal time (T1)', `${String(VALUES.t1S)} s`),
  t2: option(59, 'Rebinding time (T2)', `${String(VALUES.t2S)} s`),
  mask: option(1, 'Subnet mask', VALUES.mask),
  router: option(3, 'Router', VALUES.server),
  dns: option(6, 'Domain name server', VALUES.dns),
} as const
const SERVER_PARAMETERS = [OPT.serverId, OPT.lease, OPT.t1, OPT.t2, OPT.mask, OPT.router, OPT.dns]

const OPTION_TEXT: Readonly<Record<number, LocalizedText>> = {
  53: { en: 'Which DHCP message this is', ja: 'DHCP のどのメッセージか' },
  61: {
    en: 'Identifies the client (type 1 = Ethernet, then its MAC address)',
    ja: 'クライアントを見分ける値（1 = Ethernet、続けて MAC アドレス）',
  },
  55: {
    en: 'Settings the client wants: 1 subnet mask, 3 router, 6 DNS server',
    ja: 'クライアントが欲しい設定。1 はサブネットマスク、3 はルーター、6 は DNS サーバー',
  },
  50: { en: 'The address the client asks for', ja: 'クライアントが求めるアドレス' },
  54: {
    en: 'Which server this is about (the server’s own address)',
    ja: 'どのサーバーとのやり取りか（サーバー自身のアドレス）',
  },
  51: { en: 'How long the address may be used', ja: 'アドレスを使ってよい期間' },
  58: {
    en: 'When to start renewing (half of the lease)',
    ja: '更新を始める時刻（リースの半分）',
  },
  59: {
    en: 'When to ask any server if renewal fails (7/8 of the lease)',
    ja: '更新できないとき、どのサーバーにでも尋ね始める時刻（リースの 8 分の 7）',
  },
  1: { en: 'Subnet mask to use', ja: '使うサブネットマスク' },
  3: { en: 'Default gateway', ja: 'デフォルトゲートウェイ' },
  6: { en: 'DNS resolver', ja: 'DNS のリゾルバー' },
}

interface DhcpMessageSpec {
  readonly id: string
  readonly type: MessageType
  readonly fromClient: boolean
  readonly ethDst: string
  readonly ipSrc: string
  readonly ipDst: string
  readonly ciaddr: string
  readonly yiaddr: string
  readonly broadcastFlag: boolean
  readonly secs?: number
  readonly options: readonly DhcpOption[]
  readonly status?: Message['status']
  readonly retransmitOf?: string
  readonly description: LocalizedText
}

function dhcpMessage(spec: DhcpMessageSpec): Message {
  const [srcPort, dstPort] = spec.fromClient ? ['68', '67'] : ['67', '68']
  const fields: PacketField[] = [
    {
      name: 'Eth Dst',
      value: spec.ethDst,
      highlight: spec.ethDst === BROADCAST_MAC,
      description: { en: 'Ethernet destination', ja: 'Ethernet の宛先' },
    },
    {
      name: 'IP Src → Dst',
      value: `${spec.ipSrc} → ${spec.ipDst}`,
      highlight: true,
      description:
        spec.ipSrc === ZERO
          ? {
              en: 'The client has no address yet, so it sends from 0.0.0.0 to everyone (255.255.255.255)',
              ja: 'クライアントにはまだアドレスがないので、0.0.0.0 から全員（255.255.255.255）に送る',
            }
          : { en: 'IP source and destination', ja: 'IP の送信元と宛先' },
    },
    {
      name: 'UDP port',
      value: `${srcPort} → ${dstPort}`,
      description: {
        en: 'Clients use port 68, servers port 67',
        ja: 'クライアントはポート 68、サーバーは 67',
      },
    },
    {
      name: 'op',
      value: spec.fromClient ? '1 (BOOTREQUEST)' : '2 (BOOTREPLY)',
      description: {
        en: '1 from a client, 2 from a server',
        ja: 'クライアントからは 1、サーバーからは 2',
      },
    },
    {
      name: 'xid',
      value: VALUES.xid,
      description: {
        en: 'Transaction ID chosen by the client; every message of this exchange carries the same value',
        ja: 'クライアントが選ぶやり取りの番号。このやり取りのメッセージはすべて同じ値',
      },
    },
    {
      name: 'secs',
      value: String(spec.secs ?? 0),
      description: {
        en: 'Seconds since the client started trying',
        ja: 'クライアントが始めてからの秒数',
      },
    },
    {
      name: 'flags',
      value: spec.broadcastFlag ? '0x8000 (BROADCAST)' : '0x0000',
      description: {
        en: 'BROADCAST bit: “I cannot receive unicast yet, please broadcast your reply”',
        ja: 'BROADCAST ビット。「まだユニキャストを受け取れないので、応答はブロードキャストで」',
      },
    },
    {
      name: 'ciaddr',
      value: spec.ciaddr,
      description: {
        en: 'Client’s current address (only when it already has one)',
        ja: 'クライアントが今使っているアドレス（すでに持っているときだけ）',
      },
    },
    {
      name: 'yiaddr',
      value: spec.yiaddr,
      highlight: spec.yiaddr !== ZERO,
      description: {
        en: '“Your” address: offered or assigned by the server',
        ja: 'サーバーが提示・割り当てる「あなたの」アドレス',
      },
    },
    {
      name: 'chaddr',
      value: VALUES.pcMac,
      description: { en: 'Client’s MAC address', ja: 'クライアントの MAC アドレス' },
    },
    ...spec.options.map(([code, name, value]): PacketField => ({
      name: `Option ${String(code)} (${name})`,
      value,
      highlight: code === 53,
      ...(OPTION_TEXT[code] === undefined ? {} : { description: OPTION_TEXT[code] }),
    })),
  ]
  return {
    id: spec.id,
    from: spec.fromClient ? PC : SERVER,
    to: spec.fromClient ? SERVER : PC,
    label: spec.type,
    status: spec.status ?? 'delivered',
    ...(spec.retransmitOf === undefined ? {} : { retransmitOf: spec.retransmitOf }),
    description: spec.description,
    fields,
  }
}

const leaseRow = (state: string, mac: string = VALUES.pcMac): readonly string[] => [
  VALUES.offered,
  mac,
  state,
  state === 'BOUND' ? `in ${String(VALUES.leaseS)} s` : '-',
]

const CONFIGURED = table(CONFIG_COLUMNS, [
  ['Subnet mask', VALUES.mask],
  ['Router', VALUES.server],
  ['DNS', VALUES.dns],
  ['Lease', `${String(VALUES.leaseS)} s (T1 ${String(VALUES.t1S)} s, T2 ${String(VALUES.t2S)} s)`],
])

function boundEvents(): StepEvent[] {
  return [
    set(PC, STATE, 'BOUND'),
    set(PC, ADDRESS, `${VALUES.offered}/24`),
    set(PC, CONFIG, CONFIGURED),
  ]
}

/** ACK（broadcast はクライアントがまだアドレスを使えないとき） */
function ackStep(broadcast: boolean): Step {
  return {
    id: 'ack',
    title: { en: 'The server confirms with DHCPACK', ja: 'サーバーが DHCPACK で確定する' },
    description: {
      en: `The server confirms the lease for ${String(VALUES.leaseS)} seconds and sends all the settings again.${broadcast ? '' : ' The client already uses the address, so the reply is sent to it directly (unicast).'}`,
      ja: `サーバーは ${String(VALUES.leaseS)} 秒のリースを確定し、設定をもう一度すべて送る。${broadcast ? '' : 'クライアントはすでにアドレスを使っているので、応答はクライアントに直接送る（ユニキャスト）。'}`,
    },
    events: [
      set(SERVER, LEASES, table(LEASE_COLUMNS, [leaseRow('BOUND')])),
      send(
        dhcpMessage({
          id: 'ack',
          type: 'DHCPACK',
          fromClient: false,
          ethDst: broadcast ? BROADCAST_MAC : VALUES.pcMac,
          ipSrc: VALUES.server,
          ipDst: broadcast ? BROADCAST_IP : VALUES.offered,
          ciaddr: broadcast ? ZERO : VALUES.offered,
          yiaddr: VALUES.offered,
          broadcastFlag: broadcast,
          options: [OPT.type('DHCPACK'), ...SERVER_PARAMETERS],
          description: {
            en: 'The server confirms the address and the settings.',
            ja: 'サーバーがアドレスと設定を確定する。',
          },
        }),
      ),
    ],
  }
}

function nakSteps(
  reason: LocalizedText,
  broadcastFlag: boolean,
  ciaddr: string,
  leases: StateTable,
): Step[] {
  return [
    {
      id: 'nak',
      title: { en: 'The server refuses with DHCPNAK', ja: 'サーバーが DHCPNAK で断る' },
      description: {
        en: `${reason.en} The server answers with DHCPNAK. Without a relay agent, a NAK is always broadcast.`,
        ja: `${reason.ja}サーバーは DHCPNAK で答える。リレーエージェントがなければ、NAK は必ずブロードキャストで送る。`,
      },
      events: [
        set(SERVER, LEASES, leases),
        send(
          dhcpMessage({
            id: 'nak',
            type: 'DHCPNAK',
            fromClient: false,
            ethDst: BROADCAST_MAC,
            ipSrc: VALUES.server,
            ipDst: BROADCAST_IP,
            ciaddr: ZERO,
            yiaddr: ZERO,
            broadcastFlag,
            options: [OPT.type('DHCPNAK'), OPT.serverId],
            description: {
              en: 'The server refuses the request.',
              ja: 'サーバーが要求を断る。',
            },
          }),
        ),
      ],
    },
    {
      id: 'restart',
      title: { en: 'The client starts over', ja: 'クライアントは最初からやり直す' },
      description: {
        en: `The client must stop using ${ciaddr === ZERO ? 'the address' : ciaddr} at once, goes back to INIT, and starts again with DHCPDISCOVER.`,
        ja: `クライアントは ${ciaddr === ZERO ? 'そのアドレス' : ciaddr} をすぐに使うのをやめ、INIT に戻って DHCPDISCOVER からやり直す。`,
      },
      events: [
        set(PC, STATE, 'INIT'),
        set(PC, ADDRESS, '-'),
        set(PC, CONFIG, table(CONFIG_COLUMNS, [])),
      ],
    },
  ]
}

const TAKEN_BY_PC2 = table(LEASE_COLUMNS, [leaseRow('BOUND', VALUES.pc2Mac)])

function initFlow(options: DhcpOptions): Step[] {
  const discover = (id: string, status: Message['status'], secs: number, retransmitOf?: string) =>
    dhcpMessage({
      id,
      type: 'DHCPDISCOVER',
      fromClient: true,
      ethDst: BROADCAST_MAC,
      ipSrc: ZERO,
      ipDst: BROADCAST_IP,
      ciaddr: ZERO,
      yiaddr: ZERO,
      broadcastFlag: true,
      secs,
      status,
      ...(retransmitOf === undefined ? {} : { retransmitOf }),
      options: [OPT.type('DHCPDISCOVER'), OPT.clientId, OPT.paramList],
      description: {
        en: '“Is there a DHCP server? I need an address.”',
        ja: '「DHCP サーバーはいますか？ アドレスが欲しい」',
      },
    })

  const steps: Step[] = [
    {
      id: 'init',
      title: { en: 'The PC has no address yet', ja: 'PC にはまだアドレスがない' },
      description: {
        en: 'The PC has just connected to the network. It has no IP address and does not know the server’s address, so it can only send to everyone: from 0.0.0.0 to the broadcast address 255.255.255.255.',
        ja: 'PC はネットワークにつながったばかり。IP アドレスがなく、サーバーのアドレスもわからないので、全員に送るしかない。送信元 0.0.0.0 から、ブロードキャストアドレス 255.255.255.255 へ。',
      },
      events: [set(PC, STATE, 'INIT')],
    },
    {
      id: 'discover',
      title: options.discoverLost
        ? {
            en: 'The PC sends DHCPDISCOVER, but it is lost',
            ja: 'PC が DHCPDISCOVER を送るが、失われる',
          }
        : { en: 'The PC broadcasts DHCPDISCOVER', ja: 'PC が DHCPDISCOVER をブロードキャストする' },
      description: {
        en: `The PC picks a transaction ID (xid ${VALUES.xid}) and asks for the settings it needs (option 55). It moves to SELECTING and waits for offers.${options.discoverLost ? ' The message is lost on the way.' : ''}`,
        ja: `PC はやり取りの番号（xid ${VALUES.xid}）を決め、欲しい設定（オプション 55）を添えて尋ねる。SELECTING に移り、提示を待つ。${options.discoverLost ? 'このメッセージは途中で失われる。' : ''}`,
      },
      events: [
        set(PC, STATE, 'SELECTING'),
        send(discover('discover', options.discoverLost ? 'lost' : 'delivered', 0)),
      ],
    },
  ]
  if (options.discoverLost) {
    steps.push({
      id: 'discover-rtx',
      title: { en: 'No offer: the PC tries again', ja: '提示が来ない: PC がもう一度送る' },
      description: {
        en: 'No DHCPOFFER arrived within about 4 seconds, so the PC sends DHCPDISCOVER again with the same xid. The wait doubles on each retry (8, 16 … up to 64 seconds).',
        ja: '約 4 秒以内に DHCPOFFER が来なかったので、PC は同じ xid で DHCPDISCOVER をもう一度送る。待ち時間は再送のたびに倍になる（8、16…、最大 64 秒）。',
      },
      events: [
        { kind: 'timer', actorId: PC, name: 'retransmit', durationMs: FIRST_RETRANSMIT_MS },
        send(discover('discover-rtx', 'delivered', FIRST_RETRANSMIT_MS / 1000, 'discover')),
      ],
    })
  }
  steps.push(
    {
      id: 'offer',
      title: { en: 'The server offers an address', ja: 'サーバーがアドレスを提示する' },
      description: {
        en: `The server picks a free address (${VALUES.offered}), reserves it for this client, and offers it with the other settings: the subnet mask, the router, the DNS server, and how long the lease lasts.`,
        ja: `サーバーは空いているアドレス（${VALUES.offered}）を選んでこのクライアントのために確保し、ほかの設定（サブネットマスク、ルーター、DNS サーバー、リースの期間）と一緒に提示する。`,
      },
      events: [
        set(SERVER, LEASES, table(LEASE_COLUMNS, [leaseRow('OFFERED')])),
        send(
          dhcpMessage({
            id: 'offer',
            type: 'DHCPOFFER',
            fromClient: false,
            ethDst: BROADCAST_MAC,
            ipSrc: VALUES.server,
            ipDst: BROADCAST_IP,
            ciaddr: ZERO,
            yiaddr: VALUES.offered,
            broadcastFlag: true,
            options: [OPT.type('DHCPOFFER'), ...SERVER_PARAMETERS],
            description: {
              en: '“You can use 192.168.1.10, with these settings.”',
              ja: '「192.168.1.10 を、この設定で使えます」',
            },
          }),
        ),
      ],
    },
    {
      id: 'request',
      title: { en: 'The PC requests the offered address', ja: 'PC が提示されたアドレスを求める' },
      description: {
        en: 'The PC answers with DHCPREQUEST, naming the offered address (option 50) and the chosen server (option 54). It is still broadcast, so that any other server that made an offer learns it was not chosen. The PC moves to REQUESTING.',
        ja: 'PC は DHCPREQUEST で答え、提示されたアドレス（オプション 50）と選んだサーバー（オプション 54）を示す。まだブロードキャストで送るので、ほかに提示したサーバーがあれば、選ばれなかったことがわかる。PC は REQUESTING に移る。',
      },
      events: [
        set(PC, STATE, 'REQUESTING'),
        send(
          dhcpMessage({
            id: 'request',
            type: 'DHCPREQUEST',
            fromClient: true,
            ethDst: BROADCAST_MAC,
            ipSrc: ZERO,
            ipDst: BROADCAST_IP,
            ciaddr: ZERO,
            yiaddr: ZERO,
            broadcastFlag: true,
            options: [
              OPT.type('DHCPREQUEST'),
              OPT.clientId,
              OPT.requested,
              OPT.serverId,
              OPT.paramList,
            ],
            description: {
              en: '“I will take 192.168.1.10 from 192.168.1.1.”',
              ja: '「192.168.1.1 の 192.168.1.10 をもらいます」',
            },
          }),
        ),
      ],
    },
  )
  if (options.serverReply === 'nak') {
    steps.push(
      ...nakSteps(
        {
          en: 'Meanwhile, the offered address was given to another device (PC 2).',
          ja: 'その間に、提示したアドレスはほかの機器（PC 2）に割り当てられてしまった。',
        },
        true,
        ZERO,
        TAKEN_BY_PC2,
      ),
    )
    return steps
  }
  steps.push(ackStep(true), boundStep())
  return steps
}

function boundStep(): Step {
  return {
    id: 'bound',
    title: { en: 'The PC starts using the address', ja: 'PC がアドレスを使い始める' },
    description: {
      en: `The PC configures ${VALUES.offered}/24, the default gateway ${VALUES.server}, and the DNS server ${VALUES.dns}, and moves to BOUND. Before using the address, the client should check with ARP that no other device already uses it. At T1 (${String(VALUES.t1S)} s) it will start renewing the lease.`,
      ja: `PC は ${VALUES.offered}/24、デフォルトゲートウェイ ${VALUES.server}、DNS サーバー ${VALUES.dns} を設定し、BOUND に移る。使う前に、ほかの機器がそのアドレスを使っていないかを ARP で確かめるとよい。T1（${String(VALUES.t1S)} 秒）になると、リースの更新を始める。`,
    },
    events: boundEvents(),
  }
}

function renewFlow(options: DhcpOptions): Step[] {
  const steps: Step[] = [
    {
      id: 'bound',
      title: { en: 'The PC is using its address', ja: 'PC はアドレスを使っている' },
      description: {
        en: `The PC got ${VALUES.offered} earlier and is in BOUND. The lease lasts ${String(VALUES.leaseS)} seconds.`,
        ja: `PC は前に ${VALUES.offered} をもらっていて、BOUND にいる。リースの期間は ${String(VALUES.leaseS)} 秒。`,
      },
      events: [...boundEvents(), set(SERVER, LEASES, table(LEASE_COLUMNS, [leaseRow('BOUND')]))],
    },
    {
      id: 't1',
      title: { en: 'T1: time to renew', ja: 'T1: 更新の時刻' },
      description: {
        en: `Half of the lease (T1 = ${String(VALUES.t1S)} s) has passed, so the PC moves to RENEWING and asks the same server to extend it. If that fails until T2 (${String(VALUES.t2S)} s), it moves to REBINDING and broadcasts to any server.`,
        ja: `リースの半分（T1 = ${String(VALUES.t1S)} 秒）が過ぎたので、PC は RENEWING に移り、同じサーバーに延長を頼む。T2（${String(VALUES.t2S)} 秒）までに更新できなければ、REBINDING に移り、どのサーバーにでもブロードキャストで頼む。`,
      },
      events: [
        { kind: 'timer', actorId: PC, name: 'T1', durationMs: VALUES.t1S * 1000 },
        set(PC, STATE, 'RENEWING'),
      ],
    },
    {
      id: 'request',
      title: { en: 'The PC asks the server directly', ja: 'PC がサーバーに直接頼む' },
      description: {
        en: 'Now the PC has an address and knows the server, so it sends DHCPREQUEST by unicast from 192.168.1.10 and puts its address in ciaddr. In this state the request must not contain option 50 or option 54.',
        ja: 'PC はもうアドレスがあり、サーバーもわかっているので、DHCPREQUEST を 192.168.1.10 からユニキャストで送り、ciaddr に自分のアドレスを入れる。この状態の要求には、オプション 50 と 54 を入れてはならない。',
      },
      events: [
        send(
          dhcpMessage({
            id: 'request',
            type: 'DHCPREQUEST',
            fromClient: true,
            ethDst: VALUES.serverMac,
            ipSrc: VALUES.offered,
            ipDst: VALUES.server,
            ciaddr: VALUES.offered,
            yiaddr: ZERO,
            broadcastFlag: false,
            options: [OPT.type('DHCPREQUEST'), OPT.clientId],
            description: {
              en: '“Can I keep using 192.168.1.10?”',
              ja: '「192.168.1.10 を使い続けてよいですか？」',
            },
          }),
        ),
      ],
    },
  ]
  if (options.serverReply === 'nak') {
    steps.push(
      ...nakSteps(
        {
          en: 'The server’s records say the lease already ended and the address now belongs to PC 2.',
          ja: 'サーバーの記録では、リースはすでに終わっていて、アドレスは PC 2 のものになっている。',
        },
        false,
        VALUES.offered,
        TAKEN_BY_PC2,
      ),
    )
    return steps
  }
  steps.push(ackStep(false), {
    id: 'renewed',
    title: { en: 'The lease is extended', ja: 'リースが延びる' },
    description: {
      en: `The PC goes back to BOUND. The lease starts again from ${String(VALUES.leaseS)} seconds, and the next T1 is ${String(VALUES.t1S)} seconds from now.`,
      ja: `PC は BOUND に戻る。リースはここからまた ${String(VALUES.leaseS)} 秒で、次の T1 は ${String(VALUES.t1S)} 秒後。`,
    },
    events: [set(PC, STATE, 'BOUND')],
  })
  return steps
}

function rebootFlow(options: DhcpOptions): Step[] {
  const steps: Step[] = [
    {
      id: 'init-reboot',
      title: {
        en: 'The PC restarts and remembers its address',
        ja: 'PC が再起動し、前のアドレスを覚えている',
      },
      description: {
        en: `The PC was restarted. It remembers that it used ${VALUES.offered}, so instead of starting from DISCOVER it asks to use the same address again (INIT-REBOOT).`,
        ja: `PC が再起動した。前に ${VALUES.offered} を使っていたことを覚えているので、DISCOVER から始める代わりに、同じアドレスをもう一度使ってよいか尋ねる（INIT-REBOOT）。`,
      },
      events: [
        set(PC, STATE, 'INIT-REBOOT'),
        set(SERVER, LEASES, table(LEASE_COLUMNS, [leaseRow('BOUND')])),
      ],
    },
    {
      id: 'request',
      title: {
        en: 'The PC broadcasts DHCPREQUEST',
        ja: 'PC が DHCPREQUEST をブロードキャストする',
      },
      description: {
        en: 'The PC cannot use the address until it is confirmed, so it broadcasts DHCPREQUEST with the remembered address in option 50. It does not name a server (no option 54). It moves to REBOOTING.',
        ja: '確かめられるまでアドレスは使えないので、PC は覚えていたアドレスをオプション 50 に入れて DHCPREQUEST をブロードキャストする。サーバーは指定しない（オプション 54 なし）。REBOOTING に移る。',
      },
      events: [
        set(PC, STATE, 'REBOOTING'),
        send(
          dhcpMessage({
            id: 'request',
            type: 'DHCPREQUEST',
            fromClient: true,
            ethDst: BROADCAST_MAC,
            ipSrc: ZERO,
            ipDst: BROADCAST_IP,
            ciaddr: ZERO,
            yiaddr: ZERO,
            broadcastFlag: true,
            options: [OPT.type('DHCPREQUEST'), OPT.clientId, OPT.requested, OPT.paramList],
            description: {
              en: '“Can I use 192.168.1.10 again?”',
              ja: '「192.168.1.10 をもう一度使ってよいですか？」',
            },
          }),
        ),
      ],
    },
  ]
  if (options.serverReply === 'nak') {
    steps.push(
      ...nakSteps(
        {
          en: 'While the PC was off, its lease ended and the address was given to PC 2.',
          ja: 'PC の電源が切れている間にリースが終わり、アドレスは PC 2 に割り当てられていた。',
        },
        true,
        ZERO,
        TAKEN_BY_PC2,
      ),
    )
    return steps
  }
  steps.push(ackStep(true), boundStep())
  return steps
}

function buildSteps(options: DhcpOptions): readonly Step[] {
  switch (options.flow) {
    case 'init':
      return initFlow(options)
    case 'renew':
      return renewFlow(options)
    case 'reboot':
      return rebootFlow(options)
  }
}

export const dhcpScenario: Scenario<DhcpOptions> = {
  id: 'dhcp',
  title: { en: 'DHCP: getting an IP address', ja: 'DHCP: IP アドレスをもらう' },
  actors,
  optionDefs: {
    flow: {
      kind: 'select',
      label: { en: 'Situation', ja: '場面' },
      choices: [
        { value: 'init', label: { en: 'First connection', ja: '初めてつなぐ' } },
        { value: 'renew', label: { en: 'Renewing the lease (T1)', ja: 'リースの更新（T1）' } },
        {
          value: 'reboot',
          label: {
            en: 'Restart with a remembered address',
            ja: '再起動（前のアドレスを覚えている）',
          },
        },
      ],
      defaultValue: 'init',
    },
    serverReply: {
      kind: 'select',
      label: { en: 'The server’s answer', ja: 'サーバーの答え' },
      choices: [
        { value: 'ack', label: { en: 'Accepts (DHCPACK)', ja: '受け入れる（DHCPACK）' } },
        { value: 'nak', label: { en: 'Refuses (DHCPNAK)', ja: '断る（DHCPNAK）' } },
      ],
      defaultValue: 'ack',
    },
    discoverLost: {
      kind: 'toggle',
      label: { en: 'Lose the first DHCPDISCOVER', ja: '最初の DHCPDISCOVER をロスさせる' },
      description: {
        en: 'Only has an effect on the first connection.',
        ja: '初めてつなぐときだけ影響する。',
      },
      defaultValue: false,
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
