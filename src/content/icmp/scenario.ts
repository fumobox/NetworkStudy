/**
 * ICMP: ping と traceroute
 *
 * 根拠:
 * - RFC 792: Echo（type 8）と Echo Reply（type 0）、Time Exceeded（type 11、code 0 = 転送中に TTL が 0 になった）、
 *   Destination Unreachable（type 3。code 1 = host unreachable、code 3 = port unreachable）、エラーには元の IP ヘッダーと先頭の 8 バイトを入れる
 * - RFC 1122 §3.2.1.7: ホストは TTL が 1 のパケットを受け取ってもよい（TTL を減らすのは転送するときだけ）
 * - RFC 1122 §3.2.2.6: Echo Reply は Identifier・Sequence Number・データを Echo Request と同じにして返す
 * - RFC 1122 §4.1.3.1: 待ち受けていない UDP のポートへのデータには、Port Unreachable を返すべき
 * - RFC 1812 §5.3.1: ルーターは転送のたびに TTL を 1 減らし、0 になったら捨てて Time Exceeded を返さなければならない
 * - RFC 1812 §4.3.2.4: ICMP のエラーの送信元アドレスは、そのルーターのインターフェースのアドレス
 * - RFC 1812 §4.3.2.8: ICMP のエラーを送る量は制限してよい（traceroute の * の原因になる）
 * - RFC 1812 §4.3.3.1: 宛先のホストに届けられないときの Destination Unreachable（code 1）
 *
 * 学習用の単純化: NAT は無視し、PC のプライベートアドレスをそのまま描く（実際はルーターが変換する。NAT のテーマを参照）。
 * traceroute はホップごとに 1 回だけ送る（実際は 3 回）。往復時間（RTT）とチェックサムは描かない。ルーターは 2 台だけ
 */
import { z } from 'zod'
import type {
  Actor,
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
  tool: z.enum(['ping', 'traceroute']).catch('ping'),
  outcome: z.enum(['reply', 'hostUnreachable', 'noReply']).catch('reply'),
  probe: z.enum(['icmp', 'udp']).catch('icmp'),
})
export type IcmpOptions = z.infer<typeof optionsSchema>

const PC = 'pc'
const ROUTER = 'router'
const ISP = 'isp'
const SERVER = 'server'
/** 往路の順（PC → ルーター → ISP のルーター → サーバー） */
const PATH = [PC, ROUTER, ISP, SERVER] as const
type Node = (typeof PATH)[number]

export const ADDRESSES: Readonly<Record<Node, string>> = {
  pc: '192.168.1.10',
  router: '192.168.1.1',
  isp: '203.0.113.1',
  server: '192.0.2.10',
}
const RESULTS: StateKey = 'results'
const RESULT_COLUMNS = ['#', 'From', 'Result'] as const
/** 送り始めの TTL（Linux などの既定。Windows は 128） */
const INITIAL_TTL = 64
const IDENTIFIER = '0x1234'
/** ping を送る間隔 */
const PING_INTERVAL_MS = 1000
/** traceroute が 1 つのプローブの応答を待つ時間（Linux の traceroute の既定） */
const PROBE_TIMEOUT_MS = 5000
/** traceroute の UDP のプローブの送信元と、最初の宛先のポート（Linux の traceroute の既定） */
const UDP_SOURCE_PORT = 49153
const UDP_FIRST_PORT = 33434

const table = (rows: readonly (readonly string[])[]): StateTable => ({
  columns: RESULT_COLUMNS,
  rows,
})

const actors: readonly Actor[] = [
  {
    id: PC,
    kind: 'client',
    name: { en: 'Your PC (192.168.1.10)', ja: 'PC（192.168.1.10）' },
    shortName: { en: 'PC', ja: 'PC' },
    stateSlots: [
      {
        key: RESULTS,
        label: { en: 'Output of the command', ja: 'コマンドの出力' },
        initial: table([]),
      },
    ],
  },
  {
    id: ROUTER,
    kind: 'router',
    name: { en: 'Home router (192.168.1.1)', ja: '家庭のルーター（192.168.1.1）' },
    shortName: { en: 'Router', ja: 'ルーター' },
    stateSlots: [],
  },
  {
    id: ISP,
    kind: 'router',
    name: { en: 'ISP router (203.0.113.1)', ja: 'ISP のルーター（203.0.113.1）' },
    shortName: { en: 'ISP', ja: 'ISP' },
    stateSlots: [],
  },
  {
    id: SERVER,
    kind: 'server',
    name: { en: 'www.example.com (192.0.2.10)', ja: 'www.example.com（192.0.2.10）' },
    shortName: { en: 'Server', ja: 'サーバー' },
    stateSlots: [],
  },
]

