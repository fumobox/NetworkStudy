/**
 * IPv6 で LAN につながる: SLAAC と近隣探索
 *
 * 根拠:
 * - RFC 4862 §5.1（DupAddrDetectTransmits の既定は 1）、§5.3（リンクローカルアドレスを作る）、§5.4（重複アドレス検出 DAD。
 *   確かめている間のアドレスは tentative。NS の送信元は ::、宛先は対象の要請ノードマルチキャスト）、§5.4.5（重複が見つかったら使わない）、
 *   §5.5.3（Prefix Information の A フラグからアドレスを作る）
 * - RFC 4861 §4.1〜§4.4（RS 133、RA 134、NS 135、NA 136 の形式。ホップリミットは 255）、§4.6.1（送信元・対象のリンク層アドレスの
 *   オプション）、§4.6.2（Prefix Information）、§6.2.1（既定値: Router Lifetime 1800 秒、有効期間 2592000 秒、推奨期間 604800 秒）、
 *   §6.2.6（要請された RA は、ふつうすべてのノードへのマルチキャスト）、§6.3.4（RA の送信元リンク層アドレスで近隣キャッシュを STALE にする）、
 *   §6.3.7（RS は最大 3 回、4 秒おき）、§7.2.2（アドレス解決は対象の要請ノードマルチキャストへの NS。キャッシュは INCOMPLETE）、
 *   §7.2.4（送信元が :: の NS への NA は、すべてのノードへ）、§7.2.5（NA を受け取ると REACHABLE）、§10（RetransTimer 1 秒、
 *   RTR_SOLICITATION_INTERVAL 4 秒、MAX_RTR_SOLICITATIONS 3、
 *   MAX_RTR_SOLICITATION_DELAY 1 秒。§6.3.7: 最後の RS から 1 秒待っても RA がなければ、ルーターはないとみなす）
 * - RFC 4291 §2.5.6（fe80::/10）、§2.7.1（ff02::1、ff02::2、要請ノードマルチキャスト）、付録 A（EUI-64）
 * - RFC 2464 §3（EtherType 0x86dd）、§4（インターフェース ID）、§7（33:33 で始まるマルチキャストの MAC アドレス）
 * - RFC 4443（ICMPv6）、RFC 8106 §5.1（RDNSS、オプション 25）、RFC 3849（文書用 2001:db8::/32）、RFC 9542（説明用の MAC アドレス）
 *
 * 学習用の単純化: インターフェース ID は EUI-64（実際の OS は RFC 7217 / RFC 8981 のランダムな ID が多い。概要で触れる）。
 * MLD（マルチキャストのグループへの参加の通知）と MLD スヌーピングは描かず、マルチキャストはすべてのポートに届くものとする。
 * DAD と RS の前のランダムな待ち、定期的な RA、DHCPv6（M・O フラグは 0）、NUD の DELAY / PROBE、一時アドレスは扱わない。
 * PC 2 のアドレスの設定（DAD など）は描かない
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
  duplicate: z.stringbool().catch(false),
  router: z.enum(['present', 'none']).catch('present'),
})
export type Ipv6NdOptions = z.infer<typeof optionsSchema>

const PC: ActorId = 'pc'
const ROUTER: ActorId = 'router'
const PC2: ActorId = 'pc2'
const ADDRESSES: StateKey = 'addresses'
const DEFAULT_ROUTER: StateKey = 'defaultRouter'
const DNS: StateKey = 'dns'
const NEIGHBORS: StateKey = 'neighbors'
const GROUPS: StateKey = 'groups'
const LAST_PACKET: StateKey = 'lastPacket'
export const ADDRESS_COLUMNS = ['Address', 'State'] as const
export const NEIGHBOR_COLUMNS = ['Neighbor', 'MAC', 'State'] as const

/** RFC 4861 §10 の定数 */
export const RETRANS_TIMER_MS = 1000
export const RTR_SOLICITATION_INTERVAL_MS = 4000
export const MAX_RTR_SOLICITATIONS = 3
export const MAX_RTR_SOLICITATION_DELAY_MS = 1000

