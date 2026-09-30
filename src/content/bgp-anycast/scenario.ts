/**
 * BGP とエニーキャスト: 経路が伝わるしくみと、1 つのアドレスを複数の拠点で
 *
 * 根拠:
 * - RFC 4271（BGP-4）: §3.1（取り下げ、置き換え、セッションが切れたら経路を消す）、§4.1〜§4.5（メッセージの形式。messages.ts）、
 *   §5.1.2（AS_PATH。asPath.ts）、§5.1.3（NEXT_HOP は、eBGP ではセッションに使うインターフェースのアドレス）、
 *   §6.5・§8.2.2（Hold Timer が切れたら NOTIFICATION（Error Code 4）を送り、TCP を切って Idle に戻る）、
 *   §9.1.2（自分の AS を含む経路は使わない）、§9.1.2.2（AS_PATH の AS が少ない方を選ぶ。bestPath.ts）、§10（Hold Time 90 秒、KEEPALIVE は 3 分の 1）
 * - RFC 6793（4 オクテットの AS 番号の Capability 65）、RFC 5492（Capabilities）
 * - RFC 4786（BCP 126。エニーキャストの運用）: §2（catchment）、§3.1、§4.1（経路の選択はトランザクションより長く安定していること）、
 *   §4.4.1（サービスの状態に合わせて広告と取り下げをする）、§4.4.2（IPv4 では多くの場合 /24）、§4.4.4（同じ起点の AS）
 * - RFC 7094 §4.2（エニーキャストでは UDP が共通語。経路が変わると TCP の接続は切れる）
 * - RFC 9293 §3.10.7.1（接続のない相手への、RST でないセグメントには RST を返す。ACK があれば <SEQ=SEG.ACK><CTL=RST>）
 * - RFC 1035 §4.2.1（UDP の再送は 2〜5 秒）、§4.2.2（TCP では 2 オクテットの長さを前に付ける）
 * - RFC 5398（説明用の AS 番号 64496〜64511）、RFC 5737（説明用の IPv4 アドレス）、RFC 2606（example.com）
 *
 * 学習用の単純化: 拠点ごとに 1 本のレーン（BGP を話すルーターと DNS のサーバーを 1 つにする。RFC 4786 §4.4.1 はサーバーで
 * 経路の広告をする構成も挙げる）。IPv4 だけ。ISP とトランジット、トランジットと拠点 B のセッションは最初から Established で、
 * 帰りの経路は描かない。iBGP、LOCAL_PREF、MED、MinRouteAdvertisementInterval、経路のフラップの抑制は扱わない。
 * TCP の 3 ウェイハンドシェイクは 1 本の矢印にまとめ、一時的なポートは描かない。DNS の応答の値と TCP の初期シーケンス番号は例の値
 */
import { z } from 'zod'
import type {
  Actor,
  ActorId,
  Message,
  MessageStatus,
  PacketField,
  Scenario,
  StateKey,
  StateTable,
  Step,
  StepEvent,
} from '@/engine/types'
import type { LocalizedText } from '@/lib/i18n/locale'
import { formatAsPath, prepend, type AsPath } from './asPath'
import { removeFrom, replaceFrom, selectBest, type BestPath, type Candidate } from './bestPath'
import { lookupFib, type FibEntry } from './fib'
import { DEFAULT_HOLD_TIME, keepaliveInterval, negotiateHoldTime } from './fsm'
import {
  CAPABILITY_FOUR_OCTET_AS,
  KEEPALIVE_LENGTH,
  MARKER,
  MESSAGE_TYPES,
  notificationLength,
  OPEN_LENGTH,
  pathAttributesLength,
  updateLength,
} from './messages'

const SITUATIONS = ['propagate', 'withdraw', 'holdTimer', 'routeChange'] as const

const optionsSchema = z.object({
  situation: z.enum(SITUATIONS).catch('propagate'),
})
export type BgpAnycastOptions = z.infer<typeof optionsSchema>
type Situation = BgpAnycastOptions['situation']

const PC: ActorId = 'pc'
const ISP: ActorId = 'isp'
const SITE_A: ActorId = 'siteA'
const TRANSIT: ActorId = 'transit'
const SITE_B: ActorId = 'siteB'

const ANSWER: StateKey = 'answer'
const TCP_STATE: StateKey = 'tcp'
const SESSION: StateKey = 'session'
const HOLD: StateKey = 'hold'
const RIB: StateKey = 'rib'
const DECISION: StateKey = 'decision'
const FIB: StateKey = 'fib'
const ANNOUNCE: StateKey = 'announce'
const SERVICE: StateKey = 'service'

const RIB_COLUMNS = ['Prefix', 'From', 'AS_PATH', 'NEXT_HOP', 'Best'] as const
const FIB_COLUMNS = ['Prefix', 'Next hop', 'Via'] as const

/** AS 番号（RFC 5398）。拠点 A と B は同じ起点の AS（RFC 4786 §4.4.4） */
export const AS = { isp: 64496, transit: 64500, anycast: 64511 } as const

/** アドレス（RFC 5737）。リンクは /30 */
export const ADDR = {
  pc: '192.0.2.10',
  ispToA: '192.0.2.1',
  siteA: '192.0.2.2',
  ispToTransit: '198.51.100.2',
  transitToIsp: '198.51.100.1',
  transitToB: '198.51.100.5',
  siteB: '198.51.100.6',
  service: '203.0.113.53',
  answer: '198.51.100.80',
} as const
export const ANYCAST_PREFIX = '203.0.113.0/24'
const ISP_PREFIX = '192.0.2.0/24'

const HOLD_A = 180
const HOLD_TIME = negotiateHoldTime(DEFAULT_HOLD_TIME, HOLD_A)
const KEEPALIVE_S = keepaliveInterval(HOLD_TIME)

// ---------- 経路 ----------

const fromA = (asPath: AsPath): Candidate => ({
  from: 'Site A',
  peerId: ADDR.siteA,
  asPath,
  nextHop: ADDR.siteA,
})
/** トランジットが拠点 B の経路を ISP に広告するときは、自分の AS を付け足し、NEXT_HOP を自分のアドレスにする */
const VIA_TRANSIT: Candidate = {
  from: 'Transit',
  peerId: ADDR.transitToIsp,
  asPath: prepend([AS.anycast], AS.transit),
  nextHop: ADDR.transitToIsp,
}
const DIRECT_A = fromA([AS.anycast])

function ribTable(candidates: readonly Candidate[], best: BestPath | null): StateTable {
  return {
    columns: RIB_COLUMNS,
    rows: candidates.map((c) => [
      ANYCAST_PREFIX,
      c.from,
      formatAsPath(c.asPath),
      c.nextHop,
      best?.best === c ? '✓' : '-',
    ]),
  }
}

