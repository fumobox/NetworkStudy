/**
 * ステートフルファイアウォール: 返事は通し、見知らぬ相手は止める
 *
 * 根拠:
 * - RFC 6092 §2（simple security: 外向きの接続は通し、頼んでいない内向きの接続は通さない）、§3.2.3（UDP のフィルター。
 *   REC-14: 既知のポート以外なら状態は 2 分以上残す。既定は 5 分。REC-15: 既知のポート（0〜1023）がかかわる流れは 2 分より短くてよい。
 *   REC-16: 内から外へのパケットで更新する。REC-18: 流れに一致する Destination Unreachable は通す。REC-19: ICMP で状態を消さない）、
 *   §3.3.1（TCP のフィルター。REC-34: 頼んでいない SYN には、6 秒以上待ってから ICMPv6 の administratively prohibited を返す）
 * - RFC 4787 §4.3（REQ-5: UDP の対応づけは 2 分以上。既知のポートなら短くてよい。既定は 5 分以上を推奨）、§5（フィルタリングの動き）
 * - RFC 5382 §4.3（REQ-4: NAT は頼んでいない SYN に 6 秒以上答えない）、§5（REQ-5: 確立した接続は 2 時間 4 分以上、途中の接続は 4 分以上残す）
 * - RFC 7857 §2（RST を受け取っても、NAT はセッションを消す前に 4 分待つ。RST は偽造されうる）
 * - RFC 9293 §3.5（3 ウェイハンドシェイク）、§3.10.7.1（接続のないポートへの SYN には <SEQ=0><ACK=SEG.SEQ+SEG.LEN><CTL=RST,ACK> を返す）、
 *   §3.10.7.3（SYN-SENT で RST を受け取ると、接続は拒否される）
 * - RFC 6298 §2.1、§5.5（RTO は 1 秒から、満了のたびに倍）
 * - RFC 792（Destination Unreachable。元の IP ヘッダーと先頭の 64 ビットを含む）、RFC 1122 §4.1.3.1（待ち受けていない UDP のポートには
 *   Port Unreachable を返す）、RFC 1812 §5.2.7.1（code 3 port unreachable、code 13 communication administratively prohibited）
 * - RFC 2923 §2.1（ICMP を捨てるとパス MTU 探索が壊れる。パス MTU 探索のテーマを参照）
 * - NEW / ESTABLISHED / RELATED は Linux の netfilter の接続の追跡（conntrack、nftables の ct state）の名前。ほかの製品も同じ考え方を使う
 *
 * 学習用の単純化: NAT は使わない（アドレスは文書用のものを、そのまま経路に乗るものとして使う。家庭のルーターはこのフィルターと NAT を組み合わせる。
 * IPv6 のルーターは NAT なしで同じことをする。RFC 6092）。ファイアウォールは社内のルーターも兼ねる。ルールは 3 つだけ。
 * TCP はハンドシェイクだけを描き、シーケンス番号とウィンドウの追跡は描かない。INVALID は文章だけ。TTL とチェックサムは描かない。
 * エントリーの状態の名前は、TCP は RFC 9293 の状態（SYN-SENT など）、UDP は UNREPLIED / REPLIED（Linux の conntrack と同じ考え方）。
 * UDP のタイムアウトは 30 秒（宛先が既知のポート 53 なので、RFC 4787 REQ-5a、RFC 6092 REC-15 で短くしてよい。Linux の既定も 30 秒）。
 * reject は、すぐに答える設定（nftables の reject）として描く
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
  policy: z.enum(['drop', 'reject']).catch('drop'),
  dnsReply: z.enum(['answer', 'unreachable']).catch('answer'),
})
export type FirewallOptions = z.infer<typeof optionsSchema>

const PC: ActorId = 'pc'
const FIREWALL: ActorId = 'fw'
const SERVER: ActorId = 'server'
const RESOLVER: ActorId = 'resolver'
const STRANGER: ActorId = 'stranger'

const SOCKET: StateKey = 'socket'
const DNS: StateKey = 'dns'
const RULES: StateKey = 'rules'
const CONNTRACK: StateKey = 'conntrack'
const DECISION: StateKey = 'decision'
const RESULT: StateKey = 'result'

export const RULE_COLUMNS = ['#', 'Direction', 'Match', 'Action'] as const
export const CONNTRACK_COLUMNS = ['Proto', 'Inside', 'Outside', 'State'] as const

export const ADDRESSES = {
  pc: '203.0.113.10',
  fwInside: '203.0.113.1',
  fwOutside: '198.51.100.1',
  server: '192.0.2.10',
  resolver: '198.51.100.53',
  stranger: '192.0.2.66',
} as const
export const PC_TCP = `${ADDRESSES.pc}:49152`
export const PC_UDP = `${ADDRESSES.pc}:49153`
export const SERVER_TCP = `${ADDRESSES.server}:443`
export const RESOLVER_UDP = `${ADDRESSES.resolver}:53`
export const STRANGER_TCP = `${ADDRESSES.stranger}:40000`
export const PC_SSH = `${ADDRESSES.pc}:22`
/** 見知らぬホストの SYN のシーケンス番号 */
export const STRANGER_ISS = 7000
export const UDP_TIMEOUT_MS = 30_000
export const RTO_MS = 1000
const ANSWER_ADDRESS = '192.0.2.30'

