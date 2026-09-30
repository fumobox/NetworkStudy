/**
 * パス MTU 探索: パケットが大きすぎるとき
 *
 * 根拠:
 * - RFC 791 §3.2（DF と MF のフラグ、Identification、Fragment Offset は 8 バイト単位。フラグメント化と再構成）
 * - RFC 792（Destination Unreachable、code 4: fragmentation needed and DF set）
 * - RFC 791 §3.2（DF = 1 で分割が必要なら、パケットを捨てる）
 * - RFC 1191 §3（パス MTU の最初の値は最初のリンクの MTU。Next-Hop MTU を受け取ったら、パス MTU を下げる）、§4（ルーターは
 *   Next-Hop MTU を ICMP のメッセージに入れる。元の IP ヘッダーと先頭の 8 バイトも入る）、§6.3（パス MTU を覚えておく時間は
 *   10 分。増やす試行はこのページでは扱わない）、§6.4（TCP はパス MTU に合わせてセグメントを小さくし、すぐに再送してよい）
 * - RFC 1812 §4.2.2.7（ルーターは RFC 791 に従って分割する）、§5.2.6（ルーターは分割するが、組み立て直さない）、
 *   §5.2.7.1（分割が必要なのに DF が立っていれば、Destination Unreachable の code 4 を送る）
 * - RFC 2516 §7（PPPoE の MRU は最大 1492）
 * - RFC 9293 §3.7.1（送る MSS は、相手の MSS とパス MTU − 40 の小さいほう）（MSS = MTU − 40。IP と TCP のヘッダー。RFC 6691 を取り込んだ）
 * - RFC 6298 §2.4、§5.5（RTO の下限 1 秒、満了のたびに倍）
 * - RFC 2923 §2.1（ICMP が遮られるとブラックホールになる）。RFC 4821 / RFC 8899（PLPMTUD）、RFC 8201（IPv6 の PMTUD）、
 *   RFC 4443 §3.2（Packet Too Big）、RFC 8200 §4.5、§5（IPv6 のルーターは分割しない。最小 MTU 1280）は概要で触れるだけ
 *
 * 学習用の単純化: 家庭のルーターの WAN 側は PPPoE で MTU 1492（1500 − 8）とし、ルーター自身が Fragmentation Needed を返す。
 * NAT（NAT のテーマを参照）と、サーバーからの ACK の経路（ルーターを通る）は描かない。1 つのメッセージを 1 つのパケットとして描く。
 * パス MTU を下げた後の再送は、2 つのセグメントを続けて送る（RFC 1191 §6.4 は、ACK が戻るまで 1 セグメントだけ再送する
 * スロースタートを勧めている）。
 * IP ヘッダーのオプションと TCP のオプション（タイムスタンプなど）は使わない
 */
import { z } from 'zod'
import type {
  Actor,
  ActorId,
  Message,
  Scenario,
  StateKey,
  StateTable,
  Step,
  StepEvent,
} from '@/engine/types'
import type { LocalizedText } from '@/lib/i18n/locale'

const optionsSchema = z.object({
  df: z.enum(['set', 'clear']).catch('set'),
  icmp: z.enum(['delivered', 'filtered']).catch('delivered'),
})
export type PmtudOptions = z.infer<typeof optionsSchema>

const PC: ActorId = 'pc'
const ROUTER: ActorId = 'router'
const SERVER: ActorId = 'server'
const PMTU: StateKey = 'pmtu'
const MTU: StateKey = 'mtu'
const RECEIVED: StateKey = 'received'
export const PMTU_COLUMNS = ['Destination', 'PMTU', 'MSS'] as const
export const MTU_COLUMNS = ['Interface', 'MTU'] as const