const CONNECTED: readonly FibEntry[] = [
  { prefix: ISP_PREFIX, nextHop: 'connected', via: '-' },
  { prefix: '198.51.100.0/30', nextHop: 'connected', via: '-' },
]
const fibFor = (best: BestPath | null): readonly FibEntry[] =>
  best === null
    ? CONNECTED
    : [
        ...CONNECTED,
        { prefix: ANYCAST_PREFIX, nextHop: best.best.nextHop, via: `BGP (${best.best.from})` },
      ]
const fibTable = (fib: readonly FibEntry[]): StateTable => ({
  columns: FIB_COLUMNS,
  rows: fib.map((entry) => [entry.prefix, entry.nextHop, entry.via]),
})

function describeBest(best: BestPath | null): string {
  if (best === null) {
    return `no route to ${ANYCAST_PREFIX}`
  }
  const length = String(best.best.asPath.length)
  switch (best.reason) {
    case 'only':
      return `best: via ${best.best.from} (only route)`
    case 'asPathLength':
      return `best: via ${best.best.from} (AS_PATH length ${length} is shorter)`
    case 'bgpIdentifier':
      return `best: via ${best.best.from} (lower BGP Identifier)`
  }
}

/** ISP のルーターの経路の表・判断・転送の表を、候補からまとめて作る */
function ispRouting(candidates: readonly Candidate[]): StepEvent[] {
  const best = selectBest(candidates, AS.isp)
  return [
    set(ISP, RIB, ribTable(candidates, best)),
    set(ISP, DECISION, describeBest(best)),
    set(ISP, FIB, fibTable(fibFor(best))),
  ]
}

/** 転送の表で、エニーキャストのアドレスの次の相手を引く */
function nextActorFor(candidates: readonly Candidate[]): ActorId {
  const entry = lookupFib(fibFor(selectBest(candidates, AS.isp)), ADDR.service)
  return entry?.nextHop === ADDR.siteA ? SITE_A : TRANSIT
}

// ---------- アクター ----------

const set = (actorId: ActorId, key: StateKey, value: string | StateTable): StepEvent => ({
  kind: 'stateChange',
  actorId,
  key,
  value,
})
const send = (message: Message): StepEvent => ({ kind: 'message', message })
const timer = (actorId: ActorId, name: string, seconds: number): StepEvent => ({
  kind: 'timer',
  actorId,
  name,
  durationMs: seconds * 1000,
})

const siteSlots = [
  { key: SESSION, label: { en: 'BGP session', ja: 'BGP のセッション' }, initial: '-' },
  { key: ANNOUNCE, label: { en: 'Announcing', ja: '広告している経路' }, initial: '-' },
  { key: SERVICE, label: { en: 'DNS service', ja: 'DNS のサービス' }, initial: '-' },
  { key: TCP_STATE, label: { en: 'TCP connection', ja: 'TCP の接続' }, initial: '-' },
]

const actors: readonly Actor[] = [
  {
    id: PC,
    kind: 'client',
    name: { en: 'PC (192.0.2.10)', ja: 'PC（192.0.2.10）' },
    shortName: { en: 'PC', ja: 'PC' },
    stateSlots: [
      { key: ANSWER, label: { en: 'Last DNS answer', ja: '最後の DNS の答え' }, initial: '-' },
      { key: TCP_STATE, label: { en: 'TCP connection', ja: 'TCP の接続' }, initial: '-' },
    ],
  },
  {
    id: ISP,
    kind: 'router',
    name: { en: 'Your ISP’s router (AS 64496)', ja: 'ISP のルーター（AS 64496）' },
    shortName: { en: 'ISP', ja: 'ISP' },
    stateSlots: [
      {
        key: SESSION,
        label: { en: 'BGP session with Site A', ja: '拠点 A との BGP のセッション' },
        initial: '-',
      },
      { key: HOLD, label: { en: 'Hold Timer (Site A)', ja: 'Hold Timer（拠点 A）' }, initial: '-' },
      {
        key: RIB,
        label: { en: 'BGP table', ja: 'BGP の経路の表' },
        initial: ribTable([], null),
      },
      { key: DECISION, label: { en: 'Best path', ja: '最良経路' }, initial: '-' },
      {
        key: FIB,
        label: { en: 'Forwarding table (FIB)', ja: '転送の表（FIB）' },
        initial: fibTable([]),
      },
    ],
  },
  {
    id: SITE_A,
    kind: 'resolver',
    name: { en: 'Site A: anycast DNS (AS 64511)', ja: '拠点 A: エニーキャストの DNS（AS 64511）' },
    shortName: { en: 'Site A', ja: '拠点 A' },
    stateSlots: siteSlots,
  },
  {
    id: TRANSIT,
    kind: 'router',
    name: { en: 'Transit provider (AS 64500)', ja: 'トランジット事業者（AS 64500）' },
    shortName: { en: 'Transit', ja: 'トランジット' },
    stateSlots: [
      { key: RIB, label: { en: 'BGP table', ja: 'BGP の経路の表' }, initial: ribTable([], null) },
    ],
  },
  {
    id: SITE_B,
    kind: 'resolver',
    name: { en: 'Site B: anycast DNS (AS 64511)', ja: '拠点 B: エニーキャストの DNS（AS 64511）' },
    shortName: { en: 'Site B', ja: '拠点 B' },
    stateSlots: [
      ...siteSlots.filter((slot) => slot.key !== SESSION),
      { key: DECISION, label: { en: 'Last UPDATE', ja: '最後の UPDATE' }, initial: '-' },
    ],
  },
]

// ---------- BGP のメッセージ ----------

const FIELD_TEXT = {
  marker: {
    en: 'Marker: 16 octets of all ones (RFC 4271 §4.1)',
    ja: 'Marker。すべて 1 の 16 オクテット（RFC 4271 §4.1）',
  },
  length: {
    en: 'The whole message in octets, including the 19-octet header',
    ja: '19 オクテットのヘッダーを含む、メッセージ全体のオクテット数',
  },
  holdTime: {
    en: 'The sender’s proposal. Both sides use the smaller value; 0 or at least 3 seconds',
    ja: '送る側の案。両側は小さい方を使う。0 か 3 秒以上',
  },
  capability: {
    en: 'Four-octet AS numbers (RFC 6793). Both sides support it, so AS_PATH carries 4 octets per AS',
    ja: '4 オクテットの AS 番号（RFC 6793）。両側が対応するので、AS_PATH は AS ごとに 4 オクテット',
  },
  asPath: {
    en: 'The ASes the route has passed through, the most recent first. Each eBGP speaker adds its own AS on the left',
    ja: '経路が通ってきた AS。新しいものが先頭。eBGP で広告する側が、左端に自分の AS を付け足す',
  },
  nextHop: {
    en: 'Where to send packets for this prefix: the sender’s address on this link',
    ja: 'このプレフィックス宛てのパケットの送り先。このリンクでの送る側のアドレス',
  },
  nlri: {
    en: 'The prefix being announced (Network Layer Reachability Information)',
    ja: '広告するプレフィックス（Network Layer Reachability Information）',
  },
  withdrawn: {
    en: 'Prefixes the sender no longer reaches',
    ja: '送る側が、もう届けられないプレフィックス',
  },
} satisfies Record<string, LocalizedText>