const NAMES: Readonly<Record<Node, LocalizedText>> = {
  pc: { en: 'the PC', ja: 'PC' },
  router: { en: 'the home router', ja: '家庭のルーター' },
  isp: { en: 'the ISP router', ja: 'ISP のルーター' },
  server: { en: 'the server', ja: 'サーバー' },
}

const send = (message: Message): StepEvent => ({ kind: 'message', message })
const timer = (name: string, durationMs: number): StepEvent => ({
  kind: 'timer',
  actorId: PC,
  name,
  durationMs,
})

/** 送るもの（ICMP の Echo か、UDP のプローブ）と、その答え */
type PacketKind =
  | { readonly kind: 'echo'; readonly seq: number }
  | { readonly kind: 'udp'; readonly port: number }
  | { readonly kind: 'echoReply'; readonly seq: number }
  | { readonly kind: 'timeExceeded' }
  | { readonly kind: 'unreachable'; readonly code: 1 | 3 }

function labelOf(packet: PacketKind): string {
  switch (packet.kind) {
    case 'echo':
      return `Echo Request seq=${String(packet.seq)}`
    case 'udp':
      return `UDP → port ${String(packet.port)}`
    case 'echoReply':
      return `Echo Reply seq=${String(packet.seq)}`
    case 'timeExceeded':
      return 'Time Exceeded'
    case 'unreachable':
      return 'Destination Unreachable'
  }
}

function packetFields(packet: PacketKind): PacketField[] {
  const typeCode = (type: number, code: number, meaning: LocalizedText): PacketField[] => [
    {
      name: 'ICMP type / code',
      value: `${String(type)} / ${String(code)}`,
      highlight: true,
      description: meaning,
    },
  ]
  const idSeq = (seq: number): PacketField[] => [
    {
      name: 'Identifier / Sequence',
      value: `${IDENTIFIER} / ${String(seq)}`,
      description: {
        en: 'Chosen by ping to match replies to requests; the reply carries the same values',
        ja: 'ping が要求と応答を対応づけるための値。応答にも同じ値が入る',
      },
    },
  ]
  const original: PacketField = {
    name: 'Original datagram',
    value: 'IP header + first 8 bytes',
    description: {
      en: 'The start of the packet that caused the error, so the sender can tell which one it was',
      ja: 'エラーの原因になったパケットの先頭。送った側が、どのパケットのことかわかるようにする',
    },
  }
  switch (packet.kind) {
    case 'echo':
      return [
        ...typeCode(8, 0, { en: 'Echo Request', ja: 'エコー要求' }),
        ...idSeq(packet.seq),
        { name: 'Data', value: '56 bytes' },
      ]
    case 'echoReply':
      return [
        ...typeCode(0, 0, { en: 'Echo Reply', ja: 'エコー応答' }),
        ...idSeq(packet.seq),
        { name: 'Data', value: '56 bytes' },
      ]
    case 'udp':
      return [
        {
          name: 'UDP port',
          value: `${String(UDP_SOURCE_PORT)} → ${String(packet.port)}`,
          highlight: true,
          description: {
            en: 'A high port where nothing is likely to listen; traceroute adds 1 for each probe',
            ja: '誰も待ち受けていないはずの大きい番号のポート。traceroute はプローブごとに 1 ずつ増やす',
          },
        },
      ]
    case 'timeExceeded':
      return [
        ...typeCode(11, 0, {
          en: 'Time Exceeded: TTL reached 0 while forwarding',
          ja: 'Time Exceeded。転送中に TTL が 0 になった',
        }),
        original,
      ]
    case 'unreachable':
      return [
        ...typeCode(
          3,
          packet.code,
          packet.code === 1
            ? {
                en: 'Destination Unreachable: host unreachable',
                ja: 'Destination Unreachable。ホストに届けられない',
              }
            : {
                en: 'Destination Unreachable: port unreachable',
                ja: 'Destination Unreachable。ポートが待ち受けていない',
              },
        ),
        original,
      ]
  }
}

