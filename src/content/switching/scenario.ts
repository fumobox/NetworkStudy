/**
 * スイッチ: MAC アドレスを学習する
 *
 * 根拠（IEEE の規格は RFC のように本文へ直接リンクできないので、規格名・年・節の題名で引く）:
 * - IEEE Std 802.1Q-2022（2014 年に 802.1D のブリッジの規定を取り込んだ）
 *   - clause 8.6 "The Forwarding Process": 宛先が表にあればそのポートにだけ転送し、なければ受け取ったポート以外に流す
 *     （フラッディング）。ブロードキャストの宛先はいつも流す
 *   - clause 8.7 "The Learning Process": 受け取ったフレームの送信元の MAC アドレスと、受け取ったポートを表に記録する
 *     （宛先からは学習しない）
 *   - clause 8.7.3 "Ageing of dynamic filtering entries": しばらく使われない行は消える（既定 300 秒）
 *   - clause 8.8 "The Filtering Database": MAC アドレスとポートの表
 * - RFC 4188（Bridge MIB）: dot1dTpFdbTable（MAC アドレスとポートの表）、dot1dTpAgingTime（範囲 10〜1,000,000 秒、
 *   「802.1D-1998 recommends a default of 300 seconds」）
 * - RFC 9542 §2.1.2（説明用の MAC アドレス 00-00-5E-00-53-00〜FF）、付録 B（EtherType 0x0800 = IPv4、0x0806 = ARP）
 * - RFC 792（Echo Request / Echo Reply）、RFC 826（ARP）
 *
 * 学習用の単純化: スイッチは 1 台で、STP、表があふれる場合、VLAN（VLAN のテーマを参照）は扱わない。
 * ハブとの違いと全二重は概要で触れるだけ。ICMP と ARP の中身は、それぞれのテーマを参照
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
  firstFrame: z.enum(['unicast', 'broadcast']).catch('unicast'),
  known: z.stringbool().catch(false),
  aging: z.stringbool().catch(false),
})
export type SwitchingOptions = z.infer<typeof optionsSchema>

const PC: ActorId = 'pc'
const SWITCH: ActorId = 'switch'
const ROUTER: ActorId = 'router'
const PC2: ActorId = 'pc2'
const MAC_TABLE: StateKey = 'macTable'
const DECISION: StateKey = 'decision'
const LAST_FRAME: StateKey = 'lastFrame'
const ARP_CACHE: StateKey = 'arpCache'
export const MAC_COLUMNS = ['MAC', 'Port'] as const
/** エージングタイムの既定（IEEE 802.1Q、RFC 4188 dot1dTpAgingTime） */
export const AGEING_MS = 300_000

/** Phase 4 のテーマと同じアドレス（RFC 1918、RFC 9542 §2.1.2）と、つながっているポート */
export const HOSTS = {
  pc: { ip: '192.168.1.10', mac: '00:00:5e:00:53:0a', port: 1 },
  router: { ip: '192.168.1.1', mac: '00:00:5e:00:53:01', port: 2 },
  pc2: { ip: '192.168.1.20', mac: '00:00:5e:00:53:14', port: 3 },
} as const
const BROADCAST_MAC = 'ff:ff:ff:ff:ff:ff'

const macTable = (rows: readonly (readonly [string, number])[]): StateTable => ({
  columns: MAC_COLUMNS,
  rows: rows.map(([mac, port]) => [mac, String(port)]),
})
const ROW_PC = [HOSTS.pc.mac, HOSTS.pc.port] as const
const ROW_ROUTER = [HOSTS.router.mac, HOSTS.router.port] as const

const lastFrameSlot = {
  key: LAST_FRAME,
  label: { en: 'Last frame from the switch', ja: 'スイッチから届いた最後のフレーム' },
  initial: '-',
}

