/**
 * ARP: IP アドレスから MAC アドレスを調べる
 *
 * 根拠:
 * - RFC 826（An Ethernet Address Resolution Protocol）: パケットの形式（HTYPE、PTYPE、HLEN、PLEN、OPER、SHA、SPA、THA、TPA）、
 *   要求はブロードキャスト・応答はユニキャスト、受け取った側の表の更新（対象のホストは送信元を追加し、対象でないホストは既存の行だけを更新する）
 * - RFC 1122 §2.3.2.1（ARP キャッシュの有効期限）、§2.3.2.2（解決を待つ間、パケットを待たせる）
 * - RFC 1122 §3.3.1、§3.3.1.1: 宛先が同じネットワークか（マスクとの AND）で、直接送るか、デフォルトゲートウェイに送るかを決める
 * - RFC 7042 §2.1.2（説明用の MAC アドレス 00-00-5E-00-53-00〜FF）、付録 B（EtherType 0x0806 = ARP、0x0800 = IPv4）
 * - RFC 5737（説明用の IPv4 アドレス 192.0.2.0/24 など）、RFC 1918（プライベートアドレス）
 *
 * 学習用の単純化: スイッチは描かない（実際はスイッチがブロードキャストをすべてのポートに流す）。LAN の機器は 3 台だけ。
 * 再送の回数と間隔、キャッシュの寿命は OS による（この例は Linux にならい 1 秒おきに 3 回）
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
  destination: z.enum(['internet', 'local']).catch('internet'),
  cached: z.stringbool().catch(false),
  reply: z.enum(['ok', 'none']).catch('ok'),
})
export type ArpOptions = z.infer<typeof optionsSchema>

const PC: ActorId = 'pc'
const ROUTER: ActorId = 'router'
const PC2: ActorId = 'pc2'
const NEXT_HOP: StateKey = 'nextHop'
const CACHE: StateKey = 'cache'
const PENDING: StateKey = 'pending'
export const CACHE_COLUMNS = ['IP', 'MAC'] as const

/** 説明用のアドレス（RFC 5737 / RFC 1918）と MAC アドレス（RFC 7042 §2.1.2）。MAC の最後のバイトは IP の最後の数の 16 進 */
export const ADDRESSES = {
  pc: { ip: '192.168.1.10', mac: '00:00:5e:00:53:0a' },
  router: { ip: '192.168.1.1', mac: '00:00:5e:00:53:01' },
  pc2: { ip: '192.168.1.20', mac: '00:00:5e:00:53:14' },
  server: { ip: '192.0.2.10' },
} as const
const BROADCAST_MAC = 'ff:ff:ff:ff:ff:ff'
const UNKNOWN_MAC = '00:00:00:00:00:00'
/** 応答がないときの再送の間隔（Linux の既定にならう） */
const RETRY_MS = 1000

const EMPTY: StateTable = { columns: CACHE_COLUMNS, rows: [] }
const table = (rows: readonly (readonly [string, string])[]): StateTable => ({
  columns: CACHE_COLUMNS,
  rows,
})

const cacheSlot = { key: CACHE, label: { en: 'ARP cache', ja: 'ARP キャッシュ' }, initial: EMPTY }