const actors: readonly Actor[] = [
  {
    id: PC,
    kind: 'client',
    name: { en: 'Office PC (203.0.113.10)', ja: '社内の PC（203.0.113.10）' },
    shortName: { en: 'PC', ja: 'PC' },
    stateSlots: [
      {
        key: SOCKET,
        label: { en: 'Connection (as the PC sees it)', ja: '接続（PC から見た状態）' },
        initial: '-',
      },
      { key: DNS, label: { en: 'DNS lookup', ja: 'DNS の問い合わせ' }, initial: '-' },
    ],
  },
  {
    id: FIREWALL,
    kind: 'router',
    name: {
      en: 'Firewall (203.0.113.1 / 198.51.100.1)',
      ja: 'ファイアウォール（203.0.113.1 / 198.51.100.1）',
    },
    shortName: { en: 'Firewall', ja: 'ファイアウォール' },
    stateSlots: [
      {
        key: RULES,
        label: { en: 'Rules', ja: 'ルール' },
        initial: { columns: RULE_COLUMNS, rows: [] },
      },
      {
        key: CONNTRACK,
        label: { en: 'State table (connection tracking)', ja: '状態表（接続の追跡）' },
        initial: { columns: CONNTRACK_COLUMNS, rows: [] },
      },
      {
        key: DECISION,
        label: { en: 'Decision for the last packet', ja: '最後のパケットの判定' },
        initial: '-',
      },
    ],
  },
  {
    id: SERVER,
    kind: 'server',
    name: { en: 'www.example.com (192.0.2.10)', ja: 'www.example.com（192.0.2.10）' },
    shortName: { en: 'Server', ja: 'サーバー' },
    stateSlots: [],
  },
  {
    id: RESOLVER,
    kind: 'resolver',
    name: { en: 'DNS resolver (198.51.100.53)', ja: 'DNS リゾルバー（198.51.100.53）' },
    shortName: { en: 'Resolver', ja: 'リゾルバー' },
    stateSlots: [],
  },
  {
    id: STRANGER,
    kind: 'client',
    name: { en: 'Unknown host (192.0.2.66)', ja: '見知らぬホスト（192.0.2.66）' },
    shortName: { en: 'Unknown host', ja: '見知らぬホスト' },
    stateSlots: [
      {
        key: RESULT,
        label: { en: 'What the sender sees', ja: '送り手に見えること' },
        initial: '-',
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

type TcpEntryState = 'SYN-SENT' | 'SYN-RECEIVED' | 'ESTABLISHED'
type UdpEntryState = 'UNREPLIED' | 'REPLIED'

const TCP_ENTRY = (state: TcpEntryState) => ['TCP', PC_TCP, SERVER_TCP, state]
const UDP_ENTRY = (state: UdpEntryState) => ['UDP', PC_UDP, RESOLVER_UDP, state]
const conntrack = (...rows: (readonly string[])[]): StateTable => ({
  columns: CONNTRACK_COLUMNS,
  rows,
})

const rules = (policy: FirewallOptions['policy']): StateTable => ({
  columns: RULE_COLUMNS,
  rows: [
    ['1', 'any', 'ESTABLISHED, RELATED', 'accept'],
    ['2', 'out', 'NEW', 'accept'],
    ['3', 'in', 'NEW', policy],
  ],
})

const FIELD_TEXT = {
  state: {
    en: 'How the firewall classifies this packet by looking it up in the state table: NEW (no entry), ESTABLISHED (belongs to an entry), RELATED (an error about an entry)',
    ja: 'ファイアウォールが状態表を引いて、このパケットをどう分類したか。NEW（当てはまるエントリーがない）、ESTABLISHED（エントリーの一部）、RELATED（エントリーについてのエラー）',
  },
  rule: {
    en: 'The first rule that matches decides what happens to the packet',
    ja: '最初に当てはまったルールが、パケットをどうするかを決める',
  },
  addresses: {
    en: 'Source and destination address and port. Together with the protocol, these five values (the 5-tuple) identify a connection',
    ja: '送信元と宛先のアドレスとポート。プロトコルと合わせたこの 5 つの値（5-tuple）で、接続を見分ける',
  },
  icmpAddresses: {
    en: 'Source and destination address. ICMP has no ports; the ports of the flow are inside the original datagram',
    ja: '送信元と宛先のアドレス。ICMP にはポートがない。流れのポートは、元のデータグラムの中にある',
  },
} satisfies Record<string, LocalizedText>

interface PacketSpec {
  readonly id: string
  readonly from: ActorId
  readonly to: ActorId
  readonly label: string
  readonly src: string
  readonly dst: string
  readonly extra: readonly PacketField[]
  readonly status?: Message['status']
  /** ファイアウォールが受け取るパケットには、判定を添える */
  readonly verdict?: { readonly state: string; readonly rule: string }
  readonly retransmitOf?: string
}

const udp: PacketField = { name: 'Protocol', value: '17 (UDP)' }
const icmp: PacketField = { name: 'Protocol', value: '1 (ICMP)' }

function packet(spec: PacketSpec): Message {
  const fields: PacketField[] = [
    {
      name: 'Src',
      value: spec.src,
      description: spec.extra.includes(icmp) ? FIELD_TEXT.icmpAddresses : FIELD_TEXT.addresses,
    },
    { name: 'Dst', value: spec.dst },
    ...spec.extra,
  ]
  if (spec.verdict !== undefined) {
    fields.push(
      {
        name: 'State (conntrack)',
        value: spec.verdict.state,
        highlight: true,
        description: FIELD_TEXT.state,
      },
      { name: 'Rule', value: spec.verdict.rule, description: FIELD_TEXT.rule },
    )
  }
  const message: Message = {
    id: spec.id,
    from: spec.from,
    to: spec.to,
    label: spec.label,
    status: spec.status ?? 'delivered',
    fields,
  }
  return spec.retransmitOf === undefined ? message : { ...message, retransmitOf: spec.retransmitOf }
}

const flags = (value: string): PacketField => ({ name: 'Flags', value })

const TCP_SECTION: LocalizedText = { en: 'TCP', ja: 'TCP' }
const UDP_SECTION: LocalizedText = { en: 'UDP', ja: 'UDP' }
const INBOUND_SECTION: LocalizedText = {
  en: 'Unsolicited inbound',
  ja: '内向きの頼んでいない接続',
}

function tcpSteps(policy: FirewallOptions['policy']): Step[] {
  const synLabel = `SYN → ${SERVER_TCP}`
  const synAckLabel = `SYN, ACK → ${PC_TCP}`
  const ackLabel = `ACK → ${SERVER_TCP}`
  return [
    {
      id: 'rules',
      section: TCP_SECTION,
      title: { en: 'The firewall’s rules', ja: 'ファイアウォールのルール' },
      description: {
        en: `The firewall has three rules, checked from the top. Before the rules, it looks up every packet in its state table (connection tracking) and classifies it as NEW, ESTABLISHED or RELATED (a packet that makes no sense for its connection is INVALID). Rule 1 lets through anything that belongs to a known connection, rule 2 lets the office start connections, and rule 3 ${policy === 'drop' ? 'silently drops' : 'rejects'} every new connection from outside: “default deny inbound”. There is no rule that opens a port for replies.`,
        ja: `ファイアウォールには 3 つのルールがあり、上から順に確かめる。ルールの前に、どのパケットも状態表（接続の追跡）で引き、NEW、ESTABLISHED、RELATED のどれかに分類する（接続にとって意味をなさないパケットは INVALID）。ルール 1 は既知の接続に属するものを通し、ルール 2 は社内から接続を始めることを許し、ルール 3 は外からの新しい接続をすべて${policy === 'drop' ? '黙って捨てる' : '拒否する'}。「内向きは既定で拒否」。返事のためにポートを開けるルールはない。`,
      },
      events: [set(FIREWALL, RULES, rules(policy))],
    },
    {
      id: 'syn',
      section: TCP_SECTION,
      title: { en: 'The PC opens a connection: SYN', ja: 'PC が接続を開く: SYN' },
      description: {
        en: 'The PC sends a SYN to the web server. No entry in the state table matches, so the packet is NEW. It is going out, so rule 2 accepts it. The firewall records the connection by its protocol, addresses and ports, and forwards the SYN.',
        ja: 'PC が Web サーバーに SYN を送る。状態表に当てはまるエントリーはないので、このパケットは NEW。外向きなのでルール 2 が通す。ファイアウォールは、プロトコル、アドレスとポートで接続を記録し、SYN を転送する。',
      },
      events: [
        send(
          packet({
            id: 'syn-out',
            from: PC,
            to: FIREWALL,
            label: synLabel,
            src: PC_TCP,
            dst: SERVER_TCP,
            extra: [flags('SYN')],
            verdict: { state: 'NEW (out)', rule: '2 (out NEW → accept)' },
          }),
        ),
        send(
          packet({
            id: 'syn-fwd',
            from: FIREWALL,
            to: SERVER,
            label: synLabel,
            src: PC_TCP,
            dst: SERVER_TCP,
            extra: [flags('SYN')],
          }),
        ),
        set(PC, SOCKET, `TCP ${PC_TCP} → ${SERVER_TCP} (SYN-SENT)`),
        set(FIREWALL, CONNTRACK, conntrack(TCP_ENTRY('SYN-SENT'))),
        set(FIREWALL, DECISION, 'NEW (out) → rule 2: accept'),
      ],
    },
    {
      id: 'syn-ack',
      section: TCP_SECTION,
      title: { en: 'The reply is let in: ESTABLISHED', ja: '返事は通る: ESTABLISHED' },
      description: {
        en: 'The server’s SYN, ACK comes from outside, and rule 3 blocks new inbound connections. But the firewall first looks it up with source and destination swapped and finds the entry the SYN created. A packet that belongs to an existing entry is ESTABLISHED, and rule 1 accepts it. No rule opens port 49152: remembering what the PC started is what makes the firewall “stateful”.',
        ja: 'サーバーの SYN, ACK は外から来るので、ルール 3 なら新しい内向きの接続として止められる。しかしファイアウォールは、まず送信元と宛先を入れ替えて状態表を引き、SYN が作ったエントリーを見つける。既存のエントリーに属するパケットは ESTABLISHED で、ルール 1 が通す。49152 番を開けるルールはない。PC が始めたことを覚えているのが「ステートフル」の意味。',
      },
      events: [
        send(
          packet({
            id: 'syn-ack-in',
            from: SERVER,
            to: FIREWALL,
            label: synAckLabel,
            src: SERVER_TCP,
            dst: PC_TCP,
            extra: [flags('SYN, ACK')],
            verdict: { state: 'ESTABLISHED (in)', rule: '1 (ESTABLISHED → accept)' },
          }),
        ),
        send(
          packet({
            id: 'syn-ack-fwd',
            from: FIREWALL,
            to: PC,
            label: synAckLabel,
            src: SERVER_TCP,
            dst: PC_TCP,
            extra: [flags('SYN, ACK')],
          }),
        ),
        set(FIREWALL, CONNTRACK, conntrack(TCP_ENTRY('SYN-RECEIVED'))),
        set(FIREWALL, DECISION, 'ESTABLISHED (in) → rule 1: accept'),
      ],
    },
    {
      id: 'ack',
      section: TCP_SECTION,
      title: {
        en: 'The handshake completes; the entry is ESTABLISHED',
        ja: 'ハンドシェイクが完了し、エントリーは ESTABLISHED',
      },
      description: {
        en: 'The PC’s ACK completes the handshake. From now on every packet in either direction matches the entry. An established TCP entry is kept for a long time even when the connection is idle (RFC 5382 asks a NAT for at least 2 hours 4 minutes). FIN moves it to closing states that expire in minutes. After a RST the entry is kept only briefly (Linux keeps it for 10 seconds; RFC 7857 asks a NAT to wait 4 minutes, because a RST could be forged).',
        ja: 'PC の ACK でハンドシェイクが完了する。これからは、どちらの向きのパケットもこのエントリーに当てはまる。確立した TCP のエントリーは、接続が黙っていても長く残す（RFC 5382 は NAT に 2 時間 4 分以上を求める）。FIN で閉じる途中の状態になると数分で消える。RST の後は短い間だけ残す（Linux は 10 秒。RFC 7857 は、RST が偽物かもしれないので、NAT に 4 分待つよう求める）。',
      },
      events: [
        send(
          packet({
            id: 'ack-out',
            from: PC,
            to: FIREWALL,
            label: ackLabel,
            src: PC_TCP,
            dst: SERVER_TCP,
            extra: [flags('ACK')],
            verdict: { state: 'ESTABLISHED (out)', rule: '1 (ESTABLISHED → accept)' },
          }),
        ),
        send(
          packet({
            id: 'ack-fwd',
            from: FIREWALL,
            to: SERVER,
            label: ackLabel,
            src: PC_TCP,
            dst: SERVER_TCP,
            extra: [flags('ACK')],
          }),
        ),
        set(PC, SOCKET, `TCP ${PC_TCP} → ${SERVER_TCP} (ESTABLISHED)`),
        set(FIREWALL, CONNTRACK, conntrack(TCP_ENTRY('ESTABLISHED'))),
        set(FIREWALL, DECISION, 'ESTABLISHED (out) → rule 1: accept'),
      ],
    },
  ]
}

const QUERY_LABEL = 'Query A www.example.org'
const ANSWER_LABEL = `Answer: A ${ANSWER_ADDRESS}`

function udpSteps(options: FirewallOptions): Step[] {
  const established = conntrack(TCP_ENTRY('ESTABLISHED'))
  const answerFields: PacketField[] = [udp, { name: 'Answer', value: `A ${ANSWER_ADDRESS}` }]
  const steps: Step[] = [
    {
      id: 'dns-query',
      section: UDP_SECTION,
      title: {
        en: 'A DNS query over UDP: a pseudo-connection',
        ja: 'UDP の DNS 問い合わせ: 擬似的な接続',
      },
      description: {
        en: 'UDP has no handshake and no end, but the firewall still makes an entry from the protocol, addresses and ports, so that the answer can come back. The entry is UNREPLIED until a packet comes back the other way. Nothing but an idle timer decides when it goes away.',
        ja: 'UDP にはハンドシェイクも終わりもないが、ファイアウォールは応答が戻れるように、プロトコル、アドレスとポートからエントリーを作る。逆向きのパケットが来るまでは UNREPLIED。いつ消すかは、アイドルタイマーだけが決める。',
      },
      events: [
        send(
          packet({
            id: 'query-out',
            from: PC,
            to: FIREWALL,
            label: QUERY_LABEL,
            src: PC_UDP,
            dst: RESOLVER_UDP,
            extra: [udp],
            verdict: { state: 'NEW (out)', rule: '2 (out NEW → accept)' },
          }),
        ),
        send(
          packet({
            id: 'query-fwd',
            from: FIREWALL,
            to: RESOLVER,
            label: QUERY_LABEL,
            src: PC_UDP,
            dst: RESOLVER_UDP,
            extra: [udp],
          }),
        ),
        set(PC, DNS, `query sent (UDP 49153 → ${RESOLVER_UDP})`),
        set(FIREWALL, CONNTRACK, conntrack(TCP_ENTRY('ESTABLISHED'), UDP_ENTRY('UNREPLIED'))),
        set(FIREWALL, DECISION, 'NEW (out) → rule 2: accept'),
      ],
    },
  ]

  if (options.dnsReply === 'answer') {
    steps.push({
      id: 'dns-reply',
      section: UDP_SECTION,
      title: {
        en: 'The DNS answer matches the entry',
        ja: 'DNS の応答はエントリーに当てはまる',
      },
      description: {
        en: 'The answer comes from 198.51.100.53 port 53 to the PC’s port 49153: exactly the query’s addresses and ports, swapped. It belongs to the entry, so it is ESTABLISHED and rule 1 accepts it. The entry is now REPLIED.',
        ja: '応答は 198.51.100.53 の 53 番から PC の 49153 番に来る。問い合わせのアドレスとポートを入れ替えたものとぴったり同じ。エントリーに属するので ESTABLISHED で、ルール 1 が通す。エントリーは REPLIED になる。',
      },
      events: [
        send(
          packet({
            id: 'answer-in',
            from: RESOLVER,
            to: FIREWALL,
            label: ANSWER_LABEL,
            src: RESOLVER_UDP,
            dst: PC_UDP,
            extra: answerFields,
            verdict: { state: 'ESTABLISHED (in)', rule: '1 (ESTABLISHED → accept)' },
          }),
        ),
        send(
          packet({
            id: 'answer-fwd',
            from: FIREWALL,
            to: PC,
            label: ANSWER_LABEL,
            src: RESOLVER_UDP,
            dst: PC_UDP,
            extra: answerFields,
          }),
        ),
        set(PC, DNS, `answer: ${ANSWER_ADDRESS}`),
        set(FIREWALL, CONNTRACK, conntrack(TCP_ENTRY('ESTABLISHED'), UDP_ENTRY('REPLIED'))),
        set(FIREWALL, DECISION, 'ESTABLISHED (in) → rule 1: accept'),
      ],
    })
  } else {
    const icmpFields: PacketField[] = [
      icmp,
      { name: 'ICMP type / code', value: '3 / 3 (port unreachable)' },
      {
        name: 'Original datagram',
        value: 'IP header + UDP 49153 → 53',
        highlight: true,
        description: {
          en: 'The start of the packet that caused the error, including its UDP ports. This is how the firewall links the error to the entry',
          ja: 'エラーの原因になったパケットの先頭で、UDP のポートも入っている。ファイアウォールはこれで、エラーをエントリーに結びつける',
        },
      },
    ]
    const label = 'Port Unreachable (3/3)'
    steps.push({
      id: 'dns-unreachable',
      section: UDP_SECTION,
      title: {
        en: 'ICMP Port Unreachable: RELATED',
        ja: 'ICMP の Port Unreachable: RELATED',
      },
      description: {
        en: 'Nothing listens on port 53 at that address, so the host answers with ICMP Destination Unreachable, code 3 (port unreachable). The ICMP message is not part of the UDP flow, but it carries the IP header and the first 8 bytes (the UDP ports) of the packet that caused it, so the firewall can match it to the entry: RELATED, accepted by rule 1. The entry stays; an ICMP error does not remove it. A firewall that drops all ICMP would hide this error, and would also break path MTU discovery.',
        ja: 'そのアドレスの 53 番では何も待ち受けていないので、ホストは ICMP の Destination Unreachable、code 3（port unreachable）を返す。ICMP のメッセージは UDP の流れの一部ではないが、原因になったパケットの IP ヘッダーと先頭の 8 バイト（UDP のポート）を含むので、ファイアウォールはエントリーに結びつけられる。RELATED で、ルール 1 が通す。エントリーは残る（ICMP のエラーでは消さない）。ICMP をすべて捨てるファイアウォールは、このエラーを隠し、パス MTU 探索も壊してしまう。',
      },
      events: [
        send(
          packet({
            id: 'unreachable-in',
            from: RESOLVER,
            to: FIREWALL,
            label,
            src: ADDRESSES.resolver,
            dst: ADDRESSES.pc,
            extra: icmpFields,
            verdict: { state: 'RELATED (in)', rule: '1 (RELATED → accept)' },
          }),
        ),
        send(
          packet({
            id: 'unreachable-fwd',
            from: FIREWALL,
            to: PC,
            label,
            src: ADDRESSES.resolver,
            dst: ADDRESSES.pc,
            extra: icmpFields,
          }),
        ),
        set(PC, DNS, 'failed: port unreachable'),
        set(FIREWALL, DECISION, 'RELATED (in) → rule 1: accept'),
      ],
    })
  }

  steps.push({
    id: 'udp-timeout',
    section: UDP_SECTION,
    title: {
      en: 'No more packets: the UDP entry expires',
      ja: 'パケットが来ない: UDP のエントリーが消える',
    },
    description: {
      en: 'UDP has no FIN, so the entry lives only as long as packets keep coming. This page uses 30 seconds. For most UDP flows a NAT or firewall should wait at least 2 minutes (5 minutes by default), but a flow to a well-known port such as DNS on 53 may time out sooner (RFC 4787, RFC 6092).',
      ja: 'UDP には FIN がないので、エントリーはパケットが来ている間しか残らない。このページでは 30 秒。多くの UDP の流れでは、NAT やファイアウォールは 2 分以上（既定は 5 分）待つべきだが、DNS の 53 番のような既知のポートへの流れは、もっと早く消してよい（RFC 4787、RFC 6092）。',
    },
    events: [
      { kind: 'timer', actorId: FIREWALL, name: 'UDP timeout', durationMs: UDP_TIMEOUT_MS },
      set(FIREWALL, CONNTRACK, established),
    ],
  })

  if (options.dnsReply === 'answer') {
    const events: StepEvent[] = [
      send(
        packet({
          id: 'late-answer',
          from: RESOLVER,
          to: FIREWALL,
          label: ANSWER_LABEL,
          src: RESOLVER_UDP,
          dst: PC_UDP,
          extra: answerFields,
          status: 'rejected',
          verdict: { state: 'NEW (in)', rule: `3 (in NEW → ${options.policy})` },
        }),
      ),
      set(FIREWALL, DECISION, `NEW (in) → rule 3: ${options.policy}`),
    ]
    if (options.policy === 'reject') {
      events.push(
        send(
          packet({
            id: 'late-answer-unreachable',
            from: FIREWALL,
            to: RESOLVER,
            label: 'Port Unreachable (3/3)',
            src: ADDRESSES.fwOutside,
            dst: ADDRESSES.resolver,
            extra: [
              icmp,
              { name: 'ICMP type / code', value: '3 / 3 (port unreachable)', highlight: true },
              { name: 'Original datagram', value: 'IP header + UDP 53 → 49153' },
            ],
          }),
        ),
      )
    }
    steps.push({
      id: 'late-answer',
      section: UDP_SECTION,
      title:
        options.policy === 'drop'
          ? { en: 'A late answer is now NEW: dropped', ja: '遅れて来た応答は NEW 扱い: 捨てる' }
          : { en: 'A late answer is now NEW: rejected', ja: '遅れて来た応答は NEW 扱い: 拒否' },
      description:
        options.policy === 'drop'
          ? {
              en: 'A duplicate answer arrives after the entry has gone. Nothing matches it any more, so it is NEW and inbound: rule 3 drops it without a word.',
              ja: 'エントリーが消えた後で、重複した応答が届く。もう当てはまるものがないので NEW の内向きのパケットになり、ルール 3 が黙って捨てる。',
            }
          : {
              en: 'A duplicate answer arrives after the entry has gone. Nothing matches it any more, so it is NEW and inbound: rule 3 rejects it. For UDP, rejecting means answering with ICMP Destination Unreachable, as if the port were closed (port unreachable here; some firewalls use code 13, communication administratively prohibited).',
              ja: 'エントリーが消えた後で、重複した応答が届く。もう当てはまるものがないので NEW の内向きのパケットになり、ルール 3 が拒否する。UDP の拒否は、ポートが閉じているかのように ICMP の Destination Unreachable で答えること（ここでは port unreachable。code 13 の communication administratively prohibited を使うファイアウォールもある）。',
            },
      events,
    })
  }
  return steps
}

function inboundSteps(policy: FirewallOptions['policy']): Step[] {
  const synLabel = `SYN → ${PC_SSH}`
  const synFields: PacketField[] = [flags('SYN'), { name: 'Seq', value: String(STRANGER_ISS) }]
  const steps: Step[] = [
    {
      id: 'stranger-syn',
      section: INBOUND_SECTION,
      title: {
        en: 'An unsolicited SYN from the Internet',
        ja: 'インターネットから頼んでいない SYN',
      },
      description: {
        en: 'A host on the Internet, perhaps a scanner, tries to connect to the PC’s SSH port 22. The SYN is not a reply to anything, so no entry matches: NEW and inbound, and rule 3 applies. Whether the PC actually listens on port 22 does not matter: the packet never reaches it.',
        ja: 'インターネットのホスト（スキャナーかもしれない）が、PC の SSH の 22 番に接続しようとする。この SYN は何の返事でもないので、当てはまるエントリーはない。NEW の内向きのパケットで、ルール 3 が当てはまる。PC が本当に 22 番で待ち受けているかどうかは関係ない。パケットは PC まで届かない。',
      },
      events: [
        send(
          packet({
            id: 'stranger-syn',
            from: STRANGER,
            to: FIREWALL,
            label: synLabel,
            src: STRANGER_TCP,
            dst: PC_SSH,
            extra: synFields,
            status: 'rejected',
            verdict: { state: 'NEW (in)', rule: `3 (in NEW → ${policy})` },
          }),
        ),
        set(FIREWALL, DECISION, `NEW (in) → rule 3: ${policy}`),
      ],
    },
  ]
  if (policy === 'drop') {
    steps.push({
      id: 'retry',
      section: INBOUND_SECTION,
      title: {
        en: 'Silence: the sender retries and learns nothing',
        ja: '沈黙: 送り手は再送するが何もわからない',
      },
      description: {
        en: 'The sender hears nothing, so after the retransmission timeout (1 second, then 2, 4, …) it sends the SYN again, and it is dropped again. A port scanner reports such a port as “filtered”. Dropping costs nothing and reveals little, but a legitimate client that tried the wrong address has to wait for its connection attempt to time out.',
        ja: '送り手には何も返ってこないので、再送タイムアウト（1 秒、次は 2 秒、4 秒…）の後で SYN をもう一度送り、また捨てられる。ポートスキャナーは、このようなポートを「filtered」と報告する。黙って捨てるのは手間がかからず、ほとんど何も明かさないが、アドレスを間違えただけの正当なクライアントは、接続の試みがタイムアウトするまで待たされる。',
      },
      events: [
        { kind: 'timer', actorId: STRANGER, name: 'RTO', durationMs: RTO_MS },
        send(
          packet({
            id: 'stranger-syn-retry',
            from: STRANGER,
            to: FIREWALL,
            label: synLabel,
            src: STRANGER_TCP,
            dst: PC_SSH,
            extra: synFields,
            status: 'rejected',
            verdict: { state: 'NEW (in)', rule: '3 (in NEW → drop)' },
            retransmitOf: 'stranger-syn',
          }),
        ),
        set(STRANGER, RESULT, 'no answer (filtered)'),
      ],
    })
  } else {
    steps.push({
      id: 'rst',
      section: INBOUND_SECTION,
      title: {
        en: 'Reject: the firewall answers with RST',
        ja: '拒否: ファイアウォールが RST で答える',
      },
      description: {
        en: 'The firewall answers on the PC’s behalf with the RST, ACK that a closed port would send: Seq 0 and Ack = the SYN’s Seq + 1, from the PC’s address. The sender gets “connection refused” at once and stops trying, and a port scanner reports the port as “closed”. This page rejects immediately; home gateways following RFC 6092 wait at least 6 seconds (in case both sides are opening the connection at the same time) and answer with an ICMP error instead.',
        ja: 'ファイアウォールが PC の代わりに、閉じたポートが返すのと同じ RST, ACK で答える。Seq は 0、Ack は SYN の Seq + 1 で、送信元は PC のアドレス。送り手はすぐに「接続の拒否」（connection refused）を受け取って試すのをやめ、ポートスキャナーはこのポートを「closed」と報告する。このページではすぐに拒否する。RFC 6092 に従う家庭のゲートウェイは、両側が同時に接続を開こうとしている場合に備えて 6 秒以上待ち、代わりに ICMP のエラーで答える。',
      },
      events: [
        send(
          packet({
            id: 'rst',
            from: FIREWALL,
            to: STRANGER,
            label: `RST, ACK → ${STRANGER_TCP}`,
            src: PC_SSH,
            dst: STRANGER_TCP,
            extra: [
              flags('RST, ACK'),
              { name: 'Seq', value: '0' },
              { name: 'Ack', value: String(STRANGER_ISS + 1), highlight: true },
            ],
          }),
        ),
        set(STRANGER, RESULT, 'RST (connection refused)'),
      ],
    })
  }
  return steps
}

function buildSteps(options: FirewallOptions): readonly Step[] {
  return [...tcpSteps(options.policy), ...udpSteps(options), ...inboundSteps(options.policy)]
}

export const firewallScenario: Scenario<FirewallOptions> = {
  id: 'firewall',
  title: {
    en: 'Stateful firewall: letting replies in, keeping strangers out',
    ja: 'ステートフルファイアウォール: 返事は通し、見知らぬ相手は止める',
  },
  actors,
  optionDefs: {
    policy: {
      kind: 'select',
      label: {
        en: 'Rule 3: new connections from outside',
        ja: 'ルール 3: 外からの新しい接続',
      },
      choices: [
        { value: 'drop', label: { en: 'drop (silently)', ja: 'drop（黙って捨てる）' } },
        {
          value: 'reject',
          label: { en: 'reject (RST or ICMP error)', ja: 'reject（RST か ICMP のエラーで答える）' },
        },
      ],
      defaultValue: 'drop',
    },
    dnsReply: {
      kind: 'select',
      label: {
        en: 'The reply to the DNS query',
        ja: 'DNS の問い合わせへの返事',
      },
      choices: [
        { value: 'answer', label: { en: 'A DNS answer', ja: 'DNS の応答' } },
        {
          value: 'unreachable',
          label: {
            en: 'ICMP Port Unreachable (nothing listens on 53)',
            ja: 'ICMP の Port Unreachable（53 番で待ち受けていない）',
          },
        },
      ],
      defaultValue: 'answer',
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