interface Field {
  readonly name: string
  readonly value: string
  readonly text?: LocalizedText
  readonly highlight?: boolean
}
const toFields = (list: readonly Field[]): PacketField[] =>
  list.map((f) => ({
    name: f.name,
    value: f.value,
    ...(f.text === undefined ? {} : { description: f.text }),
    ...(f.highlight === true ? { highlight: true } : {}),
  }))

function bgp(
  id: string,
  from: ActorId,
  to: ActorId,
  type: keyof typeof MESSAGE_TYPES,
  length: number,
  body: readonly Field[],
  description: LocalizedText,
  status: MessageStatus = 'delivered',
  label: string = type,
): Message {
  return {
    id,
    from,
    to,
    label,
    status,
    description,
    fields: toFields([
      { name: 'Transport', value: 'TCP, port 179' },
      { name: 'Marker', value: MARKER, text: FIELD_TEXT.marker },
      { name: 'Length', value: String(length), text: FIELD_TEXT.length },
      { name: 'Type', value: `${String(MESSAGE_TYPES[type])} (${type})` },
      ...body,
    ]),
  }
}

function openMessage(
  id: string,
  from: ActorId,
  to: ActorId,
  holdTime: number,
  identifier: string,
): Message {
  const myAs = from === ISP ? AS.isp : AS.anycast
  return bgp(
    id,
    from,
    to,
    'OPEN',
    OPEN_LENGTH,
    [
      { name: 'Version', value: '4' },
      { name: 'My Autonomous System', value: String(myAs), highlight: true },
      {
        name: 'Hold Time',
        value: `${String(holdTime)} s`,
        text: FIELD_TEXT.holdTime,
        highlight: true,
      },
      { name: 'BGP Identifier', value: identifier },
      { name: 'Optional Parameters Length', value: '8' },
      {
        name: 'Capability',
        value: `${String(CAPABILITY_FOUR_OCTET_AS)} (4-octet AS): ${String(myAs)}`,
        text: FIELD_TEXT.capability,
      },
    ],
    {
      en: 'OPEN: who I am and what I propose.',
      ja: 'OPEN。自分は誰で、何を提案するか。',
    },
  )
}

const keepalive = (id: string, from: ActorId, to: ActorId, status: MessageStatus = 'delivered') =>
  bgp(
    id,
    from,
    to,
    'KEEPALIVE',
    KEEPALIVE_LENGTH,
    [],
    {
      en: 'KEEPALIVE: only the 19-octet header. “I am still here.”',
      ja: 'KEEPALIVE。19 オクテットのヘッダーだけ。「まだいる」。',
    },
    status,
  )

function announce(
  id: string,
  from: ActorId,
  to: ActorId,
  asPath: AsPath,
  nextHop: string,
  description: LocalizedText,
  status: MessageStatus = 'delivered',
): Message {
  return bgp(
    id,
    from,
    to,
    'UPDATE',
    updateLength({ withdrawn: [], nlri: [24], asCount: asPath.length }),
    [
      { name: 'Withdrawn Routes Length', value: '0' },
      { name: 'Total Path Attribute Length', value: String(pathAttributesLength(asPath.length)) },
      { name: 'ORIGIN', value: '0 (IGP)' },
      { name: 'AS_PATH', value: formatAsPath(asPath), text: FIELD_TEXT.asPath, highlight: true },
      { name: 'NEXT_HOP', value: nextHop, text: FIELD_TEXT.nextHop },
      { name: 'NLRI', value: ANYCAST_PREFIX, text: FIELD_TEXT.nlri, highlight: true },
    ],
    description,
    status,
    `UPDATE AS_PATH ${formatAsPath(asPath)}`,
  )
}

function withdrawMessage(id: string): Message {
  return bgp(
    id,
    SITE_A,
    ISP,
    'UPDATE',
    updateLength({ withdrawn: [24], nlri: [], asCount: 0 }),
    [
      { name: 'Withdrawn Routes Length', value: '4' },
      {
        name: 'Withdrawn Routes',
        value: ANYCAST_PREFIX,
        text: FIELD_TEXT.withdrawn,
        highlight: true,
      },
      { name: 'Total Path Attribute Length', value: '0' },
    ],
    {
      en: 'An UPDATE that only withdraws: no path attributes and no NLRI.',
      ja: '取り下げだけの UPDATE。経路の属性も NLRI もない。',
    },
    'delivered',
    `UPDATE withdraw ${ANYCAST_PREFIX}`,
  )
}

// ---------- データプレーンのパケット ----------

interface Packet {
  readonly label: string
  readonly fields: readonly Field[]
  readonly description: LocalizedText
}

const QUERY: Packet = {
  label: 'DNS query A example.com',
  fields: [
    { name: 'IP Src', value: ADDR.pc },
    { name: 'IP Dst', value: ADDR.service, highlight: true },
    { name: 'UDP Dst', value: '53' },
    { name: 'Question', value: 'example.com A' },
  ],
  description: {
    en: 'A DNS query over UDP to the anycast address. Every site has this address.',
    ja: 'エニーキャストのアドレスへの、UDP の DNS の問い合わせ。どの拠点もこのアドレスを持つ。',
  },
}
const REPLY: Packet = {
  label: `DNS answer A ${ADDR.answer}`,
  fields: [
    { name: 'IP Src', value: ADDR.service },
    { name: 'IP Dst', value: ADDR.pc },
    { name: 'UDP Src', value: '53' },
    { name: 'Answer', value: `example.com A ${ADDR.answer}` },
  ],
  description: {
    en: 'The answer comes from the same address, whichever site sent it.',
    ja: '答えは、どの拠点が送っても同じアドレスから来る。',
  },
}

/** DNS over TCP の 1 つのセグメント（RFC 1035 §4.2.2: 2 オクテットの長さ + DNS のメッセージ） */
interface Segment {
  readonly toServer: boolean
  readonly flags: string
  readonly seq: number
  readonly ack: number
  readonly len: number
}
/** example.com の A の問い合わせは 29 オクテット（ヘッダー 12 + 名前 13 + 種類とクラス 4）、答えは 45（+ 名前の圧縮 2 + 14） */
const TCP_QUERY_LEN = 2 + 29
const TCP_ANSWER_LEN = 2 + 45
const CLIENT_ISS = 1000
const SERVER_ISS = 5000

