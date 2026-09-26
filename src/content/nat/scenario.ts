/**
 * NAT（NAPT）: 1 つのグローバルアドレスを共有する
 *
 * 根拠:
 * - RFC 1918 §3: プライベートアドレス（192.168.0.0/16 など）はインターネットでは経路が広告されない
 * - RFC 2663 §4.1.2: NAPT（アドレスとポートを変換する NAT）の用語
 * - RFC 3022 §2.2（NAPT）、§3.1（外へ向かう最初のパケットで変換の対応を作る）、§3.2（戻りのパケットは外側のポートで対応を探す）、
 *   §4.1・§4.2（アドレスとポートを書き換えたら、IP と TCP のチェックサムを計算し直す）
 * - RFC 4787 §4.1（REQ-1: 宛先によらず同じ対応を使う endpoint-independent mapping）、§4.2.1（外側のポートの割り当て）、
 *   §4.3（REQ-5: UDP の対応は 2 分以上保つ）、§5（外からのパケットのフィルタリング）
 * - RFC 5382 §4.3（REQ-4: 対応のない外からの SYN は、少なくとも 6 秒は答えない）、§5（REQ-5: TCP の対応は 2 時間 4 分以上保つ）
 * - RFC 6056: 外側のポートは推測されにくく選ぶべき（この例では読みやすさのため 40001、40002 と順に選ぶ）
 *
 * 学習用の単純化: NAPT だけを扱う。TCP のシーケンス番号と Ethernet は描かない（TCP と ARP のテーマを参照）。
 * 対応の寿命は説明だけ。ヘアピン、ALG、UPnP / PCP、キャリアグレード NAT は概要で触れるだけ
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
  secondPc: z.stringbool().catch(true),
  inbound: z.stringbool().catch(false),
})
export type NatOptions = z.infer<typeof optionsSchema>

const PC = 'pc'
const PC2 = 'pc2'
const ROUTER = 'router'
const SERVER = 'server'
const NAT_TABLE: StateKey = 'nat'
const PEER: StateKey = 'peer'
const SOCKET: StateKey = 'socket'
export const NAT_COLUMNS = ['Proto', 'Internal', 'External', 'Remote'] as const

export const ENDPOINTS = {
  pc: '192.168.1.10:49152',
  pc2: '192.168.1.20:49152',
  public1: '203.0.113.5:40001',
  public2: '203.0.113.5:40002',
  server: '192.0.2.10:443',
} as const

const table = (rows: readonly (readonly string[])[]): StateTable => ({ columns: NAT_COLUMNS, rows })
const ROW_PC = ['TCP', ENDPOINTS.pc, ENDPOINTS.public1, ENDPOINTS.server] as const
const ROW_PC2 = ['TCP', ENDPOINTS.pc2, ENDPOINTS.public2, ENDPOINTS.server] as const

const socketSlot = {
  key: SOCKET,
  label: { en: 'Connection (as the PC sees it)', ja: '接続（PC から見たもの）' },
  initial: '-',
}

const actors: readonly Actor[] = [
  {
    id: PC,
    kind: 'client',
    name: { en: 'Your PC (192.168.1.10)', ja: 'PC（192.168.1.10）' },
    shortName: { en: 'PC', ja: 'PC' },
    stateSlots: [socketSlot],
  },
  {
    id: PC2,
    kind: 'client',
    name: { en: 'Another PC (192.168.1.20)', ja: '別の PC（192.168.1.20）' },
    shortName: { en: 'PC 2', ja: 'PC 2' },
    stateSlots: [socketSlot],
  },
  {
    id: ROUTER,
    kind: 'router',
    name: {
      en: 'Router (NAT, 192.168.1.1 / 203.0.113.5)',
      ja: 'ルーター（NAT、192.168.1.1 / 203.0.113.5）',
    },
    shortName: { en: 'Router', ja: 'ルーター' },
    stateSlots: [
      { key: NAT_TABLE, label: { en: 'NAT table', ja: 'NAT の変換表' }, initial: table([]) },
    ],
  },
  {
    id: SERVER,
    kind: 'server',
    name: { en: 'www.example.com (192.0.2.10)', ja: 'www.example.com（192.0.2.10）' },
    shortName: { en: 'Server', ja: 'サーバー' },
    stateSlots: [
      {
        key: PEER,
        label: { en: 'Connections as the server sees them', ja: 'サーバーから見た接続の相手' },
        initial: '-',
      },
    ],
  },
]

const set = (actorId: string, key: StateKey, value: string | StateTable): StepEvent => ({
  kind: 'stateChange',
  actorId,
  key,
  value,
})
const send = (message: Message): StepEvent => ({ kind: 'message', message })

interface SegmentSpec {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly flags: string
  readonly src: string
  readonly dst: string
  /** 変換した場合は、変換前と後 */
  readonly translation?: string
  readonly status?: Message['status']
  readonly description: LocalizedText
}