export const ADDRESSES = {
  pc: '192.168.1.10',
  router: '192.168.1.1',
  server: '192.0.2.10',
} as const
/** IP と TCP のヘッダー（オプションなし） */
export const HEADERS = 40
export const IP_HEADER = 20
export const LAN_MTU = 1500
/** PPPoE のヘッダー 8 バイトの分だけ小さい */
export const WAN_MTU = 1492
export const MSS = LAN_MTU - HEADERS
export const NEW_MSS = WAN_MTU - HEADERS
export const FIRST_SEQ = 1001
export const RTO_MS = 1000
const IDENTIFICATION = '0x2a3b'
/** IP のデータ部分（TCP のヘッダー 20 バイトとデータ） */
const IP_PAYLOAD = MSS + (HEADERS - IP_HEADER)
/** 1 つ目のフラグメントのデータ（MTU に入る 8 の倍数） */
export const FRAGMENT1_DATA = Math.floor((WAN_MTU - IP_HEADER) / 8) * 8
export const FRAGMENT2_DATA = IP_PAYLOAD - FRAGMENT1_DATA

const actors: readonly Actor[] = [
  {
    id: PC,
    kind: 'client',
    name: { en: 'Your PC (192.168.1.10)', ja: 'PC（192.168.1.10）' },
    shortName: { en: 'PC', ja: 'PC' },
    stateSlots: [
      {
        key: PMTU,
        label: { en: 'Path MTU cache', ja: 'パス MTU の記録' },
        initial: { columns: PMTU_COLUMNS, rows: [] },
      },
    ],
  },
  {
    id: ROUTER,
    kind: 'router',
    name: { en: 'Home router (192.168.1.1)', ja: '家庭のルーター（192.168.1.1）' },
    shortName: { en: 'Router', ja: 'ルーター' },
    stateSlots: [
      {
        key: MTU,
        label: { en: 'Link MTUs', ja: 'リンクの MTU' },
        initial: { columns: MTU_COLUMNS, rows: [] },
      },
    ],
  },
  {
    id: SERVER,
    kind: 'server',
    name: { en: 'www.example.com (192.0.2.10)', ja: 'www.example.com（192.0.2.10）' },
    shortName: { en: 'Server', ja: 'サーバー' },
    stateSlots: [
      { key: RECEIVED, label: { en: 'Data received', ja: '受け取ったデータ' }, initial: '-' },
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
const rto = (durationMs: number): StepEvent => ({
  kind: 'timer',
  actorId: PC,
  name: 'RTO',
  durationMs,
})

const pmtuTable = (pmtu: number): StateTable => ({
  columns: PMTU_COLUMNS,
  rows: [[ADDRESSES.server, String(pmtu), String(pmtu - HEADERS)]],
})

const FIELD_TEXT = {
  totalLength: {
    en: 'The size of the whole IP packet: 20 bytes of IP header, 20 bytes of TCP header and the data',
    ja: 'IP のパケット全体の大きさ。IP のヘッダー 20 バイト、TCP のヘッダー 20 バイトとデータ',
  },
  fragmentLength: {
    en: 'The size of this fragment: 20 bytes of IP header and its share of the original payload (the TCP header is only in the first fragment)',
    ja: 'このフラグメントの大きさ。IP のヘッダー 20 バイトと、元のペイロードのうちこのフラグメントが運ぶ部分（TCP のヘッダーは最初のフラグメントにだけある）',
  },
  more: {
    en: 'MF=1 (more fragments): another fragment of this packet follows',
    ja: 'MF=1（more fragments）: このパケットのフラグメントがまだ続く',
  },
  last: {
    en: 'MF=0: this is the last fragment of the packet',
    ja: 'MF=0: このパケットの最後のフラグメント',
  },
  addresses: {
    en: 'IP source and destination (unchanged along the path; the home router’s NAT is not shown here, see the NAT theme)',
    ja: 'IP の送信元と宛先（途中では変わらない。家庭のルーターの NAT はここでは描いていない。NAT のテーマを参照）',
  },
  df: {
    en: 'DF (Don’t Fragment): routers must not split this packet. Path MTU discovery depends on it',
    ja: 'DF（Don’t Fragment）: ルーターはこのパケットを分割してはいけない。パス MTU 探索はこれを使う',
  },
  noDf: {
    en: 'DF is not set, so a router may split the packet into fragments',
    ja: 'DF が立っていないので、ルーターはパケットをフラグメントに分割してよい',
  },
  offset: {
    en: 'Where this fragment’s data starts in the original payload, in units of 8 bytes',
    ja: 'このフラグメントのデータが、元のデータのどこから始まるか。8 バイト単位',
  },
  identification: {
    en: 'The same in every fragment of one packet, so the receiver can put them back together',
    ja: '1 つのパケットのフラグメントではどれも同じ。受け取った側はこれで組み立て直す',
  },
} satisfies Record<string, LocalizedText>

interface PacketSpec {
  readonly id: string
  readonly from: ActorId
  readonly to: ActorId
  readonly label: string
  readonly totalLength: number
  readonly df: boolean
  readonly ttl: number
  readonly seq: number
  readonly length: number
  readonly status?: Message['status']
  readonly retransmitOf?: string
}

function tcpPacket(spec: PacketSpec): Message {
  const message: Message = {
    id: spec.id,
    from: spec.from,
    to: spec.to,
    label: spec.label,
    status: spec.status ?? 'delivered',
    fields: [
      {
        name: 'IP Src → Dst',
        value: `${ADDRESSES.pc} → ${ADDRESSES.server}`,
        description: FIELD_TEXT.addresses,
      },
      {
        name: 'Total length',
        value: `${String(spec.totalLength)} bytes`,
        highlight: true,
        description: FIELD_TEXT.totalLength,
      },
      {
        name: 'Flags',
        value: spec.df ? 'DF=1, MF=0' : 'DF=0, MF=0',
        highlight: spec.df,
        description: spec.df ? FIELD_TEXT.df : FIELD_TEXT.noDf,
      },
      { name: 'TTL', value: String(spec.ttl) },
      { name: 'Protocol', value: '6 (TCP)' },
      { name: 'TCP Seq', value: String(spec.seq) },
      { name: 'TCP Len', value: String(spec.length) },
    ],
  }
  return spec.retransmitOf === undefined ? message : { ...message, retransmitOf: spec.retransmitOf }
}

/** 最初の、大きすぎるセグメント */
const firstPacket = (id: string, df: boolean, retransmitOf?: string): Message =>
  tcpPacket({
    id,
    from: PC,
    to: ROUTER,
    label: `DATA ${String(LAN_MTU)} B${df ? ' DF' : ''} seq=${String(FIRST_SEQ)}`,
    totalLength: LAN_MTU,
    df,
    ttl: 64,
    seq: FIRST_SEQ,
    length: MSS,
    status: df ? 'rejected' : 'delivered',
    ...(retransmitOf === undefined ? {} : { retransmitOf }),
  })

const fragNeeded = (id: string, status: Message['status']): Message => ({
  id,
  from: ROUTER,
  to: PC,
  label: `Frag Needed (3/4) MTU=${String(WAN_MTU)}`,
  status,
  fields: [
    { name: 'IP Src → Dst', value: `${ADDRESSES.router} → ${ADDRESSES.pc}` },
    {
      name: 'ICMP type / code',
      value: '3 / 4',
      description: {
        en: 'Destination Unreachable: fragmentation needed and DF set',
        ja: 'Destination Unreachable: 分割が必要なのに DF が立っている',
      },
    },
    {
      name: 'Next-Hop MTU',
      value: String(WAN_MTU),
      highlight: true,
      description: {
        en: 'The MTU of the link the packet could not be sent on',
        ja: 'パケットを送れなかったリンクの MTU',
      },
    },
    {
      name: 'Original datagram',
      value: 'IP header + first 8 bytes',
      description: {
        en: 'The start of the dropped packet, so that the PC can tell which connection it belongs to',
        ja: '捨てたパケットの先頭。PC はこれで、どの接続のパケットかがわかる',
      },
    },
  ],
})

function buildSteps(options: PmtudOptions): readonly Step[] {
  const df = options.df === 'set'
  const filtered = df && options.icmp === 'filtered'
  const steps: Step[] = [
    {
      id: 'start',
      title: { en: 'The connection is open', ja: '接続ができている' },
      description: {
        en: 'The PC and the server both announced an MSS of 1460 in the handshake: 1500 (the Ethernet MTU) minus 40 bytes of IP and TCP headers. But the home router’s link to the ISP uses PPPoE, whose 8-byte header leaves an MTU of only 1492. The MSS describes the two ends, not the path, so nobody knows this yet.',
        ja: 'PC とサーバーは、ハンドシェイクでどちらも MSS 1460 を知らせた。1500（Ethernet の MTU）から IP と TCP のヘッダーの 40 バイトを引いた値。ところが家庭のルーターと ISP の間は PPPoE で、8 バイトのヘッダーの分だけ MTU は 1492 しかない。MSS は両端のことしか表さず、経路のことはまだ誰も知らない。',
      },
      events: [
        set(PC, PMTU, pmtuTable(LAN_MTU)),
        set(ROUTER, MTU, {
          columns: MTU_COLUMNS,
          rows: [
            ['eth0 (LAN)', String(LAN_MTU)],
            ['ppp0 (WAN)', String(WAN_MTU)],
          ],
        }),
      ],
    },
  ]

  if (!df) {
    steps.push(
      {
        id: 'send-1500',
        title: { en: 'A 1500-byte packet without DF', ja: 'DF のない 1500 バイトのパケット' },
        description: {
          en: 'The PC sends a full 1460-byte segment in a 1500-byte packet, without the DF flag. The router may split it.',
          ja: 'PC は 1460 バイトの満杯のセグメントを、1500 バイトのパケットで DF を立てずに送る。ルーターはこれを分割してよい。',
        },
        events: [send(firstPacket('send-1500', false))],
      },
      {
        id: 'fragment',
        title: {
          en: 'The router fragments the packet',
          ja: 'ルーターがパケットをフラグメントに分割する',
        },
        description: {
          en: 'The packet does not fit the 1492-byte link, so the router splits its 1480 bytes of payload. The first fragment carries 1472 bytes (a multiple of 8) and has MF (more fragments) set; the second carries the last 8 bytes at offset 184 (184 × 8 = 1472). Both keep the same Identification. Fragmentation costs work on the router, and losing one fragment loses the whole packet, so modern TCP avoids it with path MTU discovery.',
          ja: 'パケットは 1492 バイトのリンクに入らないので、ルーターは 1480 バイトのデータを分割する。1 つ目のフラグメントは 1472 バイト（8 の倍数）を運び、MF（続きがある）を立てる。2 つ目は残りの 8 バイトを、オフセット 184（184 × 8 = 1472）で運ぶ。どちらも同じ Identification。フラグメント化はルーターの負担になり、1 つ失われるとパケット全体が失われるので、今の TCP はパス MTU 探索で避ける。',
        },
        events: [
          send(fragment('fragment-1', 1, IP_HEADER + FRAGMENT1_DATA, 0, true)),
          send(fragment('fragment-2', 2, IP_HEADER + FRAGMENT2_DATA, FRAGMENT1_DATA / 8, false)),
        ],
      },
      {
        id: 'reassemble',
        title: {
          en: 'The server reassembles and acknowledges',
          ja: 'サーバーが組み立て直して確認応答する',
        },
        description: {
          en: 'The server waits until both fragments with the same Identification have arrived, puts the original packet back together, and acknowledges all 1460 bytes. Only the destination reassembles; routers never do.',
          ja: 'サーバーは、同じ Identification のフラグメントが両方届くのを待ち、元のパケットを組み立て直して、1460 バイトすべてを確認応答する。組み立て直すのは宛先だけで、ルーターは組み立て直さない。',
        },
        events: [
          set(SERVER, RECEIVED, `${String(FIRST_SEQ)}–${String(FIRST_SEQ + MSS - 1)}`),
          send(ackMessage()),
        ],
      },
    )
    return steps
  }

  steps.push({
    id: 'send-1500',
    title: { en: 'A 1500-byte packet with DF', ja: 'DF の立った 1500 バイトのパケット' },
    description: {
      en: 'The PC sends a full 1460-byte segment: a 1500-byte packet, which fits its own Ethernet link. TCP sets DF (Don’t Fragment) to discover the path MTU. The router cannot forward a 1500-byte packet over the 1492-byte link and must not fragment it, so it drops it.',
      ja: 'PC は 1460 バイトの満杯のセグメントを送る。1500 バイトのパケットで、自分の Ethernet のリンクには入る。TCP はパス MTU を探すため DF（Don’t Fragment）を立てる。ルーターは 1500 バイトのパケットを 1492 バイトのリンクで転送できず、分割もできないので、捨てる。',
    },
    events: [send(firstPacket('send-1500', true))],
  })

  if (filtered) {
    steps.push(
      {
        id: 'icmp-blocked',
        title: { en: 'The ICMP message is blocked', ja: 'ICMP のメッセージが遮られる' },
        description: {
          en: 'The router sends Fragmentation Needed, but a firewall that drops all ICMP (too strict a rule) discards it. The PC never learns why its packet vanished.',
          ja: 'ルーターは Fragmentation Needed を送るが、ICMP をすべて捨てるファイアウォール（厳しすぎる設定）がそれを捨てる。PC は、パケットが消えた理由を知ることができない。',
        },
        events: [send(fragNeeded('frag-needed', 'lost'))],
      },
      {
        id: 'rto-1',
        title: { en: 'Timeout: the same packet again', ja: 'タイムアウト: 同じパケットをもう一度' },
        description: {
          en: 'No ACK arrives, so after the retransmission timeout (1 second) TCP resends the same 1500-byte packet. It meets the same fate.',
          ja: 'ACK が来ないので、再送タイムアウト（1 秒）のあと、TCP は同じ 1500 バイトのパケットを再送する。結果は同じ。',
        },
        events: [
          rto(RTO_MS),
          send(firstPacket('resend-1', true, 'send-1500')),
          send(fragNeeded('frag-needed-2', 'lost')),
        ],
      },
      {
        id: 'rto-2',
        title: { en: 'The timeout doubles', ja: 'タイムアウトが倍になる' },
        description: {
          en: 'The timeout doubles to 2 seconds, and the resent packet is dropped again.',
          ja: 'タイムアウトは 2 秒に倍になり、再送したパケットもまた捨てられる。',
        },
        events: [
          rto(2 * RTO_MS),
          send(firstPacket('resend-2', true, 'resend-1')),
          send(fragNeeded('frag-needed-3', 'lost')),
        ],
      },
      {
        id: 'black-hole',
        title: { en: 'A path MTU black hole', ja: 'パス MTU のブラックホール' },
        description: {
          en: 'The handshake worked because its packets were small, but every full-sized packet disappears: the page starts loading and then hangs. Fixes: let ICMP type 3 code 4 through, have the router rewrite the MSS in SYNs (MSS clamping), or let the host probe the path itself (PLPMTUD, RFC 4821 / RFC 8899).',
          ja: 'ハンドシェイクはパケットが小さいので通ったが、満杯の大きさのパケットはどれも消える。ページが読み込み始めたまま止まる。対策は、ICMP の type 3 code 4 を通す、ルーターが SYN の MSS を書き換える（MSS clamping）、ホストが自分で経路を試す（PLPMTUD、RFC 4821 / RFC 8899）。',
        },
        events: [],
      },
    )
    return steps
  }

  const rest = MSS - NEW_MSS
  steps.push(
    {
      id: 'frag-needed',
      title: {
        en: 'The router answers: Fragmentation Needed',
        ja: 'ルーターが答える: Fragmentation Needed',
      },
      description: {
        en: 'The router sends ICMP Destination Unreachable, code 4 (fragmentation needed and DF set), with the MTU of the next link: 1492. It includes the start of the dropped packet, so the PC can find the TCP connection.',
        ja: 'ルーターは ICMP の Destination Unreachable、code 4（分割が必要なのに DF が立っている）を、次のリンクの MTU 1492 を入れて送る。捨てたパケットの先頭も入っているので、PC は TCP の接続を見つけられる。',
      },
      events: [send(fragNeeded('frag-needed', 'delivered'))],
    },
    {
      id: 'update',
      title: { en: 'The PC lowers the path MTU and the MSS', ja: 'PC がパス MTU と MSS を下げる' },
      description: {
        en: `The PC records a path MTU of 1492 for this destination, so TCP now sends at most 1492 − 40 = ${String(NEW_MSS)} bytes per segment.`,
        ja: `PC はこの宛先のパス MTU を 1492 と記録し、TCP は 1 つのセグメントで最大 1492 − 40 = ${String(NEW_MSS)} バイトを送るようになる。`,
      },
      events: [set(PC, PMTU, pmtuTable(WAN_MTU))],
    },
    {
      id: 'resend',
      title: { en: 'The data is resent in smaller packets', ja: '小さなパケットで送り直す' },
      description: {
        en: `TCP resends the same data in segments that fit: ${String(NEW_MSS)} bytes (a 1492-byte packet) and the remaining ${String(rest)} bytes.`,
        ja: `TCP は同じデータを、入る大きさのセグメントで送り直す。${String(NEW_MSS)} バイト（1492 バイトのパケット）と、残りの ${String(rest)} バイト。`,
      },
      events: [
        send(
          tcpPacket({
            id: 'resend-1',
            from: PC,
            to: ROUTER,
            label: `DATA ${String(WAN_MTU)} B DF seq=${String(FIRST_SEQ)}`,
            totalLength: WAN_MTU,
            df: true,
            ttl: 64,
            seq: FIRST_SEQ,
            length: NEW_MSS,
            retransmitOf: 'send-1500',
          }),
        ),
        send(
          tcpPacket({
            id: 'resend-2',
            from: PC,
            to: ROUTER,
            label: `DATA ${String(rest + HEADERS)} B DF seq=${String(FIRST_SEQ + NEW_MSS)}`,
            totalLength: rest + HEADERS,
            df: true,
            ttl: 64,
            seq: FIRST_SEQ + NEW_MSS,
            length: rest,
          }),
        ),
      ],
    },
    {
      id: 'forward',
      title: { en: 'Both packets fit the link', ja: 'どちらのパケットもリンクに入る' },
      description: {
        en: 'The router forwards both packets over the 1492-byte link, decreasing the TTL.',
        ja: 'ルーターは、TTL を 1 減らして、どちらのパケットも 1492 バイトのリンクで転送する。',
      },
      events: [
        send(
          tcpPacket({
            id: 'forward-1',
            from: ROUTER,
            to: SERVER,
            label: `DATA ${String(WAN_MTU)} B DF seq=${String(FIRST_SEQ)}`,
            totalLength: WAN_MTU,
            df: true,
            ttl: 63,
            seq: FIRST_SEQ,
            length: NEW_MSS,
          }),
        ),
        send(
          tcpPacket({
            id: 'forward-2',
            from: ROUTER,
            to: SERVER,
            label: `DATA ${String(rest + HEADERS)} B DF seq=${String(FIRST_SEQ + NEW_MSS)}`,
            totalLength: rest + HEADERS,
            df: true,
            ttl: 63,
            seq: FIRST_SEQ + NEW_MSS,
            length: rest,
          }),
        ),
        set(SERVER, RECEIVED, `${String(FIRST_SEQ)}–${String(FIRST_SEQ + MSS - 1)}`),
      ],
    },
    {
      id: 'ack',
      title: { en: 'The server acknowledges', ja: 'サーバーが確認応答する' },
      description: {
        en: 'The server acknowledges all 1460 bytes. From now on, every full segment is 1452 bytes and nothing is dropped. The PC remembers the path MTU for a while (about 10 minutes) and may then try a larger size again.',
        ja: 'サーバーは 1460 バイトすべてを確認応答する。これからは満杯のセグメントは 1452 バイトになり、捨てられることはない。PC はパス MTU をしばらく（10 分ほど）覚えていて、その後はまた大きい値を試すことがある。',
      },
      events: [send(ackMessage())],
    },
  )
  return steps
}

/** フラグメント（DF を立てずに送ったときだけ） */
function fragment(
  id: string,
  index: number,
  totalLength: number,
  offset: number,
  more: boolean,
): Message {
  return {
    id,
    from: ROUTER,
    to: SERVER,
    label: `Frag ${String(index)}/2 off=${String(offset * 8)} MF=${more ? '1' : '0'} ${String(totalLength)} B`,
    status: 'delivered',
    fields: [
      {
        name: 'IP Src → Dst',
        value: `${ADDRESSES.pc} → ${ADDRESSES.server}`,
        description: FIELD_TEXT.addresses,
      },
      {
        name: 'Total length',
        value: `${String(totalLength)} bytes`,
        highlight: true,
        description: FIELD_TEXT.fragmentLength,
      },
      {
        name: 'Flags',
        value: `DF=0, MF=${more ? '1' : '0'}`,
        highlight: true,
        description: more ? FIELD_TEXT.more : FIELD_TEXT.last,
      },
      { name: 'Identification', value: IDENTIFICATION, description: FIELD_TEXT.identification },
      {
        name: 'Fragment offset',
        value: `${String(offset)} (× 8 = ${String(offset * 8)} bytes)`,
        description: FIELD_TEXT.offset,
      },
      { name: 'TTL', value: '63' },
    ],
  }
}

function ackMessage(): Message {
  return {
    id: 'ack',
    from: SERVER,
    to: PC,
    label: `ACK ${String(FIRST_SEQ + MSS)}`,
    status: 'delivered',
    description: {
      en: 'Drawn as one arrow; it passes the router on the way back.',
      ja: '1 本の矢印で描いている。戻りもルーターを通る。',
    },
    fields: [
      { name: 'IP Src → Dst', value: `${ADDRESSES.server} → ${ADDRESSES.pc}` },
      { name: 'TCP Ack', value: String(FIRST_SEQ + MSS), highlight: true },
    ],
  }
}

export const pmtudScenario: Scenario<PmtudOptions> = {
  id: 'pmtud',
  title: {
    en: 'Path MTU discovery: when a packet is too big',
    ja: 'パス MTU 探索: パケットが大きすぎるとき',
  },
  actors,
  optionDefs: {
    df: {
      kind: 'select',
      label: { en: 'DF flag', ja: 'DF フラグ' },
      choices: [
        { value: 'set', label: { en: 'Set (path MTU discovery)', ja: '立てる（パス MTU 探索）' } },
        {
          value: 'clear',
          label: { en: 'Not set (routers may fragment)', ja: '立てない（ルーターが分割してよい）' },
        },
      ],
      defaultValue: 'set',
    },
    icmp: {
      kind: 'select',
      label: { en: 'ICMP on the way back', ja: '戻りの ICMP' },
      description: {
        en: 'Only has an effect when DF is set.',
        ja: 'DF を立てたときだけ影響する。',
      },
      choices: [
        { value: 'delivered', label: { en: 'Delivered', ja: '届く' } },
        { value: 'filtered', label: { en: 'Blocked by a firewall', ja: 'ファイアウォールが遮る' } },
      ],
      defaultValue: 'delivered',
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