interface HopSpec {
  readonly id: string
  readonly from: Node
  readonly to: Node
  readonly packet: PacketKind
  readonly source: Node
  readonly destination: Node
  readonly ttl: number
  readonly status?: Message['status']
}

function hopMessage(spec: HopSpec): Message {
  const isRequest = spec.packet.kind === 'echo' || spec.packet.kind === 'udp'
  return {
    id: spec.id,
    from: spec.from,
    to: spec.to,
    label: labelOf(spec.packet),
    status: spec.status ?? 'delivered',
    description: isRequest
      ? { en: 'The probe on its way to the server.', ja: 'サーバーへ向かうプローブ。' }
      : { en: 'The answer on its way back to the PC.', ja: 'PC へ戻る答え。' },
    fields: [
      {
        name: 'IP Src → Dst',
        value: `${ADDRESSES[spec.source]} → ${ADDRESSES[spec.destination]}`,
        description: {
          en: 'IP source and destination (unchanged along the path)',
          ja: 'IP の送信元と宛先（途中では変わらない）',
        },
      },
      {
        name: 'TTL',
        value: String(spec.ttl),
        highlight: true,
        description: {
          en: 'Time to live: each router decreases it by 1 when forwarding',
          ja: '生存時間。ルーターは転送するたびに 1 減らす',
        },
      },
      {
        name: 'Protocol',
        value: spec.packet.kind === 'udp' ? '17 (UDP)' : '1 (ICMP)',
        description: { en: 'What the IP packet carries', ja: 'IP パケットが運んでいるもの' },
      },
      ...packetFields(spec.packet),
    ],
  }
}

/** 1 ホップ分のステップ。説明は、誰が何をしたかを TTL と一緒に書く */
function hopStep(
  spec: HopSpec,
  title: LocalizedText,
  description: LocalizedText,
  extra: StepEvent[] = [],
): Step {
  return { id: spec.id, title, description, events: [send(hopMessage(spec)), ...extra] }
}

/**
 * PC から宛先のノードまで、プローブを 1 ホップずつ送るステップ。
 * 途中のルーターは TTL を 1 減らして転送する。stopAt のノードで TTL が 0 になるか、届く
 */
function outboundSteps(
  idBase: string,
  packet: PacketKind,
  ttl: number,
  stopAt: Node,
  lostAt?: Node,
): Step[] {
  const steps: Step[] = []
  const last = PATH.indexOf(stopAt)
  for (let i = 0; i < last; i++) {
    const from = PATH[i] ?? PC
    const to = PATH[i + 1] ?? SERVER
    const hopTtl = ttl - i
    const lost = lostAt === to
    const spec: HopSpec = {
      id: `${idBase}-${from}`,
      from,
      to,
      packet,
      source: PC,
      destination: SERVER,
      ttl: hopTtl,
      ...(lost ? { status: 'lost' } : {}),
    }
    steps.push(
      hopStep(
        spec,
        i === 0
          ? {
              en: `The PC sends ${labelOf(packet)} with TTL ${String(hopTtl)}`,
              ja: `PC が TTL ${String(hopTtl)} で ${labelOf(packet)} を送る`,
            }
          : {
              en: `${capitalize(NAMES[from].en)} forwards it (TTL ${String(hopTtl + 1)} → ${String(hopTtl)})`,
              ja: `${NAMES[from].ja}が転送する（TTL ${String(hopTtl + 1)} → ${String(hopTtl)}）`,
            },
        i === 0
          ? {
              en: `The destination is ${ADDRESSES.server}, not on the PC’s network, so the packet goes to the default gateway first.`,
              ja: `宛先 ${ADDRESSES.server} は PC のネットワークにないので、パケットはまずデフォルトゲートウェイに送る。`,
            }
          : {
              en: `${capitalize(NAMES[from].en)} looks up the destination, decreases TTL by 1, and sends the packet to the next hop, ${NAMES[to].en}.`,
              ja: `${NAMES[from].ja}は宛先を調べ、TTL を 1 減らして、次のホップ（${NAMES[to].ja}）に送る。`,
            },
      ),
    )
  }
  return steps
}