function segment(spec: SegmentSpec): Message {
  const fields: PacketField[] = [
    {
      name: 'Src',
      value: spec.src,
      highlight: spec.translation !== undefined,
      description: { en: 'Source IP address and port', ja: '送信元の IP アドレスとポート' },
    },
    {
      name: 'Dst',
      value: spec.dst,
      highlight: spec.translation !== undefined,
      description: { en: 'Destination IP address and port', ja: '宛先の IP アドレスとポート' },
    },
    {
      name: 'Flags',
      value: spec.flags,
      description: {
        en: 'TCP flags (see the TCP theme)',
        ja: 'TCP のフラグ（TCP のテーマを参照）',
      },
    },
  ]
  if (spec.translation !== undefined) {
    fields.push(
      {
        name: 'Translation',
        value: spec.translation,
        highlight: true,
        description: {
          en: 'What the router rewrote in this packet',
          ja: 'ルーターがこのパケットで書き換えたところ',
        },
      },
      {
        name: 'Checksums',
        value: 'recomputed',
        description: {
          en: 'The IP and TCP checksums include the addresses and ports, so the router recomputes them',
          ja: 'IP と TCP のチェックサムにはアドレスとポートが含まれるので、ルーターが計算し直す',
        },
      },
    )
  }
  return {
    id: spec.id,
    from: spec.from,
    to: spec.to,
    label: `${spec.flags} ${spec.src} → ${spec.dst}`,
    status: spec.status ?? 'delivered',
    description: spec.description,
    fields,
  }
}

const outward = {
  en: 'On the home network, before translation.',
  ja: '家庭のネットワークの中。変換する前。',
}
const onInternet = {
  en: 'On the Internet, after translation.',
  ja: 'インターネット側。変換した後。',
}

function srcTranslation(from: string, to: string): string {
  return `src ${from} → ${to}`
}
function dstTranslation(from: string, to: string): string {
  return `dst ${from} → ${to}`
}