/** アドレス（RFC 3849、RFC 9542 §2.1.2）。インターフェース ID は MAC アドレスからの EUI-64 */
export const HOSTS = {
  pc: {
    mac: '00:00:5e:00:53:0a',
    linkLocal: 'fe80::200:5eff:fe00:530a',
    global: '2001:db8:1:0:200:5eff:fe00:530a',
    solicited: 'ff02::1:ff00:530a',
    solicitedMac: '33:33:ff:00:53:0a',
  },
  router: {
    mac: '00:00:5e:00:53:01',
    linkLocal: 'fe80::200:5eff:fe00:5301',
    prefix: '2001:db8:1::/64',
    dns: '2001:db8:1::53',
  },
  pc2: {
    mac: '00:00:5e:00:53:14',
    global: '2001:db8:1:0:200:5eff:fe00:5314',
    solicited: 'ff02::1:ff00:5314',
    solicitedMac: '33:33:ff:00:53:14',
  },
} as const
const ALL_NODES = 'ff02::1'
const ALL_ROUTERS = 'ff02::2'
const ALL_NODES_MAC = '33:33:00:00:00:01'
const ALL_ROUTERS_MAC = '33:33:00:00:00:02'

const lastPacketSlot = {
  key: LAST_PACKET,
  label: { en: 'Last packet on the link', ja: 'リンクで最後に受け取ったパケット' },
  initial: '-',
}

const actors: readonly Actor[] = [
  {
    id: PC,
    kind: 'client',
    name: { en: 'Your PC (00:00:5e:00:53:0a)', ja: 'PC（00:00:5e:00:53:0a）' },
    shortName: { en: 'PC', ja: 'PC' },
    stateSlots: [
      {
        key: ADDRESSES,
        label: { en: 'IPv6 addresses', ja: 'IPv6 アドレス' },
        initial: { columns: ADDRESS_COLUMNS, rows: [] },
      },
      {
        key: GROUPS,
        label: { en: 'Multicast groups joined', ja: '参加しているマルチキャストのグループ' },
        initial: '-',
      },
      {
        key: DEFAULT_ROUTER,
        label: { en: 'Default router', ja: 'デフォルトルーター' },
        initial: '-',
      },
      { key: DNS, label: { en: 'DNS server', ja: 'DNS サーバー' }, initial: '-' },
      {
        key: NEIGHBORS,
        label: { en: 'Neighbor cache', ja: '近隣キャッシュ' },
        initial: { columns: NEIGHBOR_COLUMNS, rows: [] },
      },
    ],
  },
  {
    id: ROUTER,
    kind: 'router',
    name: { en: 'Router (fe80::200:5eff:fe00:5301)', ja: 'ルーター（fe80::200:5eff:fe00:5301）' },
    shortName: { en: 'Router', ja: 'ルーター' },
    stateSlots: [
      {
        key: NEIGHBORS,
        label: { en: 'Neighbor cache', ja: '近隣キャッシュ' },
        initial: { columns: NEIGHBOR_COLUMNS, rows: [] },
      },
      lastPacketSlot,
    ],
  },
  {
    id: PC2,
    kind: 'client',
    name: { en: 'Another PC (00:00:5e:00:53:14)', ja: '別の PC（00:00:5e:00:53:14）' },
    shortName: { en: 'PC 2', ja: 'PC 2' },
    stateSlots: [lastPacketSlot],
  },
]

const set = (actorId: ActorId, key: StateKey, value: string | StateTable): StepEvent => ({
  kind: 'stateChange',
  actorId,
  key,
  value,
})
const send = (message: Message): StepEvent => ({ kind: 'message', message })
const retransTimer: StepEvent = {
  kind: 'timer',
  actorId: PC,
  name: 'RetransTimer',
  durationMs: RETRANS_TIMER_MS,
}