/** 答えを、答えたノードから PC まで 1 ホップずつ戻すステップ */
function returnSteps(
  idBase: string,
  packet: PacketKind,
  responder: Node,
  resultRows: readonly (readonly string[])[],
): Step[] {
  const steps: Step[] = []
  const first = PATH.indexOf(responder)
  for (let i = first; i > 0; i--) {
    const from = PATH[i] ?? SERVER
    const to = PATH[i - 1] ?? PC
    const hopTtl = INITIAL_TTL - (first - i)
    const arrives = to === PC
    const spec: HopSpec = {
      id: `${idBase}-${from}`,
      from,
      to,
      packet,
      source: responder,
      destination: PC,
      ttl: hopTtl,
    }
    steps.push(
      hopStep(
        spec,
        i === first
          ? {
              en: `${capitalize(NAMES[from].en)} answers with ${labelOf(packet)}`,
              ja: `${NAMES[from].ja}が ${labelOf(packet)} で答える`,
            }
          : {
              en: `${capitalize(NAMES[from].en)} forwards the answer`,
              ja: `${NAMES[from].ja}が答えを転送する`,
            },
        i === first
          ? {
              en: `The answer is a new IP packet from ${ADDRESSES[responder]} to the PC, starting with TTL ${String(INITIAL_TTL)}.`,
              ja: `答えは、${ADDRESSES[responder]} から PC への新しい IP パケットで、TTL ${String(INITIAL_TTL)} から始まる。`,
            }
          : {
              en: `${capitalize(NAMES[from].en)} forwards the answer toward the PC and decreases TTL by 1.`,
              ja: `${NAMES[from].ja}は答えを PC の方へ転送し、TTL を 1 減らす。`,
            },
        arrives
          ? [{ kind: 'stateChange', actorId: PC, key: RESULTS, value: table(resultRows) }]
          : [],
      ),
    )
  }
  return steps
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function startStep(options: IcmpOptions): Step {
  const ping = options.tool === 'ping'
  return {
    id: 'start',
    title: ping
      ? { en: 'The PC runs ping 192.0.2.10', ja: 'PC で ping 192.0.2.10 を実行する' }
      : {
          en: `The PC runs traceroute 192.0.2.10${options.probe === 'udp' ? ' (UDP probes)' : ' (ICMP probes)'}`,
          ja: `PC で traceroute 192.0.2.10 を実行する（${options.probe === 'udp' ? 'UDP' : 'ICMP'} のプローブ）`,
        },
    description: ping
      ? {
          en: 'ping checks whether a host is reachable: it sends ICMP Echo Requests and waits for Echo Replies.',
          ja: 'ping は、ホストに届くかを確かめる。ICMP の Echo Request を送り、Echo Reply を待つ。',
        }
      : {
          en: 'traceroute finds the routers on the way. It sends probes with TTL 1, 2, 3 …; each router where TTL runs out answers with Time Exceeded, which reveals its address.',
          ja: 'traceroute は途中のルーターを調べる。TTL を 1、2、3…にしてプローブを送ると、TTL が尽きたルーターが Time Exceeded で答えるので、そのアドレスがわかる。',
        },
    events: [],
  }
}

function pingSteps(options: IcmpOptions): Step[] {
  const steps: Step[] = [startStep(options)]
  const echo = (seq: number): PacketKind => ({ kind: 'echo', seq })
  if (options.outcome === 'hostUnreachable') {
    steps.push(
      ...outboundSteps('req', echo(1), INITIAL_TTL, ISP),
      ...returnSteps('unreach', { kind: 'unreachable', code: 1 }, ISP, [
        ['1', ADDRESSES.isp, 'Destination Host Unreachable (3/1)'],
      ]),
    )
    return withNote(steps, 'unreach-isp', {
      en: 'The ISP router cannot deliver the packet to 192.0.2.10 (for example, ARP for that address got no answer), so it drops the packet and reports it with Destination Unreachable, code 1 (host unreachable). The error comes from the ISP router’s own address.',
      ja: 'ISP のルーターは 192.0.2.10 にパケットを届けられない（たとえば、そのアドレスへの ARP に答えがない）ので、パケットを捨てて Destination Unreachable の code 1（host unreachable）で知らせる。エラーの送信元は ISP のルーター自身のアドレス。',
    })
  }
  const lost = options.outcome === 'noReply'
  steps.push(...outboundSteps('req', echo(1), INITIAL_TTL, SERVER))
  if (lost) {
    const [reply] = returnSteps('reply', { kind: 'echoReply', seq: 1 }, SERVER, [])
    if (reply !== undefined) {
      steps.push({
        ...reply,
        title: {
          en: 'The server answers, but the reply is lost',
          ja: 'サーバーが答えるが、応答が失われる',
        },
        events: reply.events.map((event) =>
          event.kind === 'message'
            ? { ...event, message: { ...event.message, status: 'lost' } }
            : event,
        ),
      })
    }
    steps.push({
      id: 'timeout',
      title: { en: 'No reply for seq=1', ja: 'seq=1 に応答がない' },
      description: {
        en: 'No reply arrived before the next request is due, so ping reports that seq=1 got no answer and sends the next request (seq=2). One lost reply does not mean the host is down.',
        ja: '次の要求を送る時刻までに応答が来なかったので、ping は seq=1 に答えがなかったことを示し、次の要求（seq=2）を送る。1 回失われただけでは、ホストが止まっているとは限らない。',
      },
      events: [
        timer('interval', PING_INTERVAL_MS),
        {
          kind: 'stateChange',
          actorId: PC,
          key: RESULTS,
          value: table([['1', '-', '(no reply)']]),
        },
      ],
    })
    steps.push(
      ...outboundSteps('req2', echo(2), INITIAL_TTL, SERVER),
      ...returnSteps('reply2', { kind: 'echoReply', seq: 2 }, SERVER, [
        ['1', '-', '(no reply)'],
        ['2', ADDRESSES.server, `Echo Reply ttl=${String(INITIAL_TTL - 2)}`],
      ]),
    )
    return steps
  }
  steps.push(
    ...returnSteps('reply', { kind: 'echoReply', seq: 1 }, SERVER, [
      ['1', ADDRESSES.server, `Echo Reply ttl=${String(INITIAL_TTL - 2)}`],
    ]),
  )
  return steps
}

/** 指定したステップの説明を置き換える */
function withNote(steps: Step[], id: string, description: LocalizedText): Step[] {
  return steps.map((step) => (step.id === id ? { ...step, description } : step))
}

function tracerouteSteps(options: IcmpOptions): Step[] {
  return withNote(tracerouteHops(options), 'exceeded1-router', {
    en: 'The home router receives the probe with TTL 1. Decreasing it gives 0, so the router must not forward the packet: it drops it and sends Time Exceeded back from its own address, 192.168.1.1.',
    ja: '家庭のルーターは TTL 1 のプローブを受け取る。1 減らすと 0 になるので転送してはならず、捨てて、自分のアドレス 192.168.1.1 から Time Exceeded を返す。',
  })
}

function tracerouteHops(options: IcmpOptions): Step[] {
  const steps: Step[] = [startStep(options)]
  const udp = options.probe === 'udp'
  const probe = (hop: number): PacketKind =>
    udp ? { kind: 'udp', port: UDP_FIRST_PORT + hop - 1 } : { kind: 'echo', seq: hop }
  const rows: string[][] = []
  const record = (hop: number, from: string, result: string) => {
    rows.push([String(hop), from, result])
    return rows.map((row) => [...row])
  }

  // 1 ホップ目: 家庭のルーターで TTL が尽きる
  steps.push(
    ...outboundSteps('probe1', probe(1), 1, ROUTER),
    ...returnSteps(
      'exceeded1',
      { kind: 'timeExceeded' },
      ROUTER,
      record(1, ADDRESSES.router, 'Time Exceeded (11/0)'),
    ),
  )
  // 2 ホップ目: ISP のルーターで TTL が尽きる（noReply では答えない）
  steps.push(...outboundSteps('probe2', probe(2), 2, ISP))
  if (options.outcome === 'noReply') {
    steps.push({
      id: 'timeout2',
      title: { en: 'Hop 2 does not answer: *', ja: '2 ホップ目が答えない: *' },
      description: {
        en: 'The ISP router drops the probe but sends no Time Exceeded (routers may limit or turn off ICMP errors). After waiting 5 seconds, traceroute prints * and moves on. The path itself still works.',
        ja: 'ISP のルーターはプローブを捨てるが、Time Exceeded を返さない（ルーターは ICMP のエラーを制限したり止めたりしてよい）。traceroute は 5 秒待ってから * を表示し、次へ進む。経路そのものは使える。',
      },
      events: [
        timer('timeout', PROBE_TIMEOUT_MS),
        {
          kind: 'stateChange',
          actorId: PC,
          key: RESULTS,
          value: table(record(2, '*', '(no reply)')),
        },
      ],
    })
  } else {
    steps.push(
      ...returnSteps(
        'exceeded2',
        { kind: 'timeExceeded' },
        ISP,
        record(2, ADDRESSES.isp, 'Time Exceeded (11/0)'),
      ),
    )
  }

  // 3 ホップ目: サーバーに届く（hostUnreachable では ISP のルーターが届けられない）
  if (options.outcome === 'hostUnreachable') {
    steps.push(
      ...outboundSteps('probe3', probe(3), 3, ISP),
      ...returnSteps(
        'unreach3',
        { kind: 'unreachable', code: 1 },
        ISP,
        record(3, ADDRESSES.isp, 'Host Unreachable (3/1)'),
      ),
    )
    return steps
  }
  steps.push(...outboundSteps('probe3', probe(3), 3, SERVER))
  if (udp) {
    steps.push(
      ...returnSteps(
        'unreach3',
        { kind: 'unreachable', code: 3 },
        SERVER,
        record(3, ADDRESSES.server, 'Port Unreachable (3/3)'),
      ),
    )
  } else {
    steps.push(
      ...returnSteps(
        'reply3',
        { kind: 'echoReply', seq: 3 },
        SERVER,
        record(3, ADDRESSES.server, 'Echo Reply'),
      ),
    )
  }
  return steps
}

function buildSteps(options: IcmpOptions): readonly Step[] {
  return options.tool === 'ping' ? pingSteps(options) : tracerouteSteps(options)
}

export const icmpScenario: Scenario<IcmpOptions> = {
  id: 'icmp',
  title: { en: 'ICMP: ping and traceroute', ja: 'ICMP: ping と traceroute' },
  actors,
  optionDefs: {
    tool: {
      kind: 'select',
      label: { en: 'Command', ja: 'コマンド' },
      choices: [
        { value: 'ping', label: { en: 'ping', ja: 'ping' } },
        { value: 'traceroute', label: { en: 'traceroute', ja: 'traceroute' } },
      ],
      defaultValue: 'ping',
    },
    outcome: {
      kind: 'select',
      label: { en: 'What happens on the way', ja: '途中で起きること' },
      choices: [
        { value: 'reply', label: { en: 'Everything works', ja: 'すべて順調' } },
        {
          value: 'hostUnreachable',
          label: { en: 'The server cannot be reached', ja: 'サーバーに届かない' },
        },
        {
          value: 'noReply',
          label: { en: 'An answer does not come back', ja: '答えが返ってこない' },
        },
      ],
      defaultValue: 'reply',
    },
    probe: {
      kind: 'select',
      label: { en: 'traceroute probes', ja: 'traceroute のプローブ' },
      description: {
        en: 'Only has an effect on traceroute. Windows tracert uses ICMP; Linux traceroute uses UDP by default.',
        ja: 'traceroute のときだけ影響する。Windows の tracert は ICMP、Linux の traceroute は既定で UDP を使う。',
      },
      choices: [
        { value: 'icmp', label: { en: 'ICMP Echo', ja: 'ICMP の Echo' } },
        { value: 'udp', label: { en: 'UDP', ja: 'UDP' } },
      ],
      defaultValue: 'icmp',
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