const actors: readonly Actor[] = [
  {
    id: PC,
    kind: 'client',
    name: { en: 'Your PC (192.168.1.10)', ja: 'PC（192.168.1.10）' },
    shortName: { en: 'PC', ja: 'PC' },
    stateSlots: [
      { key: NEXT_HOP, label: { en: 'Next hop', ja: 'ネクストホップ' }, initial: '-' },
      cacheSlot,
      {
        key: PENDING,
        label: { en: 'Packet waiting to be sent', ja: '送るのを待っているパケット' },
        initial: '-',
      },
    ],
  },
  {
    id: ROUTER,
    kind: 'router',
    name: { en: 'Router (192.168.1.1)', ja: 'ルーター（192.168.1.1）' },
    shortName: { en: 'Router', ja: 'ルーター' },
    stateSlots: [cacheSlot],
  },
  {
    id: PC2,
    kind: 'client',
    name: { en: 'Another PC (192.168.1.20)', ja: '別の PC（192.168.1.20）' },
    shortName: { en: 'PC 2', ja: 'PC 2' },
    stateSlots: [cacheSlot],
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
  ethDst: { en: 'Ethernet destination MAC address', ja: 'Ethernet の宛先の MAC アドレス' },
  ethSrc: { en: 'Ethernet source MAC address', ja: 'Ethernet の送信元の MAC アドレス' },
  ethType: { en: 'EtherType: 0x0806 is ARP', ja: 'EtherType。0x0806 は ARP' },
  htype: { en: 'Hardware type: 1 is Ethernet', ja: 'ハードウェアの種類。1 は Ethernet' },
  ptype: {
    en: 'Protocol type: 0x0800 is IPv4 (the address being resolved)',
    ja: 'プロトコルの種類。0x0800 は IPv4（調べるアドレスの種類）',
  },
  hlen: { en: 'Length of a MAC address (bytes)', ja: 'MAC アドレスの長さ（バイト）' },
  plen: { en: 'Length of an IPv4 address (bytes)', ja: 'IPv4 アドレスの長さ（バイト）' },
  sha: { en: 'Sender MAC address', ja: '送信元の MAC アドレス' },
  spa: { en: 'Sender IP address', ja: '送信元の IP アドレス' },
  tha: { en: 'Target MAC address', ja: '対象の MAC アドレス' },
  thaUnknown: {
    en: 'Target MAC address: unknown yet, so all zeros',
    ja: '対象の MAC アドレス。まだわからないので 0 を入れる',
  },
  tpa: {
    en: 'Target IP address: whose MAC address is asked for',
    ja: '対象の IP アドレス（この MAC アドレスを知りたい）',
  },
} satisfies Record<string, LocalizedText>

interface Host {
  readonly id: ActorId
  readonly ip: string
  readonly mac: string
}

const HOSTS: Readonly<Record<'router' | 'pc2', Host>> = {
  router: { id: ROUTER, ...ADDRESSES.router },
  pc2: { id: PC2, ...ADDRESSES.pc2 },
}

function requestMessage(id: string, to: ActorId, target: Host, status: Message['status']): Message {
  return {
    id,
    from: PC,
    to,
    label: `ARP who-has ${target.ip}`,
    status,
    description: {
      en: `An ARP request: “Who has ${target.ip}? Tell ${ADDRESSES.pc.ip}.” It is broadcast, so every device on the LAN receives it.`,
      ja: `ARP の要求。「${target.ip} を持っているのは誰？ ${ADDRESSES.pc.ip} に教えて」。ブロードキャストなので、LAN のすべての機器に届く。`,
    },
    fields: [
      { name: 'Eth Dst', value: BROADCAST_MAC, highlight: true, description: FIELD_TEXT.ethDst },
      { name: 'Eth Src', value: ADDRESSES.pc.mac, description: FIELD_TEXT.ethSrc },
      { name: 'EtherType', value: '0x0806', description: FIELD_TEXT.ethType },
      { name: 'HTYPE', value: '1', description: FIELD_TEXT.htype },
      { name: 'PTYPE', value: '0x0800', description: FIELD_TEXT.ptype },
      { name: 'HLEN', value: '6', description: FIELD_TEXT.hlen },
      { name: 'PLEN', value: '4', description: FIELD_TEXT.plen },
      {
        name: 'OPER',
        value: '1 (request)',
        highlight: true,
        description: { en: 'Operation: 1 is a request', ja: '操作。1 は要求' },
      },
      { name: 'SHA', value: ADDRESSES.pc.mac, description: FIELD_TEXT.sha },
      { name: 'SPA', value: ADDRESSES.pc.ip, description: FIELD_TEXT.spa },
      { name: 'THA', value: UNKNOWN_MAC, description: FIELD_TEXT.thaUnknown },
      { name: 'TPA', value: target.ip, highlight: true, description: FIELD_TEXT.tpa },
    ],
  }
}

function replyMessage(target: Host): Message {
  return {
    id: 'arp-reply',
    from: target.id,
    to: PC,
    label: `ARP is-at ${target.mac}`,
    status: 'delivered',
    description: {
      en: `The ARP reply: “${target.ip} is at ${target.mac}.” It goes only to the PC that asked (unicast), because the replying device already knows the PC’s MAC address from the request (SHA).`,
      ja: `ARP の応答。「${target.ip} は ${target.mac}」。要求の SHA で尋ねた PC の MAC アドレスがわかっているので、その PC にだけ送る（ユニキャスト）。`,
    },
    fields: [
      { name: 'Eth Dst', value: ADDRESSES.pc.mac, highlight: true, description: FIELD_TEXT.ethDst },
      { name: 'Eth Src', value: target.mac, description: FIELD_TEXT.ethSrc },
      { name: 'EtherType', value: '0x0806', description: FIELD_TEXT.ethType },
      { name: 'HTYPE', value: '1', description: FIELD_TEXT.htype },
      { name: 'PTYPE', value: '0x0800', description: FIELD_TEXT.ptype },
      { name: 'HLEN', value: '6', description: FIELD_TEXT.hlen },
      { name: 'PLEN', value: '4', description: FIELD_TEXT.plen },
      {
        name: 'OPER',
        value: '2 (reply)',
        highlight: true,
        description: { en: 'Operation: 2 is a reply', ja: '操作。2 は応答' },
      },
      {
        name: 'SHA',
        value: target.mac,
        highlight: true,
        description: {
          en: 'Sender MAC address: the answer',
          ja: '送信元の MAC アドレス。これが答え',
        },
      },
      { name: 'SPA', value: target.ip, description: FIELD_TEXT.spa },
      { name: 'THA', value: ADDRESSES.pc.mac, description: FIELD_TEXT.tha },
      {
        name: 'TPA',
        value: ADDRESSES.pc.ip,
        description: {
          en: 'Target IP address: the PC that asked',
          ja: '対象の IP アドレス。尋ねた PC',
        },
      },
    ],
  }
}

function ipMessage(target: Host, destinationIp: string): Message {
  return {
    id: 'ip',
    from: PC,
    to: target.id,
    label: `IP ${ADDRESSES.pc.ip} → ${destinationIp}`,
    status: 'delivered',
    description: {
      en: 'The waiting IP packet, now in an Ethernet frame addressed to the MAC address that ARP found.',
      ja: '待たせていた IP パケット。ARP で調べた MAC アドレス宛ての Ethernet のフレームに入れて送る。',
    },
    fields: [
      {
        name: 'Eth Dst',
        value: target.mac,
        highlight: true,
        description:
          target.id === ROUTER
            ? {
                en: 'The router’s MAC address, not the server’s: the frame only goes to the next device on the LAN',
                ja: 'サーバーではなくルーターの MAC アドレス。フレームが届くのは LAN の次の機器まで',
              }
            : FIELD_TEXT.ethDst,
      },
      { name: 'Eth Src', value: ADDRESSES.pc.mac, description: FIELD_TEXT.ethSrc },
      {
        name: 'EtherType',
        value: '0x0800',
        description: { en: 'EtherType: 0x0800 is IPv4', ja: 'EtherType。0x0800 は IPv4' },
      },
      {
        name: 'IP Src',
        value: ADDRESSES.pc.ip,
        description: { en: 'Source IP address', ja: '送信元の IP アドレス' },
      },
      {
        name: 'IP Dst',
        value: destinationIp,
        highlight: true,
        description: {
          en: 'Destination IP address: the final destination, unchanged',
          ja: '宛先の IP アドレス。最終的な宛先のまま変わらない',
        },
      },
      {
        name: 'TTL',
        value: '64',
        description: { en: 'Time to live', ja: '生存時間（TTL）' },
      },
    ],
  }
}

function buildSteps(options: ArpOptions): readonly Step[] {
  const internet = options.destination === 'internet'
  const target = internet ? HOSTS.router : HOSTS.pc2
  const bystander = internet ? HOSTS.pc2 : HOSTS.router
  const destinationIp = internet ? ADDRESSES.server.ip : ADDRESSES.pc2.ip
  const packet = `IP ${ADDRESSES.pc.ip} → ${destinationIp}`
  const known = table([[target.ip, target.mac]])

  const steps: Step[] = [
    {
      id: 'decide',
      title: internet
        ? {
            en: 'The destination is on another network: send it to the router',
            ja: '宛先は別のネットワーク: ルーターに送る',
          }
        : {
            en: 'The destination is on the same LAN: send it directly',
            ja: '宛先は同じ LAN: 直接送る',
          },
      description: internet
        ? {
            en: `The PC wants to send a packet to ${destinationIp}. ${destinationIp} AND 255.255.255.0 is 192.0.2.0, which is not the PC’s network (192.168.1.0/24), so the packet goes to the default gateway ${target.ip}. The next hop is the router.`,
            ja: `PC は ${destinationIp} にパケットを送りたい。${destinationIp} と 255.255.255.0 の AND は 192.0.2.0 で、PC のネットワーク（192.168.1.0/24）ではないので、デフォルトゲートウェイ ${target.ip} に送る。ネクストホップはルーター。`,
          }
        : {
            en: `The PC wants to send a packet to ${destinationIp}. ${destinationIp} AND 255.255.255.0 is 192.168.1.0, the PC’s own network, so the packet can go directly to ${destinationIp}.`,
            ja: `PC は ${destinationIp} にパケットを送りたい。${destinationIp} と 255.255.255.0 の AND は 192.168.1.0 で PC 自身のネットワークなので、${destinationIp} に直接送れる。`,
          },
      events: [
        set(PC, NEXT_HOP, target.ip),
        set(PC, PENDING, packet),
        ...(options.cached ? [set(PC, CACHE, known)] : []),
      ],
    },
  ]

  if (options.cached) {
    steps.push(
      {
        id: 'hit',
        title: {
          en: 'The MAC address is already in the cache',
          ja: 'MAC アドレスはキャッシュにある',
        },
        description: {
          en: `The ARP cache already has ${target.ip} → ${target.mac} from an earlier exchange, so no ARP request is needed. Old entries are removed after a while (RFC 1122 requires a way to flush stale entries, usually a timeout; the length depends on the OS).`,
          ja: `ARP キャッシュには、前のやり取りで調べた ${target.ip} → ${target.mac} がすでにあるので、ARP の要求は要らない。古い行はしばらくすると消える（RFC 1122 は古い行を消す仕組みを求めている。多くは有効期限で、長さは OS による）。`,
        },
        events: [],
      },
      sendStep(target, destinationIp),
    )
    return steps
  }

  steps.push({
    id: 'miss',
    title: {
      en: 'The MAC address is not known: hold the packet and ask',
      ja: 'MAC アドレスがわからない: パケットを待たせて尋ねる',
    },
    description: {
      en: `To put the packet in an Ethernet frame, the PC needs the MAC address of ${target.ip}. The ARP cache has no entry, so the PC keeps the packet waiting and asks with ARP.`,
      ja: `パケットを Ethernet のフレームに入れるには、${target.ip} の MAC アドレスが要る。ARP キャッシュに行がないので、PC はパケットを待たせて ARP で尋ねる。`,
    },
    events: [set(PC, CACHE, table([[target.ip, '(incomplete)']]))],
  })

  const answered = options.reply === 'ok'
  const requestEvents = (suffix: string, retransmit: boolean) => [
    send({
      ...requestMessage(
        `arp-req-target${suffix}`,
        target.id,
        target,
        answered ? 'delivered' : 'lost',
      ),
      ...(retransmit ? { retransmitOf: 'arp-req-target' } : {}),
    }),
    send({
      ...requestMessage(`arp-req-other${suffix}`, bystander.id, target, 'rejected'),
      ...(retransmit ? { retransmitOf: 'arp-req-other' } : {}),
    }),
  ]

  steps.push({
    id: 'request',
    title: { en: 'The PC broadcasts an ARP request', ja: 'PC が ARP の要求をブロードキャストする' },
    description: {
      en: `The request goes to the broadcast MAC address ff:ff:ff:ff:ff:ff, so ${answered ? 'both the router and the other PC receive it' : 'every device on the LAN that is turned on receives it'}. ${bystander.id === PC2 ? 'The other PC' : 'The router'} is not the target (TPA is not its address), so it ignores the request and does not add the PC to its cache.${answered ? '' : ` ${target.id === ROUTER ? 'The router' : 'The other PC'} is turned off, so nobody answers.`}`,
      ja: `要求はブロードキャストの MAC アドレス ff:ff:ff:ff:ff:ff 宛てなので、${answered ? 'ルーターと別の PC の両方に届く' : '電源の入っている LAN のすべての機器に届く'}。${bystander.id === PC2 ? '別の PC は' : 'ルーターは'}対象ではない（TPA が自分のアドレスではない）ので、要求を無視し、PC をキャッシュに加えない。${answered ? '' : `${target.id === ROUTER ? 'ルーターは' : '別の PC は'}電源が切れていて、誰も答えない。`}`,
    },
    events: requestEvents('', false),
  })

  if (!answered) {
    for (const attempt of [1, 2]) {
      steps.push({
        id: `retry-${String(attempt)}`,
        title: {
          en: `No reply: the PC asks again (${String(attempt + 1)} of 3)`,
          ja: `応答がない: PC がもう一度尋ねる（3 回中 ${String(attempt + 1)} 回目）`,
        },
        description: {
          en: 'No reply came within one second, so the PC broadcasts the same request again. How many times and how often to retry is up to the OS; this example follows Linux (3 tries, 1 second apart).',
          ja: '1 秒以内に応答がなかったので、PC は同じ要求をもう一度ブロードキャストする。再送の回数と間隔は OS が決める。この例は Linux にならう（1 秒おきに 3 回）。',
        },
        events: [
          { kind: 'timer', actorId: PC, name: 'ARP retry', durationMs: RETRY_MS },
          ...requestEvents(`-${String(attempt)}`, true),
        ],
      })
    }
    steps.push({
      id: 'failed',
      title: { en: 'ARP fails: the packet is dropped', ja: 'ARP に失敗: パケットを捨てる' },
      description: {
        en: `One second after the third request, still without a reply, the PC gives up. It marks the entry as failed, drops the waiting packet, and the application gets an error such as “Destination Host Unreachable”.`,
        ja: '3 回目の要求から 1 秒たっても応答がないので、PC はあきらめる。行を失敗として記録し、待たせていたパケットを捨てる。アプリケーションには「Destination Host Unreachable」などのエラーが返る。',
      },
      events: [
        { kind: 'timer', actorId: PC, name: 'ARP retry', durationMs: RETRY_MS },
        set(PC, CACHE, table([[target.ip, '(failed)']])),
        set(PC, PENDING, 'dropped'),
      ],
    })
    return steps
  }

  steps.push(
    {
      id: 'reply',
      title: {
        en: `${target.id === ROUTER ? 'The router' : 'The other PC'} replies with its MAC address`,
        ja: `${target.id === ROUTER ? 'ルーターが' : '別の PC が'} MAC アドレスを答える`,
      },
      description: {
        en: `The request is for its own address, so it first adds the PC (${ADDRESSES.pc.ip} → ${ADDRESSES.pc.mac}) to its own cache — it will probably need to answer the PC soon — and then replies directly to the PC.`,
        ja: `要求は自分のアドレス宛てなので、まず PC（${ADDRESSES.pc.ip} → ${ADDRESSES.pc.mac}）を自分のキャッシュに加え（すぐに PC に返事をすることになるため）、それから PC に直接答える。`,
      },
      events: [
        set(target.id, CACHE, table([[ADDRESSES.pc.ip, ADDRESSES.pc.mac]])),
        send(replyMessage(target)),
      ],
    },
    {
      id: 'cache',
      title: { en: 'The PC stores the answer', ja: 'PC が答えを覚える' },
      description: {
        en: `The PC adds ${target.ip} → ${target.mac} to its ARP cache, so the next packets to the same next hop need no ARP.`,
        ja: `PC は ${target.ip} → ${target.mac} を ARP キャッシュに加える。同じネクストホップへの次のパケットでは、ARP は要らない。`,
      },
      events: [set(PC, CACHE, known)],
    },
    sendStep(target, destinationIp),
  )
  return steps
}

function sendStep(target: Host, destinationIp: string): Step {
  return {
    id: 'send',
    title: { en: 'The PC sends the IP packet', ja: 'PC が IP パケットを送る' },
    description:
      target.id === ROUTER
        ? {
            en: `The frame is addressed to the router’s MAC address, while the IP packet inside still says ${destinationIp}. The router will look at the IP header and send the packet on toward the server in a new frame.`,
            ja: `フレームはルーターの MAC アドレス宛てで、中の IP パケットの宛先は ${destinationIp} のまま。ルーターは IP のヘッダーを見て、新しいフレームに入れてサーバーの方へ送る。`,
          }
        : {
            en: 'The frame is addressed to the other PC’s MAC address and arrives directly.',
            ja: 'フレームは別の PC の MAC アドレス宛てで、直接届く。',
          },
    events: [send(ipMessage(target, destinationIp)), set(PC, PENDING, 'sent')],
  }
}

export const arpScenario: Scenario<ArpOptions> = {
  id: 'arp',
  title: { en: 'ARP: from IP address to MAC address', ja: 'ARP: IP アドレスから MAC アドレスへ' },
  actors,
  optionDefs: {
    destination: {
      kind: 'select',
      label: { en: 'Destination', ja: '宛先' },
      choices: [
        {
          value: 'internet',
          label: {
            en: 'A server on the Internet (192.0.2.10)',
            ja: 'インターネットのサーバー（192.0.2.10）',
          },
        },
        {
          value: 'local',
          label: {
            en: 'Another PC on the same LAN (192.168.1.20)',
            ja: '同じ LAN の別の PC（192.168.1.20）',
          },
        },
      ],
      defaultValue: 'internet',
    },
    cached: {
      kind: 'toggle',
      label: { en: 'The MAC address is already cached', ja: 'MAC アドレスがキャッシュにある' },
      defaultValue: false,
    },
    reply: {
      kind: 'select',
      label: { en: 'The target device', ja: '対象の機器' },
      description: {
        en: 'Has no effect when the MAC address is cached.',
        ja: 'MAC アドレスがキャッシュにあるときは影響しない。',
      },
      choices: [
        { value: 'ok', label: { en: 'Is on and answers', ja: '電源が入っていて答える' } },
        { value: 'none', label: { en: 'Is turned off', ja: '電源が切れている' } },
      ],
      defaultValue: 'ok',
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