function segmentPacket(segment: Segment): Packet {
  const [src, dst] = segment.toServer ? [ADDR.pc, ADDR.service] : [ADDR.service, ADDR.pc]
  return {
    label: `TCP [${segment.flags}] Seq=${String(segment.seq)}`,
    fields: [
      { name: 'IP Src', value: src },
      { name: 'IP Dst', value: dst, highlight: segment.toServer },
      { name: segment.toServer ? 'TCP Dst' : 'TCP Src', value: '53' },
      { name: 'Flags', value: segment.flags, highlight: segment.flags === 'RST' },
      { name: 'Seq', value: String(segment.seq) },
      { name: 'Ack', value: String(segment.ack) },
      { name: 'Len', value: String(segment.len) },
    ],
    description: segment.toServer
      ? {
          en: 'A DNS query over TCP, on the open connection.',
          ja: '開いた接続での、TCP の DNS の問い合わせ。',
        }
      : segment.flags === 'RST'
        ? {
            en: 'A reset: this site has no connection with these addresses and ports.',
            ja: 'リセット。この拠点には、このアドレスとポートの接続がない。',
          }
        : { en: 'The answer over TCP.', ja: 'TCP での答え。' },
  }
}

/** 経路に沿って 1 ホップずつ送る */
function hops(
  prefix: string,
  path: readonly ActorId[],
  packet: Packet,
  last: MessageStatus = 'delivered',
): StepEvent[] {
  return path.slice(1).map((to, i) => {
    const from = path[i] ?? PC
    return send({
      id: `${prefix}-${String(i + 1)}`,
      from,
      to,
      label: packet.label,
      status: i === path.length - 2 ? last : 'delivered',
      description: packet.description,
      fields: toFields(packet.fields),
    })
  })
}

// ---------- セクション ----------

const SECTIONS = {
  session: { en: 'Session setup', ja: 'セッションの確立' },
  routes: { en: 'Routes travel', ja: '経路が伝わる' },
  data: { en: 'Data plane', ja: 'データプレーン' },
  failure: { en: 'Something changes', ja: '何かが変わる' },
} satisfies Record<string, LocalizedText>
type StepBody = Omit<Step, 'section'>
const inSection = (section: LocalizedText, steps: readonly StepBody[]): Step[] =>
  steps.map((step) => ({ ...step, section }))

// ---------- 準備 ----------

const TRANSIT_RIB: StateTable = {
  columns: RIB_COLUMNS,
  rows: [[ANYCAST_PREFIX, 'Site B', String(AS.anycast), ADDR.siteB, '✓']],
}
const ANNOUNCING = `${ANYCAST_PREFIX} [${String(AS.anycast)}]`

/** propagate を終えた状態から始める状況の準備 */
function establishedSetup(description: LocalizedText, extra: readonly StepEvent[] = []): Step {
  return {
    id: 'setup',
    title: {
      en: 'Both sites announce 203.0.113.0/24',
      ja: '両方の拠点が 203.0.113.0/24 を広告している',
    },
    description,
    section: SECTIONS.routes,
    events: [
      set(ISP, SESSION, 'Established'),
      set(ISP, HOLD, `${String(HOLD_TIME)} s`),
      ...ispRouting([DIRECT_A, VIA_TRANSIT]),
      set(SITE_A, SESSION, 'Established'),
      set(SITE_A, ANNOUNCE, ANNOUNCING),
      set(SITE_A, SERVICE, 'up'),
      set(SITE_B, ANNOUNCE, ANNOUNCING),
      set(SITE_B, SERVICE, 'up'),
      set(TRANSIT, RIB, TRANSIT_RIB),
      ...extra,
    ],
  }
}

const ESTABLISHED_TEXT: LocalizedText = {
  en: 'This starts where the first option ends. Site A and Site B both announce 203.0.113.0/24 from AS 64511. The ISP has two routes: directly from Site A (AS_PATH 64511) and through the transit provider (64500 64511). It uses the shorter one, so DNS queries from its customers go to Site A.',
  ja: '最初の選択肢が終わったところから始める。拠点 A と拠点 B は、どちらも AS 64511 から 203.0.113.0/24 を広告している。ISP は 2 つの経路を持つ。拠点 A から直接（AS_PATH 64511）と、トランジット事業者を通る経路（64500 64511）。短い方を使うので、利用者の DNS の問い合わせは拠点 A に届く。',
}

// ---------- 状況ごと ----------