const addressTable = (rows: readonly (readonly [string, string])[]): StateTable => ({
  columns: ADDRESS_COLUMNS,
  rows,
})
const neighborTable = (rows: readonly (readonly [string, string, string])[]): StateTable => ({
  columns: NEIGHBOR_COLUMNS,
  rows,
})

const FIELD_TEXT = {
  hopLimit: {
    en: 'Neighbor Discovery messages always use 255, so a receiver can tell they were not forwarded by a router',
    ja: '近隣探索のメッセージはいつも 255。受け取った側は、ルーターを越えてきたものではないとわかる',
  },
  multicastMac: {
    en: 'The multicast MAC address: 33:33 and the last 32 bits of the IPv6 destination. Only NICs that joined the group accept it',
    ja: 'マルチキャストの MAC アドレス。33:33 と、IPv6 の宛先の下位 32 ビット。グループに参加している NIC だけが受け取る',
  },
  unspecified: {
    en: 'The unspecified address: the PC may not use its address before DAD succeeds',
    ja: '未指定アドレス。DAD が終わるまで、PC は自分のアドレスを使えない',
  },
} satisfies Record<string, LocalizedText>

interface IcmpSpec {
  readonly label: string
  readonly ethDst: string
  readonly src: string
  readonly dst: string
  readonly type: string
  readonly fields: readonly PacketField[]
}

function icmp(
  id: string,
  from: ActorId,
  to: ActorId,
  spec: IcmpSpec,
  status: Message['status'] = 'delivered',
): Message {
  return {
    id,
    from,
    to,
    label: spec.label,
    status,
    fields: [
      {
        name: 'Eth Dst',
        value: spec.ethDst,
        ...(spec.ethDst.startsWith('33:33') ? { description: FIELD_TEXT.multicastMac } : {}),
      },
      { name: 'EtherType', value: '0x86dd (IPv6)' },
      {
        name: 'IPv6 Src',
        value: spec.src,
        ...(spec.src === '::' ? { highlight: true, description: FIELD_TEXT.unspecified } : {}),
      },
      { name: 'IPv6 Dst', value: spec.dst, highlight: true },
      { name: 'Hop Limit', value: '255', description: FIELD_TEXT.hopLimit },
      { name: 'ICMPv6 type', value: spec.type },
      ...spec.fields,
    ],
  }
}

/** マルチキャストを、ほかのすべてのレーンに描く（受け取って処理する機器は delivered、NIC が捨てるか、受け取っても処理しない機器は rejected） */
function multicast(
  id: string,
  from: ActorId,
  spec: IcmpSpec,
  members: Readonly<Partial<Record<ActorId, boolean>>>,
): StepEvent[] {
  return [PC, ROUTER, PC2]
    .filter((actor) => actor !== from)
    .map((actor) =>
      send(
        icmp(
          `${id}-${actor}`,
          from,
          actor,
          spec,
          members[actor] === true ? 'delivered' : 'rejected',
        ),
      ),
    )
}

function dadSpec(target: string, label: string): IcmpSpec {
  return {
    label,
    ethDst: HOSTS.pc.solicitedMac,
    src: '::',
    dst: HOSTS.pc.solicited,
    type: '135 (Neighbor Solicitation)',
    fields: [
      {
        name: 'Target',
        value: target,
        highlight: true,
        description: {
          en: 'The address the PC wants to use: “is anyone already using this?”',
          ja: 'PC が使いたいアドレス。「すでに誰か使っている？」と尋ねる',
        },
      },
    ],
  }
}