function buildSteps(options: NatOptions): readonly Step[] {
  const peers = (count: 1 | 2) =>
    count === 1 ? ENDPOINTS.public1 : `${ENDPOINTS.public1}, ${ENDPOINTS.public2}`
  const steps: Step[] = [
    {
      id: 'private',
      title: {
        en: 'The PC has a private address',
        ja: 'PC のアドレスはプライベートアドレス',
      },
      description: {
        en: `The PC (192.168.1.10) wants to open a TCP connection to ${ENDPOINTS.server}. 192.168.1.10 is a private address: it is not routed on the Internet, so a reply to it could never come back. The router has the only public address, 203.0.113.5.`,
        ja: `PC（192.168.1.10）は ${ENDPOINTS.server} に TCP の接続を開きたい。192.168.1.10 はプライベートアドレスで、インターネットでは経路がないので、そのままでは返事が戻ってこない。グローバルアドレス（203.0.113.5）を持っているのはルーターだけ。`,
      },
      events: [set(PC, SOCKET, `TCP ${ENDPOINTS.pc} → ${ENDPOINTS.server}`)],
    },
    {
      id: 'syn',
      title: { en: 'The PC sends a SYN to the server', ja: 'PC がサーバーに SYN を送る' },
      description: {
        en: 'The packet leaves the PC with its own private address and port as the source, and goes to the default gateway.',
        ja: 'パケットは、PC 自身のプライベートアドレスとポートを送信元にして PC を出て、デフォルトゲートウェイに届く。',
      },
      events: [
        send(
          segment({
            id: 'syn-in',
            from: PC,
            to: ROUTER,
            flags: 'SYN',
            src: ENDPOINTS.pc,
            dst: ENDPOINTS.server,
            description: outward,
          }),
        ),
      ],
    },
    {
      id: 'map',
      title: {
        en: 'The router translates the source and remembers it',
        ja: 'ルーターが送信元を変換して覚える',
      },
      description: {
        en: `This is the first packet of a new connection, so the router picks a free port on its public address (${ENDPOINTS.public1}), writes the mapping into the NAT table, and replaces the source address and port. The server will only ever see ${ENDPOINTS.public1}.`,
        ja: `新しい接続の最初のパケットなので、ルーターはグローバルアドレスの空いているポート（${ENDPOINTS.public1}）を選び、対応を NAT の変換表に書いて、送信元のアドレスとポートを書き換える。サーバーに見えるのは ${ENDPOINTS.public1} だけ。`,
      },
      events: [
        set(ROUTER, NAT_TABLE, table([ROW_PC])),
        send(
          segment({
            id: 'syn-out',
            from: ROUTER,
            to: SERVER,
            flags: 'SYN',
            src: ENDPOINTS.public1,
            dst: ENDPOINTS.server,
            translation: srcTranslation(ENDPOINTS.pc, ENDPOINTS.public1),
            description: onInternet,
          }),
        ),
      ],
    },
    {
      id: 'syn-ack',
      title: {
        en: 'The server replies to the public address',
        ja: 'サーバーがグローバルアドレスに返事をする',
      },
      description: {
        en: `The server thinks it is talking to ${ENDPOINTS.public1} and replies there.`,
        ja: `サーバーは ${ENDPOINTS.public1} と話していると思っていて、そこに返事をする。`,
      },
      events: [
        set(SERVER, PEER, peers(1)),
        send(
          segment({
            id: 'syn-ack-out',
            from: SERVER,
            to: ROUTER,
            flags: 'SYN, ACK',
            src: ENDPOINTS.server,
            dst: ENDPOINTS.public1,
            description: onInternet,
          }),
        ),
      ],
    },
    {
      id: 'unmap',
      title: {
        en: 'The router finds the mapping and translates back',
        ja: 'ルーターが対応を見つけて元に戻す',
      },
      description: {
        en: `The router looks up the destination port 40001 in the NAT table, finds ${ENDPOINTS.pc}, rewrites the destination, and forwards the packet to the PC. The PC never notices the translation.`,
        ja: `ルーターは宛先のポート 40001 を NAT の変換表で探し、${ENDPOINTS.pc} を見つけて宛先を書き換え、PC に転送する。PC は変換に気づかない。`,
      },
      events: [
        send(
          segment({
            id: 'syn-ack-in',
            from: ROUTER,
            to: PC,
            flags: 'SYN, ACK',
            src: ENDPOINTS.server,
            dst: ENDPOINTS.pc,
            translation: dstTranslation(ENDPOINTS.public1, ENDPOINTS.pc),
            description: outward,
          }),
        ),
      ],
    },
    {
      id: 'ack',
      title: { en: 'Every packet is translated', ja: 'すべてのパケットが変換される' },
      description: {
        en: 'The PC finishes the handshake with an ACK. This and every later packet of the connection is translated the same way, in both directions.',
        ja: 'PC は ACK でハンドシェイクを終える。これも、この接続のその後のパケットも、両方の向きで同じように変換される。',
      },
      events: [
        send(
          segment({
            id: 'ack-in',
            from: PC,
            to: ROUTER,
            flags: 'ACK',
            src: ENDPOINTS.pc,
            dst: ENDPOINTS.server,
            description: outward,
          }),
        ),
        send(
          segment({
            id: 'ack-out',
            from: ROUTER,
            to: SERVER,
            flags: 'ACK',
            src: ENDPOINTS.public1,
            dst: ENDPOINTS.server,
            translation: srcTranslation(ENDPOINTS.pc, ENDPOINTS.public1),
            description: onInternet,
          }),
        ),
      ],
    },
  ]

  if (options.secondPc) {
    steps.push(
      {
        id: 'pc2-syn',
        title: {
          en: 'Another PC connects from the same port',
          ja: '別の PC が同じポートから接続する',
        },
        description: {
          en: 'PC 2 also opens a connection to the same server, and by chance its operating system chose the same source port, 49152.',
          ja: 'PC 2 も同じサーバーに接続を開く。たまたま OS が同じ送信元ポート 49152 を選んだ。',
        },
        events: [
          set(PC2, SOCKET, `TCP ${ENDPOINTS.pc2} → ${ENDPOINTS.server}`),
          send(
            segment({
              id: 'pc2-syn-in',
              from: PC2,
              to: ROUTER,
              flags: 'SYN',
              src: ENDPOINTS.pc2,
              dst: ENDPOINTS.server,
              description: outward,
            }),
          ),
        ],
      },
      {
        id: 'pc2-map',
        title: {
          en: 'The router gives it a different external port',
          ja: 'ルーターは別の外側のポートを割り当てる',
        },
        description: {
          en: `Both PCs share the public address 203.0.113.5, so the router tells the connections apart by the external port: PC 2 gets ${ENDPOINTS.public2}. Without port translation (plain NAT), two PCs could not share one address.`,
          ja: `2 台の PC は同じグローバルアドレス 203.0.113.5 を使うので、ルーターは外側のポートで接続を見分ける。PC 2 には ${ENDPOINTS.public2} を割り当てる。ポートまで変換しない NAT なら、2 台で 1 つのアドレスを共有できない。`,
        },
        events: [
          set(ROUTER, NAT_TABLE, table([ROW_PC, ROW_PC2])),
          send(
            segment({
              id: 'pc2-syn-out',
              from: ROUTER,
              to: SERVER,
              flags: 'SYN',
              src: ENDPOINTS.public2,
              dst: ENDPOINTS.server,
              translation: srcTranslation(ENDPOINTS.pc2, ENDPOINTS.public2),
              description: onInternet,
            }),
          ),
        ],
      },
      {
        id: 'pc2-syn-ack',
        title: {
          en: 'The reply to port 40002 goes to PC 2',
          ja: 'ポート 40002 への返事は PC 2 に届く',
        },
        description: {
          en: 'The server sees two connections from the same address with different ports. The router maps port 40002 back to PC 2.',
          ja: 'サーバーからは、同じアドレスのポートが違う 2 つの接続に見える。ルーターはポート 40002 を PC 2 に戻す。',
        },
        events: [
          set(SERVER, PEER, peers(2)),
          send(
            segment({
              id: 'pc2-syn-ack-out',
              from: SERVER,
              to: ROUTER,
              flags: 'SYN, ACK',
              src: ENDPOINTS.server,
              dst: ENDPOINTS.public2,
              description: onInternet,
            }),
          ),
          send(
            segment({
              id: 'pc2-syn-ack-in',
              from: ROUTER,
              to: PC2,
              flags: 'SYN, ACK',
              src: ENDPOINTS.server,
              dst: ENDPOINTS.pc2,
              translation: dstTranslation(ENDPOINTS.public2, ENDPOINTS.pc2),
              description: outward,
            }),
          ),
        ],
      },
    )
  }

  if (options.inbound) {
    steps.push(
      {
        id: 'inbound',
        title: {
          en: 'A connection attempt arrives from the Internet',
          ja: 'インターネットから接続しようとするパケットが届く',
        },
        description: {
          en: 'A host on the Internet (here, 192.0.2.10) sends a SYN to 203.0.113.5 port 80, trying to reach a web server inside the home network.',
          ja: 'インターネットのホスト（ここでは 192.0.2.10）が、家庭のネットワークの中の Web サーバーに届けようとして、203.0.113.5 のポート 80 に SYN を送る。',
        },
        events: [
          send(
            segment({
              id: 'inbound-syn',
              from: SERVER,
              to: ROUTER,
              flags: 'SYN',
              src: '192.0.2.10:51000',
              dst: '203.0.113.5:80',
              status: 'rejected',
              description: {
                en: 'An unsolicited SYN from outside. No mapping matches it.',
                ja: '外から来た、頼んでいない SYN。どの対応にも当てはまらない。',
              },
            }),
          ),
        ],
      },
      {
        id: 'dropped',
        title: {
          en: 'No mapping: the router drops it',
          ja: '対応がない: ルーターが捨てる',
        },
        description: {
          en: 'The NAT table has no row for port 80, so the router does not know which PC should get the packet and drops it. (RFC 5382 asks the router not to answer for at least 6 seconds; afterwards it should send ICMP Port Unreachable, unless it is configured to stay silent.) To run a server at home, you add a static mapping by hand: port forwarding.',
          ja: 'NAT の変換表にポート 80 の行がないので、ルーターはどの PC に渡せばよいかわからず、パケットを捨てる（RFC 5382 は少なくとも 6 秒は答えないよう求めている。その後は ICMP の Port Unreachable を返すべきだが、設定で黙って捨ててもよい）。家庭でサーバーを動かすには、対応を手で書いておく。これがポートフォワーディング。',
        },
        events: [],
      },
    )
  }
  return steps
}

export const natScenario: Scenario<NatOptions> = {
  id: 'nat',
  title: { en: 'NAT: sharing one public address', ja: 'NAT: 1 つのグローバルアドレスを共有する' },
  actors,
  optionDefs: {
    secondPc: {
      kind: 'toggle',
      label: {
        en: 'Another PC connects from the same port',
        ja: '別の PC も同じポートから接続する',
      },
      defaultValue: true,
    },
    inbound: {
      kind: 'toggle',
      label: {
        en: 'A connection attempt arrives from the Internet',
        ja: 'インターネットから接続しようとする',
      },
      defaultValue: false,
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