function propagateSteps(): Step[] {
  return [
    ...inSection(SECTIONS.session, [
      {
        id: 'setup',
        title: { en: 'Two sites, one address', ja: '2 つの拠点、1 つのアドレス' },
        description: {
          en: `A DNS service runs at two sites, and both have the address ${ADDR.service}. Both sites belong to AS 64511, and each will announce the prefix 203.0.113.0/24 with BGP. Site A is connected directly to your ISP (AS 64496). Site B is connected to a transit provider (AS 64500), which the ISP also buys connectivity from. The sessions between ISP and transit, and transit and Site B, are already up; the transit provider already has Site B’s route.`,
          ja: `DNS のサービスが 2 つの拠点で動いていて、どちらもアドレス ${ADDR.service} を持つ。どちらの拠点も AS 64511 に属し、それぞれ BGP で 203.0.113.0/24 を広告する。拠点 A は ISP（AS 64496）に直接つながる。拠点 B はトランジット事業者（AS 64500）につながり、ISP もそのトランジット事業者から接続を買っている。ISP とトランジット、トランジットと拠点 B のセッションはもうできていて、トランジット事業者は拠点 B の経路をもう持っている。`,
        },
        events: [
          set(ISP, SESSION, 'Idle'),
          set(ISP, FIB, fibTable(fibFor(null))),
          set(SITE_A, SESSION, 'Idle'),
          set(SITE_A, SERVICE, 'up'),
          set(SITE_B, SERVICE, 'up'),
          set(SITE_B, ANNOUNCE, ANNOUNCING),
          set(TRANSIT, RIB, TRANSIT_RIB),
        ],
      },
      {
        id: 'tcp',
        title: {
          en: 'The ISP opens a TCP connection to port 179',
          ja: 'ISP がポート 179 に TCP の接続を開く',
        },
        description: {
          en: 'BGP runs over TCP, port 179. The three segments of the handshake are drawn as one arrow (see the TCP theme). The ISP, which dials, is in Connect; Site A, which listens, is in Active.',
          ja: 'BGP は TCP のポート 179 の上で動く。ハンドシェイクの 3 つのセグメントは 1 本の矢印にまとめる（TCP のテーマを参照）。接続を始める ISP は Connect、待ち受ける拠点 A は Active。',
        },
        events: [
          send({
            id: 'tcp-179',
            from: ISP,
            to: SITE_A,
            label: 'TCP connection to port 179',
            status: 'delivered',
            description: { en: 'SYN, SYN-ACK, ACK.', ja: 'SYN、SYN-ACK、ACK。' },
            fields: toFields([
              { name: 'IP Src', value: ADDR.ispToA },
              { name: 'IP Dst', value: ADDR.siteA },
              { name: 'TCP Dst', value: '179' },
            ]),
          }),
          set(ISP, SESSION, 'Connect'),
          set(SITE_A, SESSION, 'Active'),
        ],
      },
      {
        id: 'open-isp',
        title: { en: 'The ISP sends OPEN', ja: 'ISP が OPEN を送る' },
        description: {
          en: `As soon as TCP is up, each side sends OPEN and waits in OpenSent. The ISP proposes Hold Time ${String(DEFAULT_HOLD_TIME)} s, the default suggested by RFC 4271, and says it can use four-octet AS numbers.`,
          ja: `TCP がつながるとすぐ、両側は OPEN を送り、OpenSent で待つ。ISP は、RFC 4271 が既定として勧める Hold Time ${String(DEFAULT_HOLD_TIME)} 秒を提案し、4 オクテットの AS 番号を使えると伝える。`,
        },
        events: [
          send(openMessage('open-isp', ISP, SITE_A, DEFAULT_HOLD_TIME, ADDR.ispToA)),
          set(ISP, SESSION, 'OpenSent'),
        ],
      },
      {
        id: 'open-a',
        title: {
          en: 'Site A sends OPEN: they agree on 90 seconds',
          ja: '拠点 A が OPEN を送る: 90 秒で合意する',
        },
        description: {
          en: `Site A proposes ${String(HOLD_A)} s. Each side uses the smaller of its own value and the peer’s, so both use ${String(HOLD_TIME)} s: if nothing arrives from the peer for that long, the session is declared dead. KEEPALIVEs are sent every third of that, ${String(KEEPALIVE_S)} s.`,
          ja: `拠点 A は ${String(HOLD_A)} 秒を提案する。両側は自分と相手の値の小さい方を使うので、どちらも ${String(HOLD_TIME)} 秒になる。その間、相手から何も届かなければ、セッションは切れたとみなす。KEEPALIVE はその 3 分の 1 の ${String(KEEPALIVE_S)} 秒ごとに送る。`,
        },
        events: [
          send(openMessage('open-a', SITE_A, ISP, HOLD_A, ADDR.siteA)),
          set(SITE_A, SESSION, 'OpenSent'),
        ],
      },
      {
        id: 'keepalive',
        title: { en: 'KEEPALIVEs confirm: Established', ja: 'KEEPALIVE で確かめる: Established' },
        description: {
          en: 'Each side accepts the peer’s OPEN, answers with a KEEPALIVE and moves to OpenConfirm. Accepting the OPEN sets the Hold Timer to the agreed value, and the peer’s KEEPALIVE restarts it. The session is now Established.',
          ja: '両側は相手の OPEN を受け入れ、KEEPALIVE で答えて OpenConfirm に移る。OPEN を受け入れたところで Hold Timer は合意した値に設定され、相手の KEEPALIVE でやり直しになる。これでセッションは Established。',
        },
        events: [
          send(keepalive('ka-isp', ISP, SITE_A)),
          send(keepalive('ka-a', SITE_A, ISP)),
          set(ISP, SESSION, 'Established'),
          set(SITE_A, SESSION, 'Established'),
          set(ISP, HOLD, `${String(HOLD_TIME)} s`),
        ],
      },
    ]),
    ...inSection(SECTIONS.routes, [
      {
        id: 'update-a',
        title: { en: 'Site A announces 203.0.113.0/24', ja: '拠点 A が 203.0.113.0/24 を広告する' },
        description: {
          en: 'Site A originates the route, so AS_PATH is just its own AS, 64511. NEXT_HOP is its address on this link. The ISP checks that its own AS is not in the path, stores the route, and, as it is the only one, installs it in its forwarding table.',
          ja: '拠点 A が経路を作るので、AS_PATH は自分の AS の 64511 だけ。NEXT_HOP は、このリンクでの自分のアドレス。ISP は、経路に自分の AS がないことを確かめて経路を覚え、ほかにないので転送の表に入れる。',
        },
        events: [
          send(
            announce('update-a', SITE_A, ISP, DIRECT_A.asPath, ADDR.siteA, {
              en: 'An UPDATE announcing the anycast prefix.',
              ja: 'エニーキャストのプレフィックスを広告する UPDATE。',
            }),
          ),
          set(SITE_A, ANNOUNCE, ANNOUNCING),
          ...ispRouting([DIRECT_A]),
        ],
      },
      {
        id: 'update-transit',
        title: {
          en: 'The transit provider passes on Site B’s route',
          ja: 'トランジット事業者が拠点 B の経路を伝える',
        },
        description: {
          en: 'The transit provider already has 203.0.113.0/24 from Site B. When it announces it to the ISP, it adds its own AS on the left (AS_PATH 64500 64511) and puts its own address in NEXT_HOP. The ISP now has two routes for the same prefix. With no local preference configured, the shorter AS_PATH wins: 1 AS against 2. The forwarding table keeps pointing to Site A.',
          ja: 'トランジット事業者は、拠点 B から 203.0.113.0/24 をもう受け取っている。ISP に広告するときは、左端に自分の AS を付け足し（AS_PATH 64500 64511）、NEXT_HOP を自分のアドレスにする。ISP は、同じプレフィックスへの経路を 2 つ持つ。ローカルな優先度を設定していないので、AS_PATH の短い方が勝つ。AS 1 つ対 2 つ。転送の表は拠点 A を指したまま。',
        },
        events: [
          send(
            announce('update-t', TRANSIT, ISP, VIA_TRANSIT.asPath, ADDR.transitToIsp, {
              en: 'Site B’s route, one AS longer.',
              ja: '拠点 B の経路。AS が 1 つ長い。',
            }),
          ),
          ...ispRouting([DIRECT_A, VIA_TRANSIT]),
        ],
      },
      {
        id: 'loop',
        title: {
          en: 'Site B drops its own route coming back',
          ja: '拠点 B は、戻ってきた自分の経路を捨てる',
        },
        description: {
          en: 'The transit provider also announces its best route to its other customer, Site B, which sees its own AS 64511 in the AS_PATH. That is a loop, so Site B does not use the route (RFC 4271 §9.1.2). This check is why AS_PATH exists at all. RFC 4271 puts the check on the receiver; some implementations also avoid sending such routes in the first place.',
          ja: 'トランジット事業者は、もう 1 つの顧客の拠点 B にも最良の経路を広告する。拠点 B は、AS_PATH に自分の AS 64511 を見つける。ループなので、拠点 B はこの経路を使わない（RFC 4271 §9.1.2）。AS_PATH があるのは、そもそもこの確かめのため。RFC 4271 は受け取る側で確かめるとし、そうした経路をはじめから送らない実装もある。',
        },
        events: [
          send(
            announce(
              'update-loop',
              TRANSIT,
              SITE_B,
              VIA_TRANSIT.asPath,
              ADDR.transitToB,
              { en: 'Site B’s own route, coming back.', ja: '戻ってきた拠点 B 自身の経路。' },
              'rejected',
            ),
          ),
          set(SITE_B, DECISION, `drop: own AS ${String(AS.anycast)} in AS_PATH`),
        ],
      },
    ]),
    ...inSection(SECTIONS.data, [
      {
        id: 'query',
        title: { en: 'A DNS query goes to the nearest site', ja: 'DNS の問い合わせは近い拠点へ' },
        description: {
          en: `The PC asks ${ADDR.service}. The ISP’s forwarding table sends 203.0.113.0/24 to ${ADDR.siteA}, so the query reaches Site A. Customers of other networks may reach Site B instead: which site answers depends on where the query comes from. That region is the site’s catchment (RFC 4786).`,
          ja: `PC は ${ADDR.service} に尋ねる。ISP の転送の表は 203.0.113.0/24 を ${ADDR.siteA} に送るので、問い合わせは拠点 A に届く。ほかのネットワークの利用者は、拠点 B に届くかもしれない。どの拠点が答えるかは、問い合わせがどこから来るかで決まる。その範囲を、その拠点の catchment と呼ぶ（RFC 4786）。`,
        },
        events: [...hops('query', [PC, ISP, SITE_A], QUERY)],
      },
      {
        id: 'answer',
        title: { en: 'Site A answers', ja: '拠点 A が答える' },
        description: {
          en: 'The answer comes back from the same anycast address. The PC cannot tell which site answered, unless it asks (see “Try it yourself”).',
          ja: '答えは同じエニーキャストのアドレスから戻る。PC には、尋ねない限り、どの拠点が答えたかわからない（「手元で試す」を参照）。',
        },
        events: [
          ...hops('answer', [SITE_A, ISP, PC], REPLY),
          set(PC, ANSWER, `example.com A ${ADDR.answer} (from Site A)`),
        ],
      },
      {
        id: 'keepalive-30',
        title: { en: 'Every 30 seconds: KEEPALIVE', ja: '30 秒ごとに KEEPALIVE' },
        description: {
          en: `Nothing else needs to be said, so each side sends a KEEPALIVE every ${String(KEEPALIVE_S)} s. Each one that arrives restarts the peer’s Hold Timer. UPDATEs are sent only when something changes.`,
          ja: `ほかに伝えることがないので、両側は ${String(KEEPALIVE_S)} 秒ごとに KEEPALIVE を送る。届くたびに、相手の Hold Timer はやり直しになる。UPDATE は、何かが変わったときだけ送る。`,
        },
        events: [
          timer(ISP, 'KeepaliveTimer', KEEPALIVE_S),
          send(keepalive('ka-isp-30', ISP, SITE_A)),
          send(keepalive('ka-a-30', SITE_A, ISP)),
          set(ISP, HOLD, `${String(HOLD_TIME)} s (restarted)`),
        ],
      },
    ]),
  ]
}