const actors: readonly Actor[] = [
  {
    id: PC,
    kind: 'client',
    name: { en: 'Your PC (port 1)', ja: 'PC（ポート 1）' },
    shortName: { en: 'PC', ja: 'PC' },
    stateSlots: [
      { key: ARP_CACHE, label: { en: 'ARP cache', ja: 'ARP キャッシュ' }, initial: '-' },
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
      { key: DECISION, label: { en: 'What the switch did', ja: 'スイッチの判断' }, initial: '-' },
    ],
  },
  {
    id: ROUTER,
    kind: 'router',
    name: { en: 'Router (port 2)', ja: 'ルーター（ポート 2）' },
    shortName: { en: 'Router', ja: 'ルーター' },
    stateSlots: [lastFrameSlot],
  },
  {
    id: PC2,
    kind: 'client',
    name: { en: 'Another PC (port 3)', ja: '別の PC（ポート 3）' },
    shortName: { en: 'PC 2', ja: 'PC 2' },
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

const FIELD_TEXT = {
  ethDst: {
    en: 'Destination MAC address: the only thing the switch looks up',
    ja: '宛先の MAC アドレス。スイッチが表で探すのはこれだけ',
  },
  ethSrc: {
    en: 'Source MAC address: what the switch learns',
    ja: '送信元の MAC アドレス。スイッチが学習するのはこれ',
  },
  broadcast: {
    en: 'The broadcast address: the switch always floods it',
    ja: 'ブロードキャストのアドレス。スイッチはいつも全ポートに流す',
  },
  ingress: {
    en: 'The switch port the frame came in on',
    ja: 'フレームが入ってきたスイッチのポート',
  },
  egress: {
    en: 'The switch port the frame goes out of',
    ja: 'フレームが出ていくスイッチのポート',
  },
} satisfies Record<string, LocalizedText>

/** フレームの種類ごとの中身 */
interface FrameSpec {
  readonly label: string
  readonly dst: string
  readonly src: string
  readonly etherType: string
  readonly payload: readonly PacketField[]
}

const ECHO_REQUEST: FrameSpec = {
  label: `Echo Request → ${HOSTS.router.mac}`,
  dst: HOSTS.router.mac,
  src: HOSTS.pc.mac,
  etherType: '0x0800 (IPv4)',
  payload: [
    { name: 'IP Src → Dst', value: `${HOSTS.pc.ip} → 192.0.2.10` },
    { name: 'ICMP type', value: '8 (Echo Request)' },
  ],
}
const ECHO_REPLY: FrameSpec = {
  label: `Echo Reply → ${HOSTS.pc.mac}`,
  dst: HOSTS.pc.mac,
  src: HOSTS.router.mac,
  etherType: '0x0800 (IPv4)',
  payload: [
    { name: 'IP Src → Dst', value: `192.0.2.10 → ${HOSTS.pc.ip}` },
    { name: 'ICMP type', value: '0 (Echo Reply)' },
  ],
}
const ARP_REQUEST: FrameSpec = {
  label: `ARP who-has ${HOSTS.router.ip}`,
  dst: BROADCAST_MAC,
  src: HOSTS.pc.mac,
  etherType: '0x0806 (ARP)',
  payload: [
    { name: 'OPER', value: '1 (request)' },
    { name: 'TPA', value: HOSTS.router.ip },
  ],
}
const ARP_REPLY: FrameSpec = {
  label: `ARP is-at ${HOSTS.router.mac}`,
  dst: HOSTS.pc.mac,
  src: HOSTS.router.mac,
  etherType: '0x0806 (ARP)',
  payload: [
    { name: 'OPER', value: '2 (reply)' },
    { name: 'SHA', value: HOSTS.router.mac },
  ],
}

interface PortField {
  readonly kind: 'ingress' | 'egress'
  readonly port: number
}

function frame(
  id: string,
  from: ActorId,
  to: ActorId,
  spec: FrameSpec,
  port: PortField,
  status: Message['status'] = 'delivered',
): Message {
  const broadcast = spec.dst === BROADCAST_MAC
  return {
    id,
    from,
    to,
    label: spec.label,
    status,
    fields: [
      {
        name: port.kind === 'ingress' ? 'Ingress port' : 'Egress port',
        value: String(port.port),
        description: port.kind === 'ingress' ? FIELD_TEXT.ingress : FIELD_TEXT.egress,
      },
      {
        name: 'Eth Dst',
        value: spec.dst,
        highlight: true,
        description: broadcast ? FIELD_TEXT.broadcast : FIELD_TEXT.ethDst,
      },
      { name: 'Eth Src', value: spec.src, description: FIELD_TEXT.ethSrc },
      { name: 'EtherType', value: spec.etherType },
      ...spec.payload,
    ],
  }
}

/** スイッチがフレームを流す（宛先が不明、またはブロードキャスト）。ルーターは受け取り、PC 2 は捨てる */
function floodEvents(idPrefix: string, spec: FrameSpec, pc2Status: string): StepEvent[] {
  return [
    send(frame(`${idPrefix}-router`, SWITCH, ROUTER, spec, { kind: 'egress', port: 2 })),
    send(frame(`${idPrefix}-pc2`, SWITCH, PC2, spec, { kind: 'egress', port: 3 }, 'rejected')),
    set(ROUTER, LAST_FRAME, 'accepted'),
    set(PC2, LAST_FRAME, pc2Status),
  ]
}

function buildSteps(options: SwitchingOptions): readonly Step[] {
  const { firstFrame, known, aging } = options
  const broadcast = firstFrame === 'broadcast'
  const first = broadcast ? ARP_REQUEST : ECHO_REQUEST
  const answer = broadcast ? ARP_REPLY : ECHO_REPLY
  const pc2Drop = broadcast ? 'ignored (not the target)' : 'dropped (not my MAC)'
  // 学習済みの表（known のときは最初から、そうでなければ応答で学ぶ）
  const initialRows = known ? [ROW_ROUTER] : []

  const steps: Step[] = [
    {
      id: 'start',
      title: known
        ? { en: 'The switch already knows the router', ja: 'スイッチはルーターをすでに知っている' }
        : { en: 'Three devices, one switch', ja: '3 台の機器と 1 台のスイッチ' },
      description: known
        ? {
            en: 'The router sent a frame a moment ago, so its MAC address is already in the MAC address table with port 2. The PC’s address is not.',
            ja: 'ルーターが少し前にフレームを送ったので、その MAC アドレスはポート 2 として MAC アドレステーブルに入っている。PC のアドレスはまだない。',
          }
        : {
            en: `The PC, the router and another PC are plugged into ports 1, 2 and 3 of a switch that has just been turned on: its MAC address table is empty. ${broadcast ? 'The PC wants to ping via the router but does not know the router’s MAC address yet.' : 'The PC already knows the router’s MAC address from ARP (see the ARP theme) and wants to ping via the router.'}`,
            ja: `PC、ルーター、別の PC が、電源を入れたばかりのスイッチのポート 1、2、3 につながっている。MAC アドレステーブルは空。${broadcast ? 'PC はルーター経由で ping したいが、ルーターの MAC アドレスをまだ知らない。' : 'PC は ARP でルーターの MAC アドレスを知っていて（ARP のテーマを参照）、ルーター経由で ping したい。'}`,
          },
      events: [
        set(SWITCH, MAC_TABLE, macTable(initialRows)),
        ...(broadcast ? [] : [set(PC, ARP_CACHE, `${HOSTS.router.ip} → ${HOSTS.router.mac}`)]),
      ],
    },
    {
      id: 'frame1',
      title: broadcast
        ? { en: 'The PC broadcasts an ARP request', ja: 'PC が ARP の要求をブロードキャストする' }
        : { en: 'The PC sends a frame to the router', ja: 'PC がルーター宛てのフレームを送る' },
      description: {
        en: 'The frame enters the switch on port 1. Before anything else, the switch learns: the source MAC address 00:00:5e:00:53:0a is behind port 1. It never learns from the destination address.',
        ja: 'フレームはポート 1 からスイッチに入る。スイッチはまず学習する。送信元の MAC アドレス 00:00:5e:00:53:0a はポート 1 の先にいる。宛先のアドレスからは学習しない。',
      },
      events: [
        send(frame('frame1', PC, SWITCH, first, { kind: 'ingress', port: 1 })),
        set(SWITCH, MAC_TABLE, macTable([...initialRows, ROW_PC])),
        set(SWITCH, DECISION, 'learn: port 1'),
      ],
    },
  ]

  if (broadcast) {
    steps.push({
      id: 'flood',
      title: {
        en: 'A broadcast goes to every other port',
        ja: 'ブロードキャストはほかの全ポートに流す',
      },
      description: {
        en: `The destination is the broadcast address ff:ff:ff:ff:ff:ff, so the switch sends the frame out of every port except the one it came in on, whatever its table says${known ? ' (even though it knows the router)' : ''}. PC 2 receives it too, but it is not the target of the ARP request, so it ignores it.`,
        ja: `宛先はブロードキャストのアドレス ff:ff:ff:ff:ff:ff なので、スイッチは表の内容に関係なく、入ってきたポート以外のすべてのポートにフレームを流す${known ? '（ルーターを知っていても）' : ''}。PC 2 にも届くが、ARP の要求の対象ではないので無視する。`,
      },
      events: [...floodEvents('flood', first, pc2Drop), set(SWITCH, DECISION, 'flood: broadcast')],
    })
  } else if (known) {
    steps.push({
      id: 'forward-known',
      title: { en: 'Destination known: only port 2', ja: '宛先を知っている: ポート 2 にだけ送る' },
      description: {
        en: 'The switch looks up the destination 00:00:5e:00:53:01 in its table, finds port 2, and sends the frame out of port 2 only. PC 2 never sees it.',
        ja: 'スイッチは宛先の 00:00:5e:00:53:01 を表で探してポート 2 を見つけ、ポート 2 にだけフレームを送る。PC 2 には届かない。',
      },
      events: [
        send(frame('forward1', SWITCH, ROUTER, first, { kind: 'egress', port: 2 })),
        set(ROUTER, LAST_FRAME, 'accepted'),
        set(SWITCH, DECISION, 'forward: port 2'),
      ],
    })
  } else {
    steps.push({
      id: 'flood',
      title: {
        en: 'Destination unknown: flood to every other port',
        ja: '宛先を知らない: ほかの全ポートに流す',
      },
      description: {
        en: 'The destination 00:00:5e:00:53:01 is not in the table yet, so the switch cannot know where it is. It floods the frame out of every port except port 1. The router accepts it; PC 2 sees a destination that is not its own MAC address and drops it.',
        ja: '宛先の 00:00:5e:00:53:01 はまだ表にないので、スイッチにはどこにいるかわからない。ポート 1 以外のすべてのポートにフレームを流す（フラッディング）。ルーターは受け取り、PC 2 は宛先が自分の MAC アドレスではないので捨てる。',
      },
      events: [...floodEvents('flood', first, pc2Drop), set(SWITCH, DECISION, 'flood: ports 2, 3')],
    })
  }

  const routerRows = known ? [ROW_ROUTER, ROW_PC] : [ROW_PC, ROW_ROUTER]
  steps.push(
    {
      id: 'reply',
      title: {
        en: 'The router answers; the switch learns port 2',
        ja: 'ルーターが答え、スイッチがポート 2 を学習する',
      },
      description: known
        ? {
            en: 'The router’s answer enters on port 2. The router is already in the table; seeing it again refreshes the entry so that it does not age out.',
            ja: 'ルーターの答えはポート 2 から入る。ルーターはすでに表にあり、もう一度見たことで行が新しくなり、エージングで消えなくなる。',
          }
        : {
            en: 'The router’s answer enters the switch on port 2. The switch learns again from the source address: 00:00:5e:00:53:01 is behind port 2.',
            ja: 'ルーターの答えはポート 2 からスイッチに入る。スイッチはまた送信元のアドレスから学習する。00:00:5e:00:53:01 はポート 2 の先にいる。',
          },
      events: [
        send(frame('reply', ROUTER, SWITCH, answer, { kind: 'ingress', port: 2 })),
        set(SWITCH, MAC_TABLE, macTable(routerRows)),
        set(SWITCH, DECISION, known ? 'refresh: port 2' : 'learn: port 2'),
      ],
    },
    {
      id: 'forward-reply',
      title: { en: 'The answer goes to port 1 only', ja: '答えはポート 1 にだけ送る' },
      description: {
        en: 'The destination 00:00:5e:00:53:0a was learned in the first step, so the switch sends the answer out of port 1 only. No flooding, and PC 2 receives nothing.',
        ja: '宛先の 00:00:5e:00:53:0a は最初のステップで学習済みなので、スイッチは答えをポート 1 にだけ送る。フラッディングはせず、PC 2 には何も届かない。',
      },
      events: [
        send(frame('forward-reply', SWITCH, PC, answer, { kind: 'egress', port: 1 })),
        set(SWITCH, DECISION, 'forward: port 1'),
        ...(broadcast ? [set(PC, ARP_CACHE, `${HOSTS.router.ip} → ${HOSTS.router.mac}`)] : []),
      ],
    },
  )

  if (aging) {
    steps.push({
      id: 'ageing',
      title: { en: 'Nothing is sent for 5 minutes', ja: '5 分間、何も送られない' },
      description: {
        en: 'Entries that are not refreshed are removed after the ageing time (300 seconds by default). This way, a device that moves to another port is learned again instead of being sent to the old port forever.',
        ja: '新しくならない行は、エージングタイム（既定では 300 秒）が過ぎると消える。こうすると、別のポートに移った機器も、古いポートに送られ続けることなく学習し直せる。',
      },
      events: [
        { kind: 'timer', actorId: SWITCH, name: 'ageing', durationMs: AGEING_MS },
        set(SWITCH, MAC_TABLE, macTable([])),
        set(SWITCH, DECISION, 'aged out'),
      ],
    })
  }

  steps.push({
    id: 'frame2',
    title: aging
      ? { en: 'The next frame is flooded again', ja: '次のフレームはまた流される' }
      : { en: 'The next frame: no flooding', ja: '次のフレーム: もう流さない' },
    description: aging
      ? {
          en: 'The table is empty again, so the switch learns port 1 once more and floods the frame, just like the first time.',
          ja: '表はまた空になったので、スイッチはもう一度ポート 1 を学習し、最初と同じようにフレームを流す。',
        }
      : {
          en: 'The PC sends the next Echo Request. The switch knows the router is behind port 2 and sends the frame there only. From now on, traffic between the PC and the router never reaches PC 2.',
          ja: 'PC が次の Echo Request を送る。スイッチはルーターがポート 2 の先にいると知っているので、そこにだけ送る。これ以降、PC とルーターの間の通信は PC 2 に届かない。',
        },
    events: [
      send(frame('frame2', PC, SWITCH, ECHO_REQUEST, { kind: 'ingress', port: 1 })),
      ...(aging
        ? [
            set(SWITCH, MAC_TABLE, macTable([ROW_PC])),
            ...floodEvents('flood2', ECHO_REQUEST, 'dropped (not my MAC)'),
            set(SWITCH, DECISION, 'flood: ports 2, 3'),
          ]
        : [
            send(frame('forward2', SWITCH, ROUTER, ECHO_REQUEST, { kind: 'egress', port: 2 })),
            set(ROUTER, LAST_FRAME, 'accepted'),
            set(SWITCH, DECISION, 'forward: port 2'),
          ]),
    ],
  })
  return steps
}

export const switchingScenario: Scenario<SwitchingOptions> = {
  id: 'switching',
  title: {
    en: 'Switching: how a switch learns MAC addresses',
    ja: 'スイッチ: MAC アドレスを学習する',
  },
  actors,
  optionDefs: {
    firstFrame: {
      kind: 'select',
      label: { en: 'The PC’s first frame', ja: 'PC の最初のフレーム' },
      choices: [
        {
          value: 'unicast',
          label: { en: 'Echo Request to the router', ja: 'ルーター宛ての Echo Request' },
        },
        {
          value: 'broadcast',
          label: { en: 'ARP request (broadcast)', ja: 'ARP の要求（ブロードキャスト）' },
        },
      ],
      defaultValue: 'unicast',
    },
    known: {
      kind: 'toggle',
      label: {
        en: 'The switch already knows the router’s port',
        ja: 'スイッチはルーターのポートをすでに知っている',
      },
      defaultValue: false,
    },
    aging: {
      kind: 'toggle',
      label: {
        en: 'Wait longer than the ageing time before the next frame',
        ja: '次のフレームの前に、エージングタイムより長く待つ',
      },
      defaultValue: false,
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