function buildSteps(options: Ipv6NdOptions): readonly Step[] {
  const { duplicate, router } = options
  const hasRouter = router === 'present'
  const pcGroups = `${ALL_NODES}, ${HOSTS.pc.solicited}`

  const steps: Step[] = [
    {
      id: 'link-local',
      title: {
        en: 'The PC makes a link-local address from its MAC address',
        ja: 'PC が MAC アドレスからリンクローカルアドレスを作る',
      },
      description: {
        en: 'Without asking anyone, the PC combines fe80::/64 with an interface ID made from its MAC address (EUI-64): fe80::200:5eff:fe00:530a. The address is tentative until the PC has checked that nobody else uses it. It joins the all-nodes group and the solicited-node group of the address, whose multicast MAC address its NIC will now accept.',
        ja: 'PC は誰にも尋ねずに、fe80::/64 と、MAC アドレスから作ったインターフェース ID（EUI-64）を組み合わせる。fe80::200:5eff:fe00:530a。ほかに使っている機器がないと確かめるまでは、このアドレスは tentative（仮）。PC は、すべてのノードのグループと、このアドレスの要請ノードマルチキャストのグループに参加し、NIC はそのマルチキャストの MAC アドレスを受け取るようになる。',
      },
      events: [
        set(PC, ADDRESSES, addressTable([[HOSTS.pc.linkLocal, 'tentative']])),
        set(PC, GROUPS, pcGroups),
      ],
    },
    {
      id: 'dad',
      title: {
        en: 'Duplicate address detection (DAD)',
        ja: '重複アドレス検出（DAD）',
      },
      description: duplicate
        ? {
            en: 'The PC sends a Neighbor Solicitation for its own tentative address, from the unspecified address :: to the solicited-node group. PC 2 has been configured with the same address, so it is in that group and receives the question. The router is not in the group, and its NIC drops the frame.',
            ja: 'PC は仮のアドレスについて、未指定アドレス :: から要請ノードマルチキャストのグループへ Neighbor Solicitation を送る。PC 2 は同じアドレスが設定されているので、そのグループにいて質問を受け取る。ルーターはグループにいないので、NIC がフレームを捨てる。',
          }
        : {
            en: 'The PC sends a Neighbor Solicitation for its own tentative address, from the unspecified address :: to the solicited-node group ff02::1:ff00:530a. Unlike an ARP broadcast, only devices whose address ends in the same 24 bits join that group; here nobody does, so every NIC drops the frame. After one second (RetransTimer) without an answer, the address becomes preferred and usable.',
            ja: 'PC は仮のアドレスについて、未指定アドレス :: から要請ノードマルチキャストのグループ ff02::1:ff00:530a へ Neighbor Solicitation を送る。ARP のブロードキャストと違い、このグループに入るのは、アドレスの下位 24 ビットが同じ機器だけ。ここには誰もいないので、どの NIC もフレームを捨てる。1 秒（RetransTimer）待っても答えがないので、アドレスは preferred になり、使えるようになる。',
          },
      events: [
        ...multicast('dad-ll', PC, dadSpec(HOSTS.pc.linkLocal, `NS (DAD) ${HOSTS.pc.linkLocal}`), {
          pc2: duplicate,
        }),
        ...(duplicate
          ? []
          : [retransTimer, set(PC, ADDRESSES, addressTable([[HOSTS.pc.linkLocal, 'preferred']]))]),
      ],
    },
  ]

  if (duplicate) {
    steps.push(
      {
        id: 'duplicate-na',
        title: {
          en: 'PC 2 answers: the address is taken',
          ja: 'PC 2 が答える: アドレスは使われている',
        },
        description: {
          en: 'PC 2 answers with a Neighbor Advertisement. Because the question came from ::, the PC has no address to reply to, so the answer goes to all nodes (ff02::1). The router receives it too but has nothing to do with it.',
          ja: 'PC 2 は Neighbor Advertisement で答える。質問の送信元が :: で、返す宛先のアドレスがないので、答えはすべてのノード（ff02::1）に送る。ルーターも受け取るが、関係がないので何もしない。',
        },
        events: multicast(
          'duplicate-na',
          PC2,
          {
            label: `NA ${HOSTS.pc.linkLocal}`,
            ethDst: ALL_NODES_MAC,
            src: HOSTS.pc.linkLocal,
            dst: ALL_NODES,
            type: '136 (Neighbor Advertisement)',
            fields: [
              { name: 'Target', value: HOSTS.pc.linkLocal, highlight: true },
              { name: 'Flags', value: 'R 0, S 0, O 1' },
              { name: 'Target link-layer address', value: HOSTS.pc2.mac },
            ],
          },
          { pc: true },
        ),
      },
      {
        id: 'duplicate-found',
        title: { en: 'The PC gives up the address', ja: 'PC はアドレスをあきらめる' },
        description: {
          en: 'The address is duplicated, so the PC must not use it. With an EUI-64 interface ID the OS should stop using the address, and may disable IPv6 on the interface, and logs an error; with random interface IDs (RFC 7217) it can try another one. A duplicated MAC-based address usually means a duplicated MAC address (such as a cloned virtual machine) or a manually configured address.',
          ja: 'アドレスが重複しているので、PC はそれを使ってはいけない。EUI-64 のインターフェース ID なら、OS はそのアドレスを使うのをやめ（インターフェースの IPv6 を止めることもある）、エラーを記録する。ランダムなインターフェース ID（RFC 7217）なら、別の ID を試せる。MAC アドレスから作ったアドレスが重なるのは、ふつう MAC アドレスの重複（複製した仮想マシンなど）か、手で設定したアドレスが原因。',
        },
        events: [set(PC, ADDRESSES, addressTable([[HOSTS.pc.linkLocal, 'duplicate']]))],
      },
    )
    return steps
  }

  const rsSpec: IcmpSpec = {
    label: `RS → ${ALL_ROUTERS}`,
    ethDst: ALL_ROUTERS_MAC,
    src: HOSTS.pc.linkLocal,
    dst: ALL_ROUTERS,
    type: '133 (Router Solicitation)',
    fields: [{ name: 'Source link-layer address', value: HOSTS.pc.mac }],
  }

  if (!hasRouter) {
    for (let attempt = 1; attempt <= MAX_RTR_SOLICITATIONS; attempt++) {
      steps.push({
        id: `rs-${String(attempt)}`,
        title: {
          en: `The PC asks for routers (${String(attempt)} of ${String(MAX_RTR_SOLICITATIONS)})`,
          ja: `PC がルーターを探す（${String(MAX_RTR_SOLICITATIONS)} 回中 ${String(attempt)} 回目）`,
        },
        description:
          attempt === 1
            ? {
                en: 'The PC sends a Router Solicitation to all routers (ff02::2). There is no router on this LAN, so nobody answers. PC 2 is not a router and its NIC drops the frame.',
                ja: 'PC はすべてのルーター（ff02::2）へ Router Solicitation を送る。この LAN にはルーターがないので、誰も答えない。PC 2 はルーターではないので、NIC がフレームを捨てる。',
              }
            : {
                en: 'After 4 seconds without a Router Advertisement, the PC asks again. It sends at most three Router Solicitations.',
                ja: '4 秒待っても Router Advertisement が来ないので、もう一度尋ねる。Router Solicitation は最大 3 回まで送る。',
              },
        events: [
          ...(attempt === 1
            ? []
            : [
                {
                  kind: 'timer',
                  actorId: PC,
                  name: 'RTR_SOLICITATION_INTERVAL',
                  durationMs: RTR_SOLICITATION_INTERVAL_MS,
                } satisfies StepEvent,
              ]),
          ...multicast(`rs-${String(attempt)}`, PC, rsSpec, {}),
        ],
      })
    }
    steps.push({
      id: 'no-router',
      title: { en: 'No router: link-local only', ja: 'ルーターがない: リンクローカルだけ' },
      description: {
        en: 'One second after the third Router Solicitation there is still no Router Advertisement, so the PC concludes there is no router. It has no global address and no default router. It can still talk to other devices on the same LAN with link-local addresses, but it cannot reach the Internet over IPv6.',
        ja: '3 回目の Router Solicitation から 1 秒たっても Router Advertisement が来ないので、PC はルーターがないと判断する。PC にはグローバルアドレスもデフォルトルーターもない。リンクローカルアドレスで同じ LAN の機器とは話せるが、IPv6 でインターネットには出られない。',
      },
      events: [
        {
          kind: 'timer',
          actorId: PC,
          name: 'MAX_RTR_SOLICITATION_DELAY',
          durationMs: MAX_RTR_SOLICITATION_DELAY_MS,
        },
        set(PC, DEFAULT_ROUTER, '-'),
      ],
    })
    return steps
  }

  const routerEntryForPc = neighborTable([[HOSTS.pc.linkLocal, HOSTS.pc.mac, 'STALE']])
  const pcRouterEntry: readonly [string, string, string] = [
    HOSTS.router.linkLocal,
    HOSTS.router.mac,
    'STALE',
  ]

  steps.push(
    {
      id: 'rs',
      title: { en: 'The PC asks for routers (RS)', ja: 'PC がルーターを探す（RS）' },
      description: {
        en: 'The PC sends a Router Solicitation to all routers (ff02::2), including its own MAC address. The router is in that group; PC 2 is not, and its NIC drops the frame. The router notes the PC’s MAC address in its neighbor cache (STALE: known but not yet confirmed).',
        ja: 'PC はすべてのルーター（ff02::2）へ、自分の MAC アドレスを入れた Router Solicitation を送る。ルーターはこのグループにいる。PC 2 はいないので、NIC がフレームを捨てる。ルーターは PC の MAC アドレスを近隣キャッシュに記録する（STALE: 知っているが、まだ確かめていない）。',
      },
      events: [
        ...multicast('rs', PC, rsSpec, { router: true }),
        set(ROUTER, NEIGHBORS, routerEntryForPc),
      ],
    },
    {
      id: 'ra',
      title: {
        en: 'The router advertises the prefix (RA)',
        ja: 'ルーターがプレフィックスを知らせる（RA）',
      },
      description: {
        en: 'The router answers with a Router Advertisement to all nodes, so PC 2 receives it too. It carries the prefix 2001:db8:1::/64 with the A flag (“build your own address from this”), the router’s lifetime, a DNS server (RDNSS), and the router’s MAC address. M and O are 0: no DHCPv6 is needed. The PC’s default router is the router’s link-local address.',
        ja: 'ルーターはすべてのノードへ Router Advertisement で答えるので、PC 2 も受け取る。プレフィックス 2001:db8:1::/64 と A フラグ（「ここから自分でアドレスを作って」）、ルーターの有効期間、DNS サーバー（RDNSS）、ルーターの MAC アドレスが入っている。M と O は 0 で、DHCPv6 は要らない。PC のデフォルトルーターは、ルーターのリンクローカルアドレスになる。',
      },
      events: [
        ...multicast(
          'ra',
          ROUTER,
          {
            label: `RA ${HOSTS.router.prefix}`,
            ethDst: ALL_NODES_MAC,
            src: HOSTS.router.linkLocal,
            dst: ALL_NODES,
            type: '134 (Router Advertisement)',
            fields: [
              { name: 'Cur Hop Limit', value: '64' },
              {
                name: 'Flags',
                value: 'M 0, O 0',
                description: {
                  en: 'M (managed) and O (other): whether to use DHCPv6 for addresses or other settings',
                  ja: 'M（managed）と O（other）。アドレスやほかの設定に DHCPv6 を使うか',
                },
              },
              { name: 'Router Lifetime', value: '1800 s' },
              {
                name: 'Prefix Information',
                value: `${HOSTS.router.prefix}, L 1, A 1, valid 2592000 s, preferred 604800 s`,
                highlight: true,
                description: {
                  en: 'L: the prefix is on this link. A: hosts may build their own address from it (SLAAC)',
                  ja: 'L はこのリンクのプレフィックスであること、A はホストがここから自分でアドレスを作ってよいこと（SLAAC）',
                },
              },
              { name: 'RDNSS', value: HOSTS.router.dns },
              { name: 'Source link-layer address', value: HOSTS.router.mac },
            ],
          },
          { pc: true, pc2: true },
        ),
        set(PC, DEFAULT_ROUTER, HOSTS.router.linkLocal),
        set(PC, DNS, HOSTS.router.dns),
        set(PC, NEIGHBORS, neighborTable([pcRouterEntry])),
        set(PC2, LAST_PACKET, 'RA'),
      ],
    },
    {
      id: 'slaac',
      title: {
        en: 'SLAAC: the PC builds its global address and checks it',
        ja: 'SLAAC: PC がグローバルアドレスを作り、確かめる',
      },
      description: {
        en: 'The PC combines the prefix 2001:db8:1::/64 with its interface ID: 2001:db8:1:0:200:5eff:fe00:530a. This is stateless address autoconfiguration (SLAAC): no server hands out the address. It runs DAD again for the new address; the solicited-node group is the same, because it depends only on the last 24 bits.',
        ja: 'PC はプレフィックス 2001:db8:1::/64 と自分のインターフェース ID を組み合わせる。2001:db8:1:0:200:5eff:fe00:530a。これがステートレスアドレス自動設定（SLAAC）で、アドレスを配るサーバーはいない。新しいアドレスについても DAD を行う。要請ノードマルチキャストのグループは下位 24 ビットだけで決まるので、同じグループになる。',
      },
      events: [
        set(
          PC,
          ADDRESSES,
          addressTable([
            [HOSTS.pc.linkLocal, 'preferred'],
            [HOSTS.pc.global, 'tentative'],
          ]),
        ),
        ...multicast('dad-global', PC, dadSpec(HOSTS.pc.global, 'NS (DAD, global address)'), {}),
        retransTimer,
        set(
          PC,
          ADDRESSES,
          addressTable([
            [HOSTS.pc.linkLocal, 'preferred'],
            [HOSTS.pc.global, 'preferred'],
          ]),
        ),
      ],
    },
    {
      id: 'resolve',
      title: {
        en: 'To reach PC 2, the PC resolves its MAC address (NS)',
        ja: 'PC 2 に送るため、MAC アドレスを調べる（NS）',
      },
      description: {
        en: 'The PC wants to send to PC 2’s address, which is in the on-link prefix. It does not know PC 2’s MAC address, so it sends a Neighbor Solicitation to PC 2’s solicited-node group ff02::1:ff00:5314. This replaces ARP: only PC 2 is in that group, and the router’s NIC drops the frame.',
        ja: 'PC は PC 2 のアドレスに送りたい。このリンクのプレフィックスの中のアドレスだが、PC 2 の MAC アドレスを知らないので、PC 2 の要請ノードマルチキャストのグループ ff02::1:ff00:5314 へ Neighbor Solicitation を送る。これが ARP の代わり。このグループにいるのは PC 2 だけで、ルーターの NIC はフレームを捨てる。',
      },
      events: [
        ...multicast(
          'resolve',
          PC,
          {
            label: 'NS target …:fe00:5314',
            ethDst: HOSTS.pc2.solicitedMac,
            src: HOSTS.pc.global,
            dst: HOSTS.pc2.solicited,
            type: '135 (Neighbor Solicitation)',
            fields: [
              { name: 'Target', value: HOSTS.pc2.global, highlight: true },
              { name: 'Source link-layer address', value: HOSTS.pc.mac },
            ],
          },
          { pc2: true },
        ),
        set(PC, NEIGHBORS, neighborTable([pcRouterEntry, [HOSTS.pc2.global, '-', 'INCOMPLETE']])),
        set(PC2, LAST_PACKET, 'NS'),
      ],
    },
    {
      id: 'na',
      title: {
        en: 'PC 2 answers with its MAC address (NA)',
        ja: 'PC 2 が MAC アドレスを答える（NA）',
      },
      description: {
        en: 'PC 2 replies directly to the PC with a Neighbor Advertisement carrying its MAC address. The S flag says it answers a solicitation, so the PC marks the entry REACHABLE.',
        ja: 'PC 2 は Neighbor Advertisement で、自分の MAC アドレスを PC に直接答える。S フラグは質問への答えであることを示すので、PC は行を REACHABLE にする。',
      },
      events: [
        send(
          icmp('na', PC2, PC, {
            label: `NA is-at ${HOSTS.pc2.mac}`,
            ethDst: HOSTS.pc.mac,
            src: HOSTS.pc2.global,
            dst: HOSTS.pc.global,
            type: '136 (Neighbor Advertisement)',
            fields: [
              { name: 'Target', value: HOSTS.pc2.global },
              {
                name: 'Flags',
                value: 'R 0, S 1, O 1',
                description: {
                  en: 'R: sent by a router. S: an answer to a solicitation. O: override the cached MAC address',
                  ja: 'R はルーターから、S は質問への答え、O は記録している MAC アドレスを上書きすること',
                },
              },
              { name: 'Target link-layer address', value: HOSTS.pc2.mac, highlight: true },
            ],
          }),
        ),
        set(
          PC,
          NEIGHBORS,
          neighborTable([pcRouterEntry, [HOSTS.pc2.global, HOSTS.pc2.mac, 'REACHABLE']]),
        ),
      ],
    },
    {
      id: 'send',
      title: { en: 'The PC sends the packet', ja: 'PC がパケットを送る' },
      description: {
        en: 'Now the PC knows PC 2’s MAC address and sends the IPv6 packet to it. The whole setup worked without DHCP and without any broadcast. Packets for the Internet would go to the default router, whose MAC address the PC already learned from the Router Advertisement.',
        ja: 'PC は PC 2 の MAC アドレスを知ったので、そこへ IPv6 のパケットを送る。ここまでの設定は、DHCP もブロードキャストも使わずに済んだ。インターネット宛てのパケットは、Router Advertisement ですでに MAC アドレスを知ったデフォルトルーターに送る。',
      },
      events: [
        send({
          id: 'send',
          from: PC,
          to: PC2,
          label: `IPv6 → ${HOSTS.pc2.global}`,
          status: 'delivered',
          fields: [
            { name: 'Eth Dst', value: HOSTS.pc2.mac },
            { name: 'EtherType', value: '0x86dd (IPv6)' },
            { name: 'IPv6 Src', value: HOSTS.pc.global },
            { name: 'IPv6 Dst', value: HOSTS.pc2.global },
            { name: 'Hop Limit', value: '64' },
          ],
        }),
        set(PC2, LAST_PACKET, 'IPv6'),
      ],
    },
  )
  return steps
}

export const ipv6NdScenario: Scenario<Ipv6NdOptions> = {
  id: 'ipv6-nd',
  title: {
    en: 'IPv6 on the LAN: SLAAC and Neighbor Discovery',
    ja: 'IPv6 で LAN につながる: SLAAC と近隣探索',
  },
  actors,
  optionDefs: {
    duplicate: {
      kind: 'toggle',
      label: {
        en: 'PC 2 already uses the same link-local address',
        ja: 'PC 2 が同じリンクローカルアドレスをすでに使っている',
      },
      defaultValue: false,
    },
    router: {
      kind: 'select',
      label: { en: 'Router on the LAN', ja: 'LAN のルーター' },
      choices: [
        {
          value: 'present',
          label: { en: 'A router advertises a prefix', ja: 'ルーターがプレフィックスを知らせる' },
        },
        { value: 'none', label: { en: 'No router', ja: 'ルーターなし' } },
      ],
      defaultValue: 'present',
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