function withdrawSteps(): Step[] {
  const after = removeFrom([DIRECT_A, VIA_TRANSIT], 'Site A')
  return [
    establishedSetup(ESTABLISHED_TEXT),
    ...inSection(SECTIONS.failure, [
      {
        id: 'fail',
        title: { en: 'Site A’s DNS server hangs', ja: '拠点 A の DNS のサーバーが固まる' },
        description: {
          en: 'The DNS server process at Site A hangs and stops answering. The router part keeps running, so BGP still announces the route for a moment.',
          ja: '拠点 A の DNS のサーバーのプロセスが固まって答えなくなる。ルーターの部分は動き続けるので、しばらくは BGP で経路を広告したまま。',
        },
        events: [set(SITE_A, SERVICE, 'down (not answering)')],
      },
      {
        id: 'query-dropped',
        title: {
          en: 'A query still goes to Site A, and gets no answer',
          ja: '問い合わせはまだ拠点 A へ行き、答えがない',
        },
        description: {
          en: 'The route still points to Site A, so the next query goes there, and the hung server never answers it.',
          ja: '経路はまだ拠点 A を指しているので、次の問い合わせもそこへ行き、固まったサーバーは答えない。',
        },
        events: [...hops('dropped', [PC, ISP, SITE_A], QUERY, 'lost')],
      },
      {
        id: 'withdraw',
        title: { en: 'A health check withdraws the route', ja: 'ヘルスチェックが経路を取り下げる' },
        description: {
          en: 'A health check at Site A notices that DNS no longer answers and tells BGP to withdraw 203.0.113.0/24 (RFC 4786 §4.4.1: announce only while the service works). The ISP removes the route from Site A. The route through the transit provider is now the only one, and the forwarding table follows it.',
          ja: '拠点 A のヘルスチェックが、DNS が答えなくなったことに気づき、BGP に 203.0.113.0/24 を取り下げさせる（RFC 4786 §4.4.1: サービスが動いている間だけ広告する）。ISP は拠点 A からの経路を消す。トランジット事業者を通る経路だけが残り、転送の表もそちらに変わる。',
        },
        events: [
          send(withdrawMessage('withdraw')),
          set(SITE_A, ANNOUNCE, 'withdrawn'),
          ...ispRouting(after),
        ],
      },
      {
        id: 'retry',
        title: { en: 'The PC retries: Site B answers', ja: 'PC が送り直す: 拠点 B が答える' },
        description: {
          en: 'The PC’s resolver retries after 2 seconds (RFC 1035 suggests 2 to 5). The same query to the same address now travels through the transit provider to Site B. UDP has no connection to lose, so the retry simply works.',
          ja: 'PC のリゾルバーは 2 秒後に送り直す（RFC 1035 は 2〜5 秒を勧める）。同じアドレスへの同じ問い合わせが、今度はトランジット事業者を通って拠点 B に届く。UDP には失う接続がないので、送り直しはそのまま通る。',
        },
        events: [
          timer(PC, 'DNS retry', 2),
          ...hops('retry', [PC, ISP, nextActorFor(after), SITE_B], QUERY),
          ...hops('answer-b', [SITE_B, TRANSIT, ISP, PC], REPLY),
          set(PC, ANSWER, `example.com A ${ADDR.answer} (from Site B)`),
        ],
      },
    ]),
  ]
}

function holdTimerSteps(): Step[] {
  const after = removeFrom([DIRECT_A, VIA_TRANSIT], 'Site A')
  const left = (seconds: number) => `${String(seconds)} s left`
  return [
    establishedSetup({
      ...ESTABLISHED_TEXT,
      en: `${ESTABLISHED_TEXT.en} The last KEEPALIVE from Site A has just arrived, so the ISP’s Hold Timer is at ${String(HOLD_TIME)} s.`,
      ja: `${ESTABLISHED_TEXT.ja} 拠点 A の最後の KEEPALIVE が届いたところなので、ISP の Hold Timer は ${String(HOLD_TIME)} 秒。`,
    }),
    ...inSection(SECTIONS.failure, [
      {
        id: 'power',
        title: {
          en: 'Site A loses power: nothing is sent',
          ja: '拠点 A の電源が落ちる: 何も送られない',
        },
        description: {
          en: 'The whole site goes dark at once. No withdraw is sent, and the TCP connection is not closed. The ISP has no way to notice yet.',
          ja: '拠点全体が一度に止まる。取り下げは送られず、TCP の接続も閉じられない。ISP には、まだ気づく方法がない。',
        },
        events: [
          set(SITE_A, SERVICE, 'down (power lost)'),
          set(SITE_A, SESSION, '-'),
          set(SITE_A, ANNOUNCE, '-'),
        ],
      },
      {
        id: 'ka-30',
        title: { en: '30 seconds: the KEEPALIVE goes nowhere', ja: '30 秒: KEEPALIVE は届かない' },
        description: {
          en: 'The ISP sends its regular KEEPALIVE, and nothing comes back. Its Hold Timer counts down: 60 s left.',
          ja: 'ISP はいつもの KEEPALIVE を送るが、何も戻らない。Hold Timer は減っていく。残り 60 秒。',
        },
        events: [
          timer(ISP, 'KeepaliveTimer', KEEPALIVE_S),
          send(keepalive('ka-lost-1', ISP, SITE_A, 'lost')),
          set(ISP, HOLD, left(HOLD_TIME - KEEPALIVE_S)),
        ],
      },
      {
        id: 'blackhole',
        title: { en: 'Queries disappear', ja: '問い合わせが消える' },
        description: {
          en: 'The forwarding table still points to Site A, so DNS queries from the ISP’s customers vanish. This is the cost of a silent failure: up to the Hold Time.',
          ja: '転送の表はまだ拠点 A を指しているので、ISP の利用者の DNS の問い合わせは消える。黙って止まったときの代償で、最大で Hold Time だけ続く。',
        },
        events: [...hops('lost', [PC, ISP, SITE_A], QUERY, 'lost')],
      },
      {
        id: 'ka-60',
        title: { en: '60 seconds: still nothing', ja: '60 秒: まだ何もない' },
        description: {
          en: 'Another KEEPALIVE, another silence: 30 s left.',
          ja: 'もう 1 つの KEEPALIVE にも答えがない。残り 30 秒。',
        },
        events: [
          timer(ISP, 'KeepaliveTimer', KEEPALIVE_S),
          send(keepalive('ka-lost-2', ISP, SITE_A, 'lost')),
          set(ISP, HOLD, left(HOLD_TIME - 2 * KEEPALIVE_S)),
        ],
      },
      {
        id: 'expire',
        title: { en: '90 seconds: the Hold Timer expires', ja: '90 秒: Hold Timer が切れる' },
        description: {
          en: 'Nothing has arrived from Site A for 90 seconds. The ISP sends NOTIFICATION with Error Code 4 (Hold Timer Expired), closes the TCP connection, and returns to Idle. Closing the session deletes every route learned over it, so the transit route becomes the best. Operators often use shorter timers or a separate fast failure detection (BFD) to shrink this gap.',
          ja: '拠点 A から 90 秒間何も届かなかった。ISP は Error Code 4（Hold Timer Expired）の NOTIFICATION を送り、TCP の接続を閉じて Idle に戻る。セッションを閉じると、そこで受け取った経路はすべて消えるので、トランジットの経路が最良になる。運用では、この空白を縮めるために、短いタイマーや、別の速い故障の検出（BFD）を使うことが多い。',
        },
        events: [
          timer(ISP, 'HoldTimer', HOLD_TIME - 2 * KEEPALIVE_S),
          send(
            bgp(
              'notification',
              ISP,
              SITE_A,
              'NOTIFICATION',
              notificationLength(0),
              [
                { name: 'Error Code', value: '4 (Hold Timer Expired)', highlight: true },
                { name: 'Error Subcode', value: '0' },
              ],
              {
                en: 'NOTIFICATION, then the session is closed. Site A is not there to receive it.',
                ja: 'NOTIFICATION を送ってからセッションを閉じる。受け取る拠点 A はいない。',
              },
              'lost',
            ),
          ),
          set(ISP, SESSION, 'Idle'),
          set(ISP, HOLD, 'expired'),
          ...ispRouting(after),
        ],
      },
      {
        id: 'retry',
        title: { en: 'Queries reach Site B', ja: '問い合わせが拠点 B に届く' },
        description: {
          en: 'The next query to the same address goes through the transit provider to Site B, and is answered.',
          ja: '同じアドレスへの次の問い合わせは、トランジット事業者を通って拠点 B に届き、答えが返る。',
        },
        events: [
          ...hops('retry', [PC, ISP, nextActorFor(after), SITE_B], QUERY),
          ...hops('answer-b', [SITE_B, TRANSIT, ISP, PC], REPLY),
          set(PC, ANSWER, `example.com A ${ADDR.answer} (from Site B)`),
        ],
      },
    ]),
  ]
}

function routeChangeSteps(): Step[] {
  const prepended = fromA(prepend(DIRECT_A.asPath, AS.anycast, 2))
  const after = replaceFrom([DIRECT_A, VIA_TRANSIT], prepended)
  const seq = CLIENT_ISS + 1
  const ack = SERVER_ISS + 1
  const query: Segment = { toServer: true, flags: 'PSH, ACK', seq, ack, len: TCP_QUERY_LEN }
  const reply: Segment = {
    toServer: false,
    flags: 'PSH, ACK',
    seq: ack,
    ack: seq + TCP_QUERY_LEN,
    len: TCP_ANSWER_LEN,
  }
  const next: Segment = {
    toServer: true,
    flags: 'PSH, ACK',
    seq: seq + TCP_QUERY_LEN,
    ack: ack + TCP_ANSWER_LEN,
    len: TCP_QUERY_LEN,
  }
  // RFC 9293 §3.10.7.1: 接続のない相手への ACK 付きのセグメントには <SEQ=SEG.ACK><CTL=RST>
  const rst: Segment = { toServer: false, flags: 'RST', seq: next.ack, ack: 0, len: 0 }
  const tcpRow = `ESTABLISHED (${ADDR.pc} ↔ ${ADDR.service}:53)`
  return [
    establishedSetup(
      {
        en: `${ESTABLISHED_TEXT.en} The PC has also opened a TCP connection to ${ADDR.service} port 53, to send DNS over TCP, and the connection lives at Site A.`,
        ja: `${ESTABLISHED_TEXT.ja} PC は TCP で DNS を送るため、${ADDR.service} のポート 53 に TCP の接続も開いていて、接続は拠点 A にある。`,
      },
      [set(PC, TCP_STATE, tcpRow), set(SITE_A, TCP_STATE, tcpRow)],
    ),
    ...inSection(SECTIONS.data, [
      {
        id: 'tcp-ok',
        title: { en: 'A query over TCP to Site A', ja: 'TCP での拠点 A への問い合わせ' },
        description: {
          en: 'The PC sends a DNS query on the open connection, and Site A answers. Over TCP, each DNS message is preceded by a two-octet length (RFC 1035 §4.2.2).',
          ja: 'PC は開いた接続で DNS の問い合わせを送り、拠点 A が答える。TCP では、DNS のメッセージの前に 2 オクテットの長さを付ける（RFC 1035 §4.2.2）。',
        },
        events: [
          ...hops('tcp-query', [PC, ISP, SITE_A], segmentPacket(query)),
          ...hops('tcp-reply', [SITE_A, ISP, PC], segmentPacket(reply)),
        ],
      },
    ]),
    ...inSection(SECTIONS.failure, [
      {
        id: 'prepend',
        title: {
          en: 'Site A makes its route longer before maintenance',
          ja: '拠点 A が保守の前に経路を長く見せる',
        },
        description: {
          en: 'To move traffic away gently before maintenance, Site A announces the same prefix again with its own AS three times (AS_PATH 64511 64511 64511). This is prepending. The new announcement replaces the old one from Site A. Now the route through the transit provider is shorter (2 against 3), and the ISP’s forwarding table switches to it.',
          ja: '保守の前に通信をゆっくり移すため、拠点 A は同じプレフィックスを、自分の AS を 3 回並べて広告し直す（AS_PATH 64511 64511 64511）。これがプリペンド。新しい広告は、拠点 A からの古いものに置き換わる。今度はトランジット事業者を通る経路の方が短く（2 対 3）、ISP の転送の表はそちらに変わる。',
        },
        events: [
          send(
            announce('prepend', SITE_A, ISP, prepended.asPath, ADDR.siteA, {
              en: 'The same prefix, with a longer AS_PATH.',
              ja: '同じプレフィックス。AS_PATH が長い。',
            }),
          ),
          set(SITE_A, ANNOUNCE, `${ANYCAST_PREFIX} [${formatAsPath(prepended.asPath)}]`),
          ...ispRouting(after),
        ],
      },
      {
        id: 'tcp-moved',
        title: {
          en: 'The next TCP segment arrives at Site B',
          ja: '次の TCP のセグメントは拠点 B に届く',
        },
        description: {
          en: 'The PC sends its next query on the same connection. The destination address is the same, but the route has changed, so the segment arrives at Site B. Site B has never seen this connection.',
          ja: 'PC は同じ接続で次の問い合わせを送る。宛先のアドレスは同じだが、経路が変わったので、セグメントは拠点 B に届く。拠点 B は、この接続を知らない。',
        },
        events: [...hops('tcp-moved', [PC, ISP, nextActorFor(after), SITE_B], segmentPacket(next))],
      },
      {
        id: 'rst',
        title: {
          en: 'Site B resets it: the connection breaks',
          ja: '拠点 B がリセットする: 接続が切れる',
        },
        description: {
          en: `A TCP host that gets a segment for a connection it does not have answers with a reset (RFC 9293 §3.10.7.1). Its sequence number is the incoming Ack, ${String(next.ack)}, so the PC accepts it and the connection is gone: “connection reset”. With UDP there would be nothing to break. This is why anycast works best for short, connectionless exchanges like DNS over UDP (RFC 7094 §4.2), and why operators keep routing stable for much longer than a typical connection (RFC 4786 §4.1).`,
          ja: `知らない接続へのセグメントを受け取った TCP のホストは、リセットで答える（RFC 9293 §3.10.7.1）。シーケンス番号は届いた Ack の ${String(next.ack)} なので、PC は受け入れ、接続はなくなる。「connection reset」。UDP なら切れるものがない。だからエニーキャストは、UDP の DNS のような、短く接続のないやり取りにいちばん向き（RFC 7094 §4.2）、運用では、経路をふつうの接続よりずっと長く安定させる（RFC 4786 §4.1）。`,
        },
        events: [
          ...hops('rst', [SITE_B, TRANSIT, ISP, PC], segmentPacket(rst)),
          set(PC, TCP_STATE, 'CLOSED (connection reset)'),
        ],
      },
      {
        id: 'udp',
        title: { en: 'A query over UDP simply works', ja: 'UDP の問い合わせはそのまま通る' },
        description: {
          en: 'The PC falls back to UDP. The query reaches Site B, which answers as Site A would have.',
          ja: 'PC は UDP に戻る。問い合わせは拠点 B に届き、拠点 A と同じように答えが返る。',
        },
        events: [
          ...hops('udp-query', [PC, ISP, TRANSIT, SITE_B], QUERY),
          ...hops('udp-answer', [SITE_B, TRANSIT, ISP, PC], REPLY),
          set(PC, ANSWER, `example.com A ${ADDR.answer} (from Site B)`),
        ],
      },
    ]),
  ]
}

function buildSteps(options: BgpAnycastOptions): readonly Step[] {
  const builders: Record<Situation, () => Step[]> = {
    propagate: propagateSteps,
    withdraw: withdrawSteps,
    holdTimer: holdTimerSteps,
    routeChange: routeChangeSteps,
  }
  return builders[options.situation]()
}

export const bgpAnycastScenario: Scenario<BgpAnycastOptions> = {
  id: 'bgp-anycast',
  title: {
    en: 'BGP and anycast: how routes travel, and one address in many places',
    ja: 'BGP とエニーキャスト: 経路が伝わるしくみと、1 つのアドレスを複数の拠点で',
  },
  actors,
  optionDefs: {
    situation: {
      kind: 'select',
      label: { en: 'Situation', ja: '状況' },
      choices: [
        {
          value: 'propagate',
          label: {
            en: 'Sessions, routes and the shorter AS_PATH',
            ja: 'セッション、経路、短い AS_PATH',
          },
        },
        {
          value: 'withdraw',
          label: {
            en: 'Site A’s service fails: withdraw',
            ja: '拠点 A のサービスが止まる: 取り下げ',
          },
        },
        {
          value: 'holdTimer',
          label: {
            en: 'Site A dies silently: Hold Timer',
            ja: '拠点 A が黙って止まる: Hold Timer',
          },
        },
        {
          value: 'routeChange',
          label: {
            en: 'The route changes: TCP breaks, UDP does not',
            ja: '経路が変わる: TCP は切れ、UDP は通る',
          },
        },
      ],
      defaultValue: 'propagate',
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
