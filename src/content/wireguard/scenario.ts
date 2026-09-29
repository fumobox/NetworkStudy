/**
 * WireGuard: 公開鍵で結ぶリモートアクセス VPN
 *
 * 根拠（RFC ではない。仕様はホワイトペーパー）:
 * - J. A. Donenfeld「WireGuard: Next Generation Kernel Network Tunnel」NDSS 2017（改訂版 e2da747、2020-06-01）
 *   - §2（暗号鍵ルーティング）、§2.1（エンドポイントとローミング）、§3（送受信の手順）
 *   - §5（1 往復のハンドシェイク。応じた側は、相手の最初のデータを受け取るまで送らない）、§5.1（TAI64N の時刻、答えないこと）
 *   - §5.3・§5.4.4・§5.4.7（mac1、mac2、cookie）、§5.4.2〜§5.4.6（メッセージの形式。messages.ts）、§6（タイマー。timers.ts）
 * - wireguard.com「Protocol & Cryptography」（フィールドの名前と大きさ）、「Quick Start」（PersistentKeepalive は 25 秒が目安）
 * - Noise Protocol Framework Revision 34 §7.5、§9（IKpsk2: `-> e, es, s, ss` と `<- e, ee, se, psk`。事前共有鍵がなければ 0）
 * - RFC 7748（X25519）、RFC 8439（ChaCha20-Poly1305。WireGuard の文書は、置き換えられた RFC 7539 を引く）、RFC 7693（BLAKE2s）、
 *   RFC 5869（HKDF）
 * - RFC 6479（リプレイの窓。replay.ts）、RFC 4787 §4.1・§4.3（NAT の UDP の対応。nat.ts）、RFC 1918・RFC 5737（アドレス）
 * - RFC 792（Destination Unreachable）
 *
 * 標準ではなく実装で決まるもの（概要で書き分ける）: wg(8)（ListenPort は省略するとランダム、PersistentKeepalive、Endpoint の更新）、
 * wg-quick(8)（MTU は経路の MTU − 80、AllowedIPs への経路）、Linux の drivers/net/wireguard（リプレイの窓 8128、既定の MTU 1420、
 * 「負荷が高い」の判定、外側に DF を立てない、ピアのない宛先に ICMP を返す、エンドポイントの更新は内側の送信元の確認より前）。
 * ポート 51820 は慣例の値で、IANA の登録はない
 *
 * 学習用の単純化: IPv4 だけ。鍵、インデックス、ノンス、cookie、時刻は名前か例の値で、暗号の計算はしない。事前共有鍵は使わない。
 * 送り直しのゆらぎ（0〜333 ms）とレート制限は描かない。「負荷が高い」は状態で示し、大量の偽のハンドシェイクは 1 本の矢印にする。
 * NAT は endpoint-independent mapping で、ポートは順に選ぶ。NAT の UDP の対応の寿命は 30 秒の例（RFC 4787 REQ-5 の 2 分より短い機器の例）。
 * 家とカフェのルーターは 1 本のレーン。VPN サーバーは NAT せずに転送し、内部のサーバーは 10.8.0.0/24 への経路を持つ。
 * 内側は ICMP の Echo だけで、断片化と DNS は描かない。ステップの間の、描かない通信は省く
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
import { inboundAllowed, outboundPeer, type AllowedIp } from './cryptokey'
import {
  COOKIE_REPLY_LAYOUT,
  dataMessageLength,
  DEFAULT_MTU,
  INITIATION_LAYOUT,
  layoutLength,
  outerIpLength,
  RESPONSE_LAYOUT,
  UDP_HEADER,
} from './messages'
import {
  EMPTY_SLOTS,
  initiatorAdds,
  KEYPAIR_COLUMNS,
  receivedWith,
  responderAdds,
  slotRows,
  type KeypairSlots,
} from './keypairs'
import { createNat, inbound, NAT_COLUMNS, natRows, outbound, type TimedNat } from './nat'
import { checkCounter, describeReplay, INITIAL_REPLAY, type ReplayState } from './replay'
import { REKEY_AFTER_TIME, REKEY_TIMEOUT } from './timers'

const SITUATIONS = ['handshake', 'rejected', 'roaming', 'keepalive', 'rekey', 'underLoad'] as const

const optionsSchema = z.object({
  situation: z.enum(SITUATIONS).catch('handshake'),
})
export type WireguardOptions = z.infer<typeof optionsSchema>
type Situation = WireguardOptions['situation']

const LAPTOP: ActorId = 'laptop'
const NAT: ActorId = 'nat'
const ATTACKER: ActorId = 'attacker'
const SERVER: ActorId = 'server'
const INTERNAL: ActorId = 'internal'

const IFACE: StateKey = 'iface'
const WG: StateKey = 'wg'
const PEERS: StateKey = 'peers'
const KEYPAIRS: StateKey = 'keypairs'
const DECISION: StateKey = 'decision'
const NAT_TABLE: StateKey = 'nat'
const NAT_TIMER: StateKey = 'timer'
const RECORDED: StateKey = 'recorded'
const REPLAY: StateKey = 'replay'
const TIMESTAMP: StateKey = 'timestamp'
const LOAD: StateKey = 'load'
const RECEIVED: StateKey = 'received'

export const LAPTOP_PEER_COLUMNS = [
  'Peer',
  'Endpoint',
  'AllowedIPs',
  'Latest handshake',
  'Keepalive',
] as const
export const SERVER_PEER_COLUMNS = ['Peer', 'Endpoint', 'AllowedIPs', 'Latest handshake'] as const
export const RECORDED_COLUMNS = ['Packet', 'Captured from'] as const

export const ADDR = {
  laptopLan: '192.168.1.10',
  laptopCafe: '172.16.5.23',
  laptopPort: 47111,
  homePublic: '203.0.113.5',
  cafePublic: '198.51.100.7',
  server: '192.0.2.1',
  serverPort: 51820,
  attacker: '198.51.100.66',
  laptopTunnel: '10.8.0.2',
  phoneTunnel: '10.8.0.3',
  internal: '10.10.0.20',
} as const

const SERVER_ENDPOINT = `${ADDR.server}:${String(ADDR.serverPort)}`
const LAPTOP_HOME = `${ADDR.laptopLan}:${String(ADDR.laptopPort)}`
const LAPTOP_CAFE = `${ADDR.laptopCafe}:${String(ADDR.laptopPort)}`
/** NAT の UDP の対応の寿命。キープアライブの状況は、RFC 4787 REQ-5 の 2 分より短い機器の例（30 秒）。ほかは REQ-5 の 2 分 */
export const NAT_TIMEOUT = 30
export const RFC_NAT_TIMEOUT = 120

/** 例の値のインデックス（実際は乱数） */
export const INDEX = {
  laptop1: '0x6c1f00a1',
  server1: '0x9e4b7702',
  laptop2: '0x2d8a33c5',
  server2: '0x51f0e9b4',
  laptopRetry: '0x7b21c4e0',
} as const

const LAPTOP_TABLE: readonly AllowedIp[] = [
  { prefix: '10.8.0.0/24', peer: 'pub:server' },
  { prefix: '10.10.0.0/24', peer: 'pub:server' },
]
const SERVER_TABLE: readonly AllowedIp[] = [
  { prefix: '10.8.0.2/32', peer: 'pub:laptop' },
  { prefix: '10.8.0.3/32', peer: 'pub:phone' },
]

const table = (
  columns: readonly string[],
  rows: readonly (readonly string[])[] = [],
): StateTable => ({
  columns,
  rows,
})
const set = (actorId: ActorId, key: StateKey, value: string | StateTable): StepEvent => ({
  kind: 'stateChange',
  actorId,
  key,
  value,
})
const send = (message: Message): StepEvent => ({ kind: 'message', message })
const timer = (actorId: ActorId, name: string, durationMs: number): StepEvent => ({
  kind: 'timer',
  actorId,
  name,
  durationMs,
})

const actors: readonly Actor[] = [
  {
    id: LAPTOP,
    kind: 'client',
    name: { en: `Laptop (${ADDR.laptopTunnel})`, ja: `ノート PC（${ADDR.laptopTunnel}）` },
    shortName: { en: 'Laptop', ja: 'ノート PC' },
    stateSlots: [
      { key: IFACE, label: { en: 'Interfaces', ja: 'インターフェース' }, initial: '-' },
      {
        key: WG,
        label: { en: 'WireGuard interface', ja: 'WireGuard のインターフェース' },
        initial: '-',
      },
      { key: PEERS, label: { en: 'Peers', ja: 'ピア' }, initial: table(LAPTOP_PEER_COLUMNS) },
      { key: KEYPAIRS, label: { en: 'Keypairs', ja: '鍵の組' }, initial: table(KEYPAIR_COLUMNS) },
      { key: DECISION, label: { en: 'What the laptop did', ja: 'ノート PC の判断' }, initial: '-' },
    ],
  },
  {
    id: NAT,
    kind: 'router',
    name: { en: 'Wi-Fi router (NAT)', ja: 'Wi-Fi のルーター（NAT）' },
    shortName: { en: 'NAT', ja: 'NAT' },
    stateSlots: [
      {
        key: NAT_TABLE,
        label: { en: 'NAT table', ja: 'NAT の変換表' },
        initial: table(NAT_COLUMNS),
      },
      {
        key: NAT_TIMER,
        label: { en: 'UDP mapping lifetime', ja: 'UDP の対応の寿命' },
        initial: '-',
      },
    ],
  },
  {
    id: ATTACKER,
    kind: 'client',
    name: { en: 'Attacker on the Internet', ja: 'インターネットの攻撃者' },
    shortName: { en: 'Attacker', ja: '攻撃者' },
    stateSlots: [
      {
        key: RECORDED,
        label: { en: 'Recorded packets', ja: '記録したパケット' },
        initial: table(RECORDED_COLUMNS),
      },
    ],
  },
  {
    id: SERVER,
    kind: 'server',
    name: { en: `VPN server (${SERVER_ENDPOINT})`, ja: `VPN サーバー（${SERVER_ENDPOINT}）` },
    shortName: { en: 'VPN server', ja: 'VPN サーバー' },
    stateSlots: [
      {
        key: WG,
        label: { en: 'WireGuard interface', ja: 'WireGuard のインターフェース' },
        initial: '-',
      },
      { key: PEERS, label: { en: 'Peers', ja: 'ピア' }, initial: table(SERVER_PEER_COLUMNS) },
      {
        key: KEYPAIRS,
        label: { en: 'Keypairs (laptop)', ja: '鍵の組（ノート PC）' },
        initial: table(KEYPAIR_COLUMNS),
      },
      { key: REPLAY, label: { en: 'Replay window', ja: 'リプレイの窓' }, initial: '-' },
      {
        key: TIMESTAMP,
        label: { en: 'Newest timestamp (laptop)', ja: 'いちばん新しい時刻（ノート PC）' },
        initial: '-',
      },
      { key: LOAD, label: { en: 'Load', ja: '負荷' }, initial: 'not under load' },
      { key: DECISION, label: { en: 'What the server did', ja: 'サーバーの判断' }, initial: '-' },
    ],
  },
  {
    id: INTERNAL,
    kind: 'server',
    name: { en: `Internal server (${ADDR.internal})`, ja: `内部のサーバー（${ADDR.internal}）` },
    shortName: { en: 'Internal', ja: '内部' },
    stateSlots: [
      {
        key: RECEIVED,
        label: { en: 'Last packet received', ja: '最後に受け取ったパケット' },
        initial: '-',
      },
    ],
  },
]

// ---------- フィールド ----------

const FIELD_TEXT = {
  outerSrc: {
    en: 'Outer source address and UDP port. The NAT rewrites it; the server learns the laptop’s endpoint from it',
    ja: '外側の送信元のアドレスと UDP のポート。NAT が書き換える。サーバーはここからノート PC のエンドポイントを知る',
  },
  outerDst: {
    en: 'Outer destination address and UDP port',
    ja: '外側の宛先のアドレスと UDP のポート',
  },
  ipLength: {
    en: 'Length of the outer IP packet: the WireGuard message, plus UDP (8) and IPv4 (20)',
    ja: '外側の IP パケットの長さ。WireGuard のメッセージに、UDP（8）と IPv4（20）を足したもの',
  },
  type: { en: 'Message type: 1 to 4', ja: 'メッセージの種類。1〜4' },
  sender: {
    en: 'The sender’s index for this handshake (an example value; random in reality). The peer puts it in the Receiver field of its replies',
    ja: 'このハンドシェイクの、送る側のインデックス（例の値。実際は乱数）。相手は返事の Receiver に入れる',
  },
  receiver: {
    en: 'The index the receiver chose: it finds the keypair with it, without trying keys',
    ja: '受け取る側が選んだインデックス。鍵を試さずに、これで鍵の組を見つける',
  },
  ephemeral: {
    en: 'A fresh ephemeral public key (X25519), sent in the clear. A new one for every handshake',
    ja: '新しい一時的な公開鍵（X25519）。暗号化せずに送る。ハンドシェイクのたびに新しくする',
  },
  static: {
    en: 'The laptop’s static public key, encrypted with a key only the laptop and the server can compute (from DH of the ephemeral key and the server’s static key). Observers cannot tell who is connecting',
    ja: 'ノート PC の静的な公開鍵。ノート PC とサーバーだけが計算できる鍵（一時的な鍵とサーバーの静的な鍵の DH から）で暗号化する。見ている者には、誰がつないでいるかわからない',
  },
  timestamp: {
    en: 'An encrypted TAI64N timestamp. The server accepts an initiation only if it is newer than the last one, so a recorded initiation cannot be replayed',
    ja: '暗号化した TAI64N の時刻。サーバーは前より新しいときだけ受け入れるので、記録したハンドシェイクを送り直しても通らない',
  },
  empty: {
    en: 'An empty payload with an authentication tag: it proves the server derived the same keys',
    ja: '空の中身と認証のタグ。サーバーが同じ鍵を導いたことを示す',
  },
  mac1: {
    en: 'A MAC keyed with the recipient’s public key. Anyone who does not know the public key cannot get a reply',
    ja: '受け取る側の公開鍵を鍵にした MAC。公開鍵を知らない者は、返事をもらえない',
  },
  mac2: {
    en: 'A MAC keyed with a cookie from the server. Only needed when the server is under load',
    ja: 'サーバーからもらった cookie を鍵にした MAC。サーバーの負荷が高いときだけ要る',
  },
  counter: {
    en: 'The message counter of this keypair: the AEAD nonce, and the number checked against the replay window',
    ja: 'この鍵の組のメッセージのカウンター。認証付き暗号のノンスで、リプレイの窓で確かめる番号',
  },
  inner: {
    en: 'The inner packet, encrypted and authenticated with ChaCha20-Poly1305 (shown for learning)',
    ja: '内側のパケット。ChaCha20-Poly1305 で暗号化し、認証する（学習のために中身を示している）',
  },
  padding: {
    en: 'Zero padding up to a multiple of 16 bytes, inside the encryption, so lengths leak less',
    ja: '暗号化の中で、16 バイトの倍数まで 0 で詰める。長さから漏れることを減らす',
  },
  tag: { en: 'The 16-byte Poly1305 authentication tag', ja: '16 バイトの Poly1305 の認証のタグ' },
  nonce: { en: 'A random 24-byte nonce (example)', ja: '24 バイトの乱数のノンス（例）' },
  cookie: {
    en: 'The cookie, a MAC of the initiator’s IP address and port under a secret that changes every 2 minutes, encrypted with XChaCha20-Poly1305',
    ja: 'cookie。2 分ごとに変わる秘密で、始めた側の IP アドレスとポートから作った MAC。XChaCha20-Poly1305 で暗号化する',
  },
  src: { en: 'Source address', ja: '送信元のアドレス' },
  dst: { en: 'Destination address', ja: '宛先のアドレス' },
} as const satisfies Record<string, LocalizedText>

interface WgMessage {
  readonly label: string
  /** UDP の中身（WireGuard のメッセージ）の長さ */
  readonly length: number
  readonly fields: readonly PacketField[]
  readonly description: LocalizedText
  readonly encrypted: boolean
}

function initiation(
  index: string,
  ephemeral: string,
  time: string,
  mac2: string,
  description: LocalizedText,
  label = 'Handshake Initiation',
): WgMessage {
  return {
    label,
    length: layoutLength(INITIATION_LAYOUT),
    encrypted: false,
    description,
    fields: [
      { name: 'Type', value: '1 (initiation)', description: FIELD_TEXT.type },
      { name: 'Sender', value: index, highlight: true, description: FIELD_TEXT.sender },
      { name: 'Ephemeral', value: ephemeral, description: FIELD_TEXT.ephemeral },
      { name: 'Static', value: 'AEAD(k, pub:laptop)', description: FIELD_TEXT.static },
      { name: 'Timestamp', value: `AEAD(k, TAI64N ${time})`, description: FIELD_TEXT.timestamp },
      { name: 'mac1', value: 'MAC(pub:server, …)', description: FIELD_TEXT.mac1 },
      { name: 'mac2', value: mac2, description: FIELD_TEXT.mac2 },
    ],
  }
}

function response(
  sender: string,
  receiver: string,
  keypair: string,
  description: LocalizedText,
): WgMessage {
  return {
    label: 'Handshake Response',
    length: layoutLength(RESPONSE_LAYOUT),
    encrypted: false,
    description,
    fields: [
      { name: 'Type', value: '2 (response)', description: FIELD_TEXT.type },
      { name: 'Sender', value: sender, highlight: true, description: FIELD_TEXT.sender },
      { name: 'Receiver', value: receiver, description: FIELD_TEXT.receiver },
      { name: 'Ephemeral', value: `E_pub(server ${keypair})`, description: FIELD_TEXT.ephemeral },
      { name: 'Empty', value: 'AEAD(k, empty)', description: FIELD_TEXT.empty },
      { name: 'mac1', value: 'MAC(pub:laptop, …)', description: FIELD_TEXT.mac1 },
      { name: 'mac2', value: '0 (no cookie)', description: FIELD_TEXT.mac2 },
    ],
  }
}

interface Inner {
  readonly name: string
  readonly src: string
  readonly dst: string
  /** 内側の IP パケットの長さ（キープアライブは 0） */
  readonly length: number
}
const echoRequest = (src: string, dst: string): Inner => ({
  name: 'Echo Request',
  src,
  dst,
  length: 84,
})
const echoReply = (src: string, dst: string): Inner => ({
  name: 'Echo Reply',
  src,
  dst,
  length: 84,
})
const KEEPALIVE: Inner = { name: 'keepalive', src: '-', dst: '-', length: 0 }

function data(
  keypair: string,
  receiver: string,
  counter: number,
  inner: Inner,
  description: LocalizedText,
  suffix = '',
): WgMessage {
  const length = dataMessageLength(inner.length, DEFAULT_MTU)
  const padding = length - 32 - inner.length
  return {
    label: `Data ${keypair} ctr ${String(counter)} [${inner.name}]${suffix}`,
    length,
    encrypted: true,
    description,
    fields: [
      { name: 'Type', value: '4 (transport data)', description: FIELD_TEXT.type },
      { name: 'Receiver', value: receiver, description: FIELD_TEXT.receiver },
      { name: 'Counter', value: String(counter), highlight: true, description: FIELD_TEXT.counter },
      ...(inner.length === 0
        ? []
        : [
            { name: 'Inner Src', value: inner.src, description: FIELD_TEXT.inner },
            { name: 'Inner Dst', value: inner.dst, description: FIELD_TEXT.inner },
            { name: 'Inner Length', value: String(inner.length), description: FIELD_TEXT.inner },
          ]),
      { name: 'Padding', value: String(padding), description: FIELD_TEXT.padding },
      { name: 'Tag', value: 'Poly1305 (16)', description: FIELD_TEXT.tag },
    ],
  }
}

function cookieReply(receiver: string, description: LocalizedText): WgMessage {
  return {
    label: 'Cookie Reply',
    length: layoutLength(COOKIE_REPLY_LAYOUT),
    encrypted: true,
    description,
    fields: [
      { name: 'Type', value: '3 (cookie reply)', description: FIELD_TEXT.type },
      { name: 'Receiver', value: receiver, description: FIELD_TEXT.receiver },
      { name: 'Nonce', value: 'n (24 bytes)', description: FIELD_TEXT.nonce },
      {
        name: 'Cookie',
        value: `XAEAD(τ = MAC(R_m, ${ADDR.homePublic}:40001))`,
        highlight: true,
        description: FIELD_TEXT.cookie,
      },
    ],
  }
}

function packet(
  id: string,
  from: ActorId,
  to: ActorId,
  src: string,
  dst: string,
  message: WgMessage,
  status: Message['status'] = 'delivered',
): Message {
  return {
    id,
    from,
    to,
    label: message.label,
    status,
    description: message.description,
    ...(message.encrypted ? { encrypted: true } : {}),
    fields: [
      { name: 'Outer Src', value: src, highlight: from === NAT, description: FIELD_TEXT.outerSrc },
      {
        name: 'Outer Dst',
        value: dst,
        highlight: to === NAT && from === SERVER,
        description: FIELD_TEXT.outerDst,
      },
      {
        name: 'IP Length',
        value: String(outerIpLength(message.length)),
        description: FIELD_TEXT.ipLength,
      },
      {
        name: 'UDP Length',
        value: String(message.length + UDP_HEADER),
        description: FIELD_TEXT.ipLength,
      },
      ...message.fields,
    ],
  }
}

function plain(
  id: string,
  from: ActorId,
  to: ActorId,
  inner: Inner,
  status: Message['status'] = 'delivered',
): Message {
  return {
    id,
    from,
    to,
    label: `${inner.name} ${inner.src} → ${inner.dst}`,
    status,
    description: {
      en: 'An ordinary IP packet inside the office network: no WireGuard here.',
      ja: 'オフィスのネットワークの中のふつうの IP パケット。ここには WireGuard はない。',
    },
    fields: [
      { name: 'Src', value: inner.src, description: FIELD_TEXT.src },
      { name: 'Dst', value: inner.dst, description: FIELD_TEXT.dst },
      { name: 'Length', value: String(inner.length), description: FIELD_TEXT.inner },
    ],
  }
}

// ---------- モデル ----------

/**
 * NAT の対応、両側の鍵の組、サーバーから見たエンドポイントとリプレイの窓を持ち回り、矢印とともにイベントを作る。
 * 大きさ、NAT の変換、鍵の組、リプレイの判定は messages.ts・nat.ts・keypairs.ts・replay.ts から求める
 */
class WgModel {
  nat: TimedNat
  laptopSlots: KeypairSlots = EMPTY_SLOTS
  serverSlots: KeypairSlots = EMPTY_SLOTS
  replay: Record<string, ReplayState> = {}
  endpoint = '-'
  laptopInside = LAPTOP_HOME
  latestHandshake = '-'
  keepalive = 'off'

  constructor(natTimeout: number = RFC_NAT_TIMEOUT) {
    this.nat = createNat(ADDR.homePublic, 40001, natTimeout)
  }

  natEvent(now: number): StepEvent {
    return set(NAT, NAT_TABLE, table(NAT_COLUMNS, natRows(this.nat, now)))
  }

  laptopPeers(): StepEvent {
    return set(
      LAPTOP,
      PEERS,
      table(LAPTOP_PEER_COLUMNS, [
        [
          'pub:server',
          SERVER_ENDPOINT,
          '10.8.0.0/24, 10.10.0.0/24',
          this.latestHandshake,
          this.keepalive,
        ],
      ]),
    )
  }

  serverPeers(): StepEvent {
    return set(
      SERVER,
      PEERS,
      table(SERVER_PEER_COLUMNS, [
        ['pub:laptop', this.endpoint, '10.8.0.2/32', this.latestHandshake],
        ['pub:phone', '-', '10.8.0.3/32', '-'],
      ]),
    )
  }

  slots(): StepEvent[] {
    return [
      set(LAPTOP, KEYPAIRS, table(KEYPAIR_COLUMNS, slotRows(this.laptopSlots))),
      set(SERVER, KEYPAIRS, table(KEYPAIR_COLUMNS, slotRows(this.serverSlots))),
    ]
  }

  /** ノート PC からサーバーへ（NAT を通る 2 本の矢印）。サーバーのエンドポイントは、認証できたら外側の送信元にする */
  up(
    id: string,
    message: WgMessage,
    now: number,
    options: { readonly authenticated?: boolean } = {},
  ): StepEvent[] {
    const result = outbound(this.nat, this.laptopInside, SERVER_ENDPOINT, now)
    this.nat = result.nat
    const events: StepEvent[] = [
      send(packet(`${id}-lan`, LAPTOP, NAT, this.laptopInside, SERVER_ENDPOINT, message)),
      this.natEvent(now),
      send(packet(`${id}-wan`, NAT, SERVER, result.external, SERVER_ENDPOINT, message)),
    ]
    if (options.authenticated ?? true) {
      const changed = this.endpoint !== result.external
      this.endpoint = result.external
      if (changed) {
        events.push(this.serverPeers())
      }
    }
    return events
  }

  /** サーバーからノート PC へ。NAT に対応がなければ NAT で捨てられる */
  down(id: string, message: WgMessage, now: number): StepEvent[] {
    const internal = inbound(this.nat, this.endpoint, now)
    if (internal === null) {
      return [
        send(packet(`${id}-wan`, SERVER, NAT, SERVER_ENDPOINT, this.endpoint, message, 'rejected')),
        this.natEvent(now),
      ]
    }
    return [
      send(packet(`${id}-wan`, SERVER, NAT, SERVER_ENDPOINT, this.endpoint, message)),
      send(packet(`${id}-lan`, NAT, LAPTOP, SERVER_ENDPOINT, internal, message)),
    ]
  }

  /** サーバーがデータを受け取る: リプレイの窓、鍵の確認 */
  serverReceives(keypair: string, counter: number): StepEvent[] {
    const result = checkCounter(this.replay[keypair] ?? INITIAL_REPLAY, counter)
    if (!result.accepted) {
      throw new Error(`replay: ${keypair} ${String(counter)}`)
    }
    this.replay = { ...this.replay, [keypair]: result.next }
    this.serverSlots = receivedWith(this.serverSlots, keypair)
    return [set(SERVER, REPLAY, `${keypair} ${describeReplay(result.next)}`), ...this.slots()]
  }
}

// ---------- 準備 ----------

function baseSetup(model: WgModel): StepEvent[] {
  return [
    set(
      LAPTOP,
      IFACE,
      `wlan0 ${ADDR.laptopLan}/24; wg0 ${ADDR.laptopTunnel}/24 mtu ${String(DEFAULT_MTU)}`,
    ),
    set(LAPTOP, WG, `wg0: pub:laptop, port ${String(ADDR.laptopPort)} (random)`),
    set(SERVER, WG, `wg0: pub:server, port ${String(ADDR.serverPort)}`),
    set(NAT, NAT_TIMER, `UDP mapping ${String(model.nat.timeout)} s (example)`),
    model.laptopPeers(),
    model.serverPeers(),
    ...model.slots(),
  ]
}

const SETUP_TEXT = {
  en: `A laptop at home reaches the office network, 10.10.0.0/24, through a WireGuard VPN server. Each side knows the other only by its public key. The laptop’s peer is pub:server at ${SERVER_ENDPOINT}, with AllowedIPs 10.8.0.0/24 and 10.10.0.0/24: packets to those addresses go into the tunnel, and only packets from them are accepted from it. The server’s peer pub:laptop has AllowedIPs 10.8.0.2/32. The laptop is behind the home router’s NAT.`,
  ja: `家のノート PC が、WireGuard の VPN サーバーを通してオフィスのネットワーク 10.10.0.0/24 に届く。どちらの側も、相手を公開鍵だけで知っている。ノート PC のピアは ${SERVER_ENDPOINT} の pub:server で、AllowedIPs は 10.8.0.0/24 と 10.10.0.0/24。これらのアドレスへのパケットはトンネルに入り、トンネルからはこれらのアドレスからのパケットだけを受け入れる。サーバーのピア pub:laptop の AllowedIPs は 10.8.0.2/32。ノート PC は家のルーターの NAT の内側にいる。`,
} as const

const insideText = {
  en: 'The inner packet is encrypted: the NAT and anyone on the Internet see only a UDP packet between two addresses.',
  ja: '内側のパケットは暗号化されている。NAT やインターネットの誰にも、2 つのアドレスの間の UDP のパケットしか見えない。',
}

/** ハンドシェイクを済ませる（準備に使う。矢印は描かない） */
function establish(model: WgModel, now: number): void {
  model.nat = outbound(model.nat, model.laptopInside, SERVER_ENDPOINT, now).nat
  model.endpoint = `${ADDR.homePublic}:40001`
  model.laptopSlots = initiatorAdds(EMPTY_SLOTS, '#1')
  model.serverSlots = receivedWith(responderAdds(EMPTY_SLOTS, '#1'), '#1')
  model.latestHandshake = `t = ${String(now)} s`
}

// ---------- 状況ごとのステップ ----------

function handshakeSteps(): Step[] {
  const model = new WgModel()
  const ping = echoRequest(ADDR.laptopTunnel, ADDR.internal)
  const pong = echoReply(ADDR.internal, ADDR.laptopTunnel)
  const out = outboundPeer(LAPTOP_TABLE, ADDR.internal)
  const initiationEvents = model.up(
    'initiation',
    initiation(INDEX.laptop1, 'E_pub(laptop #1)', 't = 0 s', '0 (no cookie)', {
      en: 'The first handshake message: an ephemeral key in the clear, the laptop’s identity and a timestamp encrypted for the server.',
      ja: '最初のハンドシェイクのメッセージ。暗号化しない一時的な鍵と、サーバー向けに暗号化した、ノート PC の身元と時刻。',
    }),
    0,
  )
  const handshakeSection = { en: 'Handshake', ja: 'ハンドシェイク' }
  const dataSection = { en: 'Encrypted with keypair #1', ja: '鍵の組 #1 で暗号化' }
  return [
    {
      id: 'setup',
      title: { en: 'Two peers, known by their public keys', ja: '公開鍵で知り合う 2 つのピア' },
      description: {
        en: `${SETUP_TEXT.en} There is no session yet, and the NAT has no mapping.`,
        ja: `${SETUP_TEXT.ja}まだセッションはなく、NAT にも対応はない。`,
      },
      events: baseSetup(model),
    },
    {
      id: 'initiation',
      section: handshakeSection,
      title: {
        en: 'A packet for the office starts a handshake',
        ja: 'オフィスへのパケットがハンドシェイクを始める',
      },
      description: {
        en: `An app pings ${ADDR.internal}. The route sends it to wg0, and cryptokey routing looks up the destination in AllowedIPs: 10.10.0.0/24 belongs to ${String(out)}. There is no session with that peer yet, so the packet waits and the laptop sends a Handshake Initiation (148 bytes). The NAT creates a mapping for the laptop’s UDP port.`,
        ja: `アプリが ${ADDR.internal} に ping する。経路は wg0 へ送り、暗号鍵ルーティングは宛先を AllowedIPs で引く。10.10.0.0/24 は ${String(out)} のもの。そのピアとはまだセッションがないので、パケットは待ち、ノート PC は Handshake Initiation（148 バイト）を送る。NAT はノート PC の UDP のポートの対応を作る。`,
      },
      events: [
        set(LAPTOP, DECISION, `out: ${ADDR.internal} → ${String(out)} (10.10.0.0/24), no session`),
        ...initiationEvents,
        set(SERVER, TIMESTAMP, 'TAI64N t = 0 s'),
      ],
    },
    {
      id: 'response',
      section: handshakeSection,
      title: {
        en: 'The server identifies the laptop and responds',
        ja: 'サーバーがノート PC だと確かめて応答する',
      },
      description: {
        en: `The server checks mac1, computes the key, and decrypts the static key: it is pub:laptop, one of its peers. The timestamp is newer than any before, so the initiation is fresh. The server learns the endpoint ${model.endpoint} (the NAT’s address, not the laptop’s), derives keypair #1, and keeps it as “next”: it cannot yet be sure the laptop has the same keys. It sends a Handshake Response (92 bytes). The handshake takes one round trip.`,
        ja: `サーバーは mac1 を確かめ、鍵を計算して静的な鍵を復号する。自分のピアの pub:laptop だ。時刻はこれまでより新しいので、新しいハンドシェイクだとわかる。サーバーはエンドポイント ${model.endpoint}（ノート PC ではなく NAT のアドレス）を知り、鍵の組 #1 を導いて「next」に置く。ノート PC が同じ鍵を持っているかは、まだ確かでない。Handshake Response（92 バイト）を送る。ハンドシェイクは 1 往復で終わる。`,
      },
      events: (() => {
        model.serverSlots = responderAdds(model.serverSlots, '#1')
        return [
          set(SERVER, DECISION, 'initiation from pub:laptop, timestamp newer: respond'),
          ...model.slots(),
          ...model.down(
            'response',
            response(INDEX.server1, INDEX.laptop1, '#1', {
              en: 'The server’s ephemeral key, and an empty payload that proves it derived the same keys.',
              ja: 'サーバーの一時的な鍵と、同じ鍵を導いたことを示す空の中身。',
            }),
            0,
          ),
        ]
      })(),
    },
    {
      id: 'first-data',
      section: dataSection,
      title: { en: 'The laptop sends the waiting ping', ja: 'ノート PC が待っていた ping を送る' },
      description: {
        en: 'The laptop derives the same keypair #1 and makes it current. The waiting Echo Request goes out as a Transport Data message: the server’s index, counter 0, and the packet encrypted with ChaCha20-Poly1305. 84 bytes padded to 96 become a 128-byte message in a 156-byte IP packet.',
        ja: 'ノート PC は同じ鍵の組 #1 を導いて current にする。待っていた Echo Request は Transport Data のメッセージで出ていく。サーバーのインデックス、カウンター 0、ChaCha20-Poly1305 で暗号化したパケット。84 バイトを 96 まで詰め、128 バイトのメッセージ、156 バイトの IP パケットになる。',
      },
      events: (() => {
        model.laptopSlots = initiatorAdds(model.laptopSlots, '#1')
        model.latestHandshake = 't = 0 s'
        return [
          ...model.slots(),
          model.laptopPeers(),
          ...model.up('ping', data('#1', INDEX.server1, 0, ping, insideText), 0),
        ]
      })(),
    },
    {
      id: 'deliver',
      section: dataSection,
      title: {
        en: 'The server checks the source and forwards',
        ja: 'サーバーが送信元を確かめて転送する',
      },
      description: {
        en: `The server finds keypair #1 by its index, the tag is valid, and counter 0 passes the replay window. This first data message confirms the keys: #1 becomes current. Then cryptokey routing checks the inner source: ${ADDR.laptopTunnel} belongs to pub:laptop, the peer that sent it, so the packet is accepted and forwarded to the office network as a plain IP packet.`,
        ja: `サーバーはインデックスで鍵の組 #1 を見つけ、タグは正しく、カウンター 0 はリプレイの窓を通る。この最初のデータで鍵が確認でき、#1 は current になる。次に暗号鍵ルーティングが内側の送信元を確かめる。${ADDR.laptopTunnel} は送ってきたピア pub:laptop のものなので受け入れ、ふつうの IP パケットとしてオフィスのネットワークに転送する。`,
      },
      events: [
        ...model.serverReceives('#1', 0),
        model.serverPeers(),
        set(
          SERVER,
          DECISION,
          `in: src ${ADDR.laptopTunnel} is pub:laptop (${inboundAllowed(SERVER_TABLE, 'pub:laptop', ADDR.laptopTunnel) ? 'allowed' : 'dropped'})`,
        ),
        send(plain('forward', SERVER, INTERNAL, ping)),
        set(INTERNAL, RECEIVED, `Echo Request from ${ADDR.laptopTunnel}`),
      ],
    },
    {
      id: 'reply',
      section: dataSection,
      title: { en: 'The reply goes back through the tunnel', ja: '返事がトンネルを通って戻る' },
      description: {
        en: `The internal server replies to ${ADDR.laptopTunnel}. On the VPN server, cryptokey routing picks the peer for that destination, pub:laptop, and encrypts with its keypair #1, counter 0 in this direction. It sends to the endpoint it learned, and the NAT maps the packet back to the laptop.`,
        ja: `内部のサーバーは ${ADDR.laptopTunnel} に返事をする。VPN サーバーでは、暗号鍵ルーティングがその宛先のピア pub:laptop を選び、鍵の組 #1 で暗号化する（この向きのカウンターは 0）。知ったエンドポイントに送り、NAT がノート PC へ戻す。`,
      },
      events: [
        send(plain('reply', INTERNAL, SERVER, pong)),
        set(
          SERVER,
          DECISION,
          `out: ${ADDR.laptopTunnel} → ${String(outboundPeer(SERVER_TABLE, ADDR.laptopTunnel))}`,
        ),
        ...model.down('pong', data('#1', INDEX.laptop1, 0, pong, insideText), 0),
      ],
    },
    {
      id: 'received',
      section: dataSection,
      title: { en: 'The laptop accepts the reply', ja: 'ノート PC が返事を受け入れる' },
      description: {
        en: `The laptop checks the inner source ${ADDR.internal}: it is in 10.10.0.0/24, which belongs to pub:server, the peer that sent it. The ping has gone through. If the laptop sends nothing in the next 10 seconds, it will send a keepalive, so that the server knows the reply arrived.`,
        ja: `ノート PC は内側の送信元 ${ADDR.internal} を確かめる。10.10.0.0/24 に入り、送ってきたピア pub:server のもの。ping が通った。この後 10 秒のあいだ何も送らなければ、返事が届いたことをサーバーに知らせるため、キープアライブを送る。`,
      },
      events: [set(LAPTOP, DECISION, `in: src ${ADDR.internal} is pub:server (allowed)`)],
    },
  ]
}

function rejectedSteps(): Step[] {
  const model = new WgModel()
  establish(model, 0)
  for (let counter = 0; counter <= 7; counter++) {
    model.replay = {
      ...model.replay,
      '#1': (() => {
        const r = checkCounter(model.replay['#1'] ?? INITIAL_REPLAY, counter)
        return r.accepted ? r.next : INITIAL_REPLAY
      })(),
    }
  }
  const home = `${ADDR.homePublic}:40001`
  const attackerSend = (
    id: string,
    message: WgMessage,
    status: Message['status'],
    src: string = home,
  ) => send(packet(id, ATTACKER, SERVER, src, SERVER_ENDPOINT, message, status))
  return [
    {
      id: 'setup',
      title: { en: 'An attacker has recorded packets', ja: '攻撃者がパケットを記録した' },
      description: {
        en: `${SETUP_TEXT.en} The laptop and the server already have keypair #1, and the server has received counters 0 to 7. An attacker on the path recorded the laptop’s Handshake Initiation and a data message with counter 5.`,
        ja: `${SETUP_TEXT.ja}ノート PC とサーバーはすでに鍵の組 #1 を持ち、サーバーはカウンター 0〜7 を受け取った。経路上の攻撃者は、ノート PC の Handshake Initiation と、カウンター 5 のデータを記録した。`,
      },
      events: [
        ...baseSetup(model),
        model.natEvent(0),
        set(SERVER, REPLAY, `#1 ${describeReplay(model.replay['#1'] ?? INITIAL_REPLAY)}`),
        set(SERVER, TIMESTAMP, 'TAI64N t = 0 s'),
        set(
          ATTACKER,
          RECORDED,
          table(RECORDED_COLUMNS, [
            ['Handshake Initiation', home],
            ['Data #1 ctr 5', home],
          ]),
        ),
      ],
    },
    {
      id: 'replayed-initiation',
      title: { en: 'A replayed handshake is ignored', ja: '送り直したハンドシェイクは無視される' },
      description: {
        en: 'The attacker sends the recorded initiation again, with the laptop’s address as the source. mac1 is valid and the server decrypts the static key: pub:laptop. But the timestamp is not newer than the last one it saw, so the server drops it without answering. The attacker cannot make a new initiation without the laptop’s private key, and the endpoint does not change.',
        ja: '攻撃者は記録したハンドシェイクを、ノート PC のアドレスを送信元にして送り直す。mac1 は正しく、サーバーは静的な鍵を復号する。pub:laptop だ。しかし時刻は前に見たものより新しくないので、サーバーは答えずに捨てる。攻撃者は、ノート PC の秘密鍵なしに新しいハンドシェイクを作れない。エンドポイントも変わらない。',
      },
      events: [
        attackerSend(
          'replayed-initiation',
          initiation(
            INDEX.laptop1,
            'E_pub(laptop #1)',
            't = 0 s',
            '0 (no cookie)',
            {
              en: 'A byte-for-byte copy of an old initiation.',
              ja: '古いハンドシェイクの、そのままのコピー。',
            },
            'Handshake Initiation (replayed)',
          ),
          'rejected',
        ),
        set(SERVER, DECISION, 'drop: timestamp not newer (replay)'),
      ],
    },
    {
      id: 'replayed-data',
      title: { en: 'A replayed data message is rejected', ja: '送り直したデータは捨てられる' },
      description: {
        en: 'The attacker replays the data message with counter 5, this time from its own address, hoping the server will take it as the laptop’s new endpoint. The index finds keypair #1 and the tag is genuine, but counter 5 has already been received: the replay window rejects it. Because the check happens before the endpoint is updated, the server does not start sending to the attacker.',
        ja: '攻撃者はカウンター 5 のデータを、今度は自分のアドレスから送り直す。サーバーがノート PC の新しいエンドポイントだと思うことをねらっている。インデックスで鍵の組 #1 が見つかり、タグも本物だが、カウンター 5 はもう受け取っている。リプレイの窓が捨てる。エンドポイントを変える前に確かめるので、サーバーが攻撃者へ送り始めることはない。',
      },
      events: [
        attackerSend(
          'replayed-data',
          data(
            '#1',
            INDEX.server1,
            5,
            echoRequest(ADDR.laptopTunnel, ADDR.internal),
            insideText,
            ' (replayed)',
          ),
          'rejected',
          `${ADDR.attacker}:61000`,
        ),
        set(
          SERVER,
          DECISION,
          `drop: counter 5 already seen (${checkCounter(model.replay['#1'] ?? INITIAL_REPLAY, 5).accepted ? 'new' : 'duplicate'})`,
        ),
      ],
    },
    {
      id: 'forged',
      title: { en: 'A forged message fails authentication', ja: '偽のメッセージは認証を通らない' },
      description: {
        en: 'The attacker changes some bytes of a data message. The Poly1305 tag no longer matches, so the server drops it. It sends nothing back: WireGuard stays silent to packets it cannot authenticate.',
        ja: '攻撃者はデータのバイトをいくつか変える。Poly1305 のタグが合わなくなり、サーバーは捨てる。何も返さない。WireGuard は、認証できないパケットには黙っている。',
      },
      events: [
        attackerSend(
          'forged',
          data(
            '#1',
            INDEX.server1,
            9,
            echoRequest(ADDR.laptopTunnel, ADDR.internal),
            insideText,
            ' (forged)',
          ),
          'rejected',
        ),
        set(SERVER, DECISION, 'drop: tag does not verify'),
      ],
    },
    {
      id: 'wrong-source',
      title: {
        en: 'An authenticated peer cannot use another peer’s address',
        ja: '認証できたピアでも、ほかのピアのアドレスは使えない',
      },
      description: {
        en: `Now the laptop itself sends a packet with the inner source ${ADDR.phoneTunnel}. It is correctly encrypted and authenticated, but cryptokey routing looks up the source: ${ADDR.phoneTunnel} belongs to pub:phone, not to pub:laptop, which sent it. The server drops it. Each peer can only speak for its own AllowedIPs.`,
        ja: `今度はノート PC 自身が、内側の送信元を ${ADDR.phoneTunnel} にしたパケットを送る。正しく暗号化され認証もできるが、暗号鍵ルーティングが送信元を引くと、${ADDR.phoneTunnel} は送ってきた pub:laptop ではなく pub:phone のもの。サーバーは捨てる。どのピアも、自分の AllowedIPs の分しか名乗れない。`,
      },
      events: [
        ...model.up(
          'wrong-source',
          data('#1', INDEX.server1, 8, echoRequest(ADDR.phoneTunnel, ADDR.internal), insideText),
          1,
        ),
        ...model.serverReceives('#1', 8),
        set(
          SERVER,
          DECISION,
          `drop: src ${ADDR.phoneTunnel} is ${String(outboundPeer(SERVER_TABLE, ADDR.phoneTunnel))}, not pub:laptop (${inboundAllowed(SERVER_TABLE, 'pub:laptop', ADDR.phoneTunnel) ? 'allowed' : 'dropped'})`,
        ),
      ],
    },
    {
      id: 'no-peer',
      title: { en: 'No peer for the destination', ja: '宛先のピアがない' },
      description: {
        en: 'The internal server sends a packet to 10.8.0.9, which no peer’s AllowedIPs contain. The VPN server has no key to encrypt it with, so it drops it; Linux also answers with an ICMP Destination Unreachable (host).',
        ja: '内部のサーバーが、どのピアの AllowedIPs にも入っていない 10.8.0.9 にパケットを送る。VPN サーバーには暗号化する鍵がないので捨てる。Linux は ICMP の Destination Unreachable（host）も返す。',
      },
      events: [
        send(
          plain('no-peer', INTERNAL, SERVER, echoRequest(ADDR.internal, '10.8.0.9'), 'rejected'),
        ),
        set(
          SERVER,
          DECISION,
          `drop: no peer for 10.8.0.9 (${String(outboundPeer(SERVER_TABLE, '10.8.0.9'))})`,
        ),
        send({
          id: 'unreachable',
          from: SERVER,
          to: INTERNAL,
          label: 'Destination Unreachable (host)',
          status: 'delivered',
          description: {
            en: 'An ICMP error back to the sender (RFC 792).',
            ja: '送った側への ICMP のエラー（RFC 792）。',
          },
          fields: [
            { name: 'Src', value: '10.10.0.1', description: FIELD_TEXT.src },
            { name: 'Dst', value: ADDR.internal, description: FIELD_TEXT.dst },
          ],
        }),
      ],
    },
  ]
}

function roamingSteps(): Step[] {
  const model = new WgModel()
  establish(model, 0)
  const ping = echoRequest(ADDR.laptopTunnel, ADDR.internal)
  const pong = echoReply(ADDR.internal, ADDR.laptopTunnel)
  const cafe = createNat(ADDR.cafePublic, 50001, RFC_NAT_TIMEOUT)
  return [
    {
      id: 'setup',
      title: { en: 'A session is running at home', ja: '家でセッションが続いている' },
      description: {
        en: `${SETUP_TEXT.en} The laptop and the server already have keypair #1. The server sends to the laptop at ${model.endpoint}, the home router’s address.`,
        ja: `${SETUP_TEXT.ja}ノート PC とサーバーはすでに鍵の組 #1 を持つ。サーバーは家のルーターのアドレス ${model.endpoint} へ送っている。`,
      },
      events: [...baseSetup(model), model.natEvent(0)],
    },
    {
      id: 'home',
      title: { en: 'A ping from home', ja: '家からの ping' },
      description: {
        en: 'A round trip through the home router, as a baseline.',
        ja: '家のルーターを通る 1 往復。比べるための基準。',
      },
      events: [
        ...model.up('home-ping', data('#1', INDEX.server1, 0, ping, insideText), 0),
        ...model.serverReceives('#1', 0),
        ...model.down('home-pong', data('#1', INDEX.laptop1, 0, pong, insideText), 0),
      ],
    },
    {
      id: 'move',
      title: { en: 'The laptop moves to a café', ja: 'ノート PC がカフェに移る' },
      description: {
        en: `The laptop joins the café’s Wi-Fi and gets ${ADDR.laptopCafe}. wg0, its address 10.8.0.2, the keys and the UDP port stay the same, so no new handshake is needed. The server does not know about the move yet: anything it sent now would go to the old home address and be lost. It is up to the laptop, the side that moved, to send first. The router lane now stands for the café’s router.`,
        ja: `ノート PC はカフェの Wi-Fi に参加し、${ADDR.laptopCafe} を得る。wg0 とそのアドレス 10.8.0.2、鍵、UDP のポートは変わらないので、新しいハンドシェイクは要らない。サーバーはまだ移ったことを知らない。今送ると、古い家のアドレスに届いて失われる。先に送るのは、移った側のノート PC。ルーターのレーンは、ここからカフェのルーターを表す。`,
      },
      events: (() => {
        model.nat = cafe
        model.laptopInside = LAPTOP_CAFE
        return [
          set(
            LAPTOP,
            IFACE,
            `wlan0 ${ADDR.laptopCafe}/24; wg0 ${ADDR.laptopTunnel}/24 mtu ${String(DEFAULT_MTU)}`,
          ),
          model.natEvent(10),
        ]
      })(),
    },
    {
      id: 'roam',
      title: {
        en: 'The first packet from the café updates the endpoint',
        ja: 'カフェからの最初のパケットがエンドポイントを変える',
      },
      description: {
        en: `The laptop sends its next data message. The café’s NAT maps it to ${ADDR.cafePublic}:50001. The server authenticates it with keypair #1 and, because it is a genuine packet from pub:laptop, takes its source as the new endpoint. An attacker cannot do this with a forged or replayed packet: only authenticated, new packets move the endpoint.`,
        ja: `ノート PC は次のデータを送る。カフェの NAT はそれを ${ADDR.cafePublic}:50001 に対応づける。サーバーは鍵の組 #1 で認証し、pub:laptop からの本物のパケットなので、その送信元を新しいエンドポイントにする。攻撃者は偽のパケットや送り直したパケットでこれをできない。エンドポイントを動かすのは、認証できた新しいパケットだけ。`,
      },
      events: [
        ...model.up('cafe-ping', data('#1', INDEX.server1, 1, ping, insideText), 10),
        ...model.serverReceives('#1', 1),
        set(SERVER, DECISION, `endpoint → ${ADDR.cafePublic}:50001 (authenticated)`),
      ],
    },
    {
      id: 'cafe-reply',
      title: { en: 'Replies follow the laptop', ja: '返事がノート PC を追う' },
      description: {
        en: 'The server now sends to the café’s address, and the reply arrives. The keys and the latest handshake are unchanged: the connection simply moved with the laptop.',
        ja: 'サーバーはカフェのアドレスへ送り、返事が届く。鍵も最新のハンドシェイクも変わらない。接続はノート PC といっしょに移っただけ。',
      },
      events: model.down('cafe-pong', data('#1', INDEX.laptop1, 1, pong, insideText), 10),
    },
  ]
}

function keepaliveSteps(): Step[] {
  const model = new WgModel(NAT_TIMEOUT)
  establish(model, 0)
  const ping = echoRequest(ADDR.laptopTunnel, ADDR.internal)
  const pong = echoReply(ADDR.internal, ADDR.laptopTunnel)
  const monitor = echoRequest(ADDR.internal, ADDR.laptopTunnel)
  const monitorReply = echoReply(ADDR.laptopTunnel, ADDR.internal)
  let serverCounter = 0
  let laptopCounter = 0
  const fromLaptop = (inner: Inner) => data('#1', INDEX.server1, laptopCounter++, inner, insideText)
  const fromServer = (inner: Inner) => data('#1', INDEX.laptop1, serverCounter++, inner, insideText)
  return [
    {
      id: 'setup',
      title: {
        en: 'A session behind a NAT with a short timeout',
        ja: '対応の寿命が短い NAT の内側のセッション',
      },
      description: {
        en: `${SETUP_TEXT.en} The laptop and the server have keypair #1 at t = 0 s. This home router forgets an idle UDP mapping after ${String(NAT_TIMEOUT)} seconds. RFC 4787 asks for at least 2 minutes, but shorter timers exist in practice. The office’s monitoring server pings the laptop from time to time.`,
        ja: `${SETUP_TEXT.ja}ノート PC とサーバーは t = 0 s に鍵の組 #1 を持った。この家のルーターは、使われない UDP の対応を ${String(NAT_TIMEOUT)} 秒で忘れる。RFC 4787 は 2 分以上を求めるが、実際にはもっと短いものもある。オフィスの監視のサーバーが、ときどきノート PC に ping する。`,
      },
      events: [...baseSetup(model), model.natEvent(0)],
    },
    {
      id: 'ping',
      title: {
        en: 't = 0 s: a ping, then a passive keepalive',
        ja: 't = 0 s: ping と、受け身のキープアライブ',
      },
      description: {
        en: 'The laptop pings the office and gets a reply. It then has nothing to send, so 10 seconds later it sends a keepalive: an empty data message of 32 bytes, telling the server the reply arrived. It also refreshes the NAT mapping.',
        ja: 'ノート PC がオフィスに ping し、返事を受け取る。その後送るものがないので、10 秒後にキープアライブ（中身のない 32 バイトのデータ）を送り、返事が届いたことをサーバーに知らせる。NAT の対応の時間も延びる。',
      },
      events: [
        ...model.up('ping', fromLaptop(ping), 0),
        ...model.serverReceives('#1', 0),
        ...model.down('pong', fromServer(pong), 0),
        timer(LAPTOP, 'KEEPALIVE_TIMEOUT', 10_000),
        ...model.up('passive', fromLaptop(KEEPALIVE), 10),
        ...model.serverReceives('#1', 1),
      ],
    },
    {
      id: 'expire',
      title: { en: 'The NAT forgets the mapping', ja: 'NAT が対応を忘れる' },
      description: {
        en: `Nothing crosses the NAT for ${String(NAT_TIMEOUT)} seconds, so at t = 40 s the router removes the mapping. Neither peer notices.`,
        ja: `${String(NAT_TIMEOUT)} 秒のあいだ何も NAT を通らないので、t = 40 s にルーターは対応を消す。どちらのピアも気づかない。`,
      },
      events: [timer(NAT, 'UDP mapping timeout', NAT_TIMEOUT * 1000), model.natEvent(40)],
    },
    {
      id: 'blocked',
      title: {
        en: 't = 45 s: the office cannot reach the laptop',
        ja: 't = 45 s: オフィスからノート PC に届かない',
      },
      description: {
        en: 'The monitoring server pings the laptop. The VPN server encrypts it and sends it to the endpoint it knows, but the NAT has no mapping for that port and drops it. Traffic from the laptop would work, but traffic to it cannot start while the laptop is silent.',
        ja: '監視のサーバーがノート PC に ping する。VPN サーバーは暗号化して知っているエンドポイントに送るが、NAT にはそのポートの対応がなく、捨てる。ノート PC からの通信なら通るが、ノート PC が黙っているあいだは、ノート PC への通信は始められない。',
      },
      events: [
        send(plain('monitor-1', INTERNAL, SERVER, monitor)),
        ...model.down('monitor-1-tunnel', fromServer(monitor), 45),
        set(NAT, NAT_TIMER, `UDP mapping ${String(NAT_TIMEOUT)} s (example): no mapping for 40001`),
      ],
    },
    {
      id: 'persistent',
      title: { en: 't = 50 s: PersistentKeepalive = 25', ja: 't = 50 s: PersistentKeepalive = 25' },
      description: {
        en: 'The user sets PersistentKeepalive = 25 on the laptop’s peer (25 seconds is the interval WireGuard’s documentation suggests). Linux sends a keepalive at once. The NAT creates a new mapping with a new port, 40002, and the server, which authenticates the keepalive, updates the endpoint.',
        ja: 'ユーザーはノート PC のピアに PersistentKeepalive = 25 を設定する（25 秒は WireGuard の文書が勧める間隔）。Linux はすぐにキープアライブを送る。NAT は新しいポート 40002 で新しい対応を作り、キープアライブを認証したサーバーはエンドポイントを変える。',
      },
      events: (() => {
        model.keepalive = '25 s'
        return [
          model.laptopPeers(),
          ...model.up('persistent-1', fromLaptop(KEEPALIVE), 50),
          ...model.serverReceives('#1', 2),
        ]
      })(),
    },
    {
      id: 'repeat',
      title: {
        en: 't = 75 s and 100 s: keepalives hold the mapping open',
        ja: 't = 75 s と 100 s: キープアライブが対応を保つ',
      },
      description: {
        en: 'Every 25 seconds of silence, the laptop sends a keepalive. Each one refreshes the NAT mapping before it can expire.',
        ja: '25 秒黙るたびに、ノート PC はキープアライブを送る。そのたびに、NAT の対応は切れる前に延びる。',
      },
      events: [
        timer(LAPTOP, 'PersistentKeepalive', 25_000),
        ...model.up('persistent-2', fromLaptop(KEEPALIVE), 75),
        ...model.serverReceives('#1', 3),
        timer(LAPTOP, 'PersistentKeepalive', 25_000),
        ...model.up('persistent-3', fromLaptop(KEEPALIVE), 100),
        ...model.serverReceives('#1', 4),
      ],
    },
    {
      id: 'reachable',
      title: {
        en: 't = 110 s: the office reaches the laptop',
        ja: 't = 110 s: オフィスからノート PC に届く',
      },
      description: {
        en: 'The monitoring server pings again. The mapping was last used 10 seconds ago, so the NAT lets the packet in, and the laptop replies. PersistentKeepalive costs a small packet every 25 seconds; it is only needed when the peer behind the NAT must be reachable while it is idle.',
        ja: '監視のサーバーがもう一度 ping する。対応は 10 秒前に使われたばかりなので、NAT はパケットを通し、ノート PC は答える。PersistentKeepalive は 25 秒ごとに小さなパケットを使う。NAT の内側のピアに、黙っているあいだも届く必要があるときだけ要る。',
      },
      events: [
        send(plain('monitor-2', INTERNAL, SERVER, monitor)),
        ...model.down('monitor-2-tunnel', fromServer(monitor), 110),
        ...model.up('monitor-reply', fromLaptop(monitorReply), 110),
        ...model.serverReceives('#1', 5),
        send(plain('monitor-reply-plain', SERVER, INTERNAL, monitorReply)),
      ],
    },
  ]
}

function rekeySteps(): Step[] {
  const model = new WgModel()
  establish(model, 0)
  const now = REKEY_AFTER_TIME
  // 描かない通信が続いていたので、NAT の対応は生きていて、サーバーはカウンター 0〜41 を受け取っている
  model.nat = outbound(model.nat, LAPTOP_HOME, SERVER_ENDPOINT, now - 5).nat
  for (let counter = 0; counter <= 41; counter++) {
    const result = checkCounter(model.replay['#1'] ?? INITIAL_REPLAY, counter)
    if (result.accepted) {
      model.replay = { ...model.replay, '#1': result.next }
    }
  }
  const ping = echoRequest(ADDR.laptopTunnel, ADDR.internal)
  const pong = echoReply(ADDR.internal, ADDR.laptopTunnel)
  const rekeySection = { en: 'Handshake for keypair #2', ja: '鍵の組 #2 のハンドシェイク' }
  return [
    {
      id: 'setup',
      title: { en: 'Keypair #1 is two minutes old', ja: '鍵の組 #1 ができて 2 分' },
      description: {
        en: `${SETUP_TEXT.en} The laptop started keypair #1 at t = 0 s, and traffic has flowed since (not drawn). WireGuard never uses a keypair for long: after 120 seconds, the side that started it makes a new one.`,
        ja: `${SETUP_TEXT.ja}ノート PC が t = 0 s に鍵の組 #1 を始め、その後も通信が続いた（描かない）。WireGuard は 1 つの鍵の組を長く使わない。120 秒たつと、始めた側が新しい鍵の組を作る。`,
      },
      events: [
        ...baseSetup(model),
        model.natEvent(0),
        set(SERVER, REPLAY, `#1 ${describeReplay(model.replay['#1'] ?? INITIAL_REPLAY)}`),
      ],
    },
    {
      id: 'send-and-rekey',
      section: rekeySection,
      title: {
        en: 't = 120 s: sending on an old keypair starts a handshake',
        ja: 't = 120 s: 古い鍵の組で送ると、ハンドシェイクが始まる',
      },
      description: {
        en: 'The laptop sends a ping on keypair #1. As it sends, it sees that #1 is 120 seconds old and that it was the initiator, so it also sends a new Handshake Initiation, with a new ephemeral key and a new index. Nothing happens by itself at 120 seconds: the check is made when data is sent.',
        ja: 'ノート PC は鍵の組 #1 で ping を送る。送るとき、#1 ができて 120 秒たっていて、自分が始めた側だとわかるので、新しい一時的な鍵と新しいインデックスで Handshake Initiation も送る。120 秒になった瞬間に何かが起きるのではなく、データを送るときに確かめる。',
      },
      events: [
        ...model.up('ping', data('#1', INDEX.server1, 42, ping, insideText), now),
        ...model.serverReceives('#1', 42),
        send(plain('forward', SERVER, INTERNAL, ping)),
        set(LAPTOP, DECISION, 'rekey: #1 is 120 s old and I initiated it'),
        ...model.up(
          'initiation',
          initiation(INDEX.laptop2, 'E_pub(laptop #2)', 't = 120 s', '0 (no cookie)', {
            en: 'A new handshake: a new ephemeral key gives new keys (forward secrecy).',
            ja: '新しいハンドシェイク。新しい一時的な鍵から新しい鍵ができる（前方秘匿性）。',
          }),
          now,
        ),
        set(SERVER, TIMESTAMP, 'TAI64N t = 120 s'),
      ],
    },
    {
      id: 'response',
      section: rekeySection,
      title: {
        en: 'The server responds and keeps #2 as “next”',
        ja: 'サーバーが応答し、#2 を「next」に置く',
      },
      description: {
        en: 'The server derives keypair #2 and places it in “next”, keeping #1 current. It drops its “previous” keypair, as Linux does. It sends the Handshake Response.',
        ja: 'サーバーは鍵の組 #2 を導いて「next」に置き、#1 は current のまま。Linux と同じく「previous」の鍵の組は捨てる。Handshake Response を送る。',
      },
      events: (() => {
        model.serverSlots = responderAdds(model.serverSlots, '#2')
        return [
          ...model.slots(),
          ...model.down(
            'response',
            response(INDEX.server2, INDEX.laptop2, '#2', {
              en: 'The response for keypair #2.',
              ja: '鍵の組 #2 の応答。',
            }),
            now,
          ),
        ]
      })(),
    },
    {
      id: 'reply-on-1',
      section: rekeySection,
      title: { en: 'The reply still uses keypair #1', ja: '返事はまだ鍵の組 #1 を使う' },
      description: {
        en: 'The internal server’s reply arrives. The VPN server still encrypts it with #1: it may not use #2 until the laptop has used it, which proves the laptop has the same keys.',
        ja: '内部のサーバーの返事が届く。VPN サーバーはまだ #1 で暗号化する。ノート PC が #2 を使って、同じ鍵を持っていると示すまで、#2 は使えない。',
      },
      events: [
        send(plain('reply', INTERNAL, SERVER, pong)),
        ...model.down('pong', data('#1', INDEX.laptop1, 17, pong, insideText), now),
      ],
    },
    {
      id: 'switch',
      section: rekeySection,
      title: {
        en: 'The laptop switches to #2 and confirms it',
        ja: 'ノート PC が #2 に切り替えて確認させる',
      },
      description: {
        en: 'On the response, the laptop makes #2 current and keeps #1 as previous, so the reply on #1 is still accepted. It has nothing to send, so it sends a keepalive on #2, counter 0. When the server receives it, #2 is confirmed and becomes current on the server too.',
        ja: '応答を受け取ったノート PC は、#2 を current にし、#1 を previous に残す。そのため #1 の返事もまだ受け取れる。送るものがないので、#2 のカウンター 0 でキープアライブを送る。サーバーがそれを受け取ると #2 が確認でき、サーバーでも current になる。',
      },
      events: (() => {
        model.laptopSlots = initiatorAdds(model.laptopSlots, '#2')
        model.latestHandshake = `t = ${String(now)} s`
        return [
          ...model.slots(),
          model.laptopPeers(),
          set(LAPTOP, DECISION, 'accepted Echo Reply on #1 (previous)'),
          ...model.up('confirm', data('#2', INDEX.server2, 0, KEEPALIVE, insideText), now),
          ...model.serverReceives('#2', 0),
          model.serverPeers(),
        ]
      })(),
    },
    {
      id: 'on-2',
      title: { en: 'Traffic continues on #2', ja: '#2 で通信が続く' },
      description: {
        en: 'The next ping uses keypair #2 with counter 1. Keypair #1 will stop being accepted at 180 seconds, and it is discarded when the next handshake pushes it out of the previous slot. If no new handshake happens for 540 seconds, all keys are erased. A keypair is also replaced after 2^60 messages, far more than a connection sends in practice.',
        ja: '次の ping は鍵の組 #2 のカウンター 1 を使う。鍵の組 #1 は 180 秒で受け入れられなくなり、次のハンドシェイクで previous の枠から押し出されると捨てられる。新しいハンドシェイクが 540 秒のあいだなければ、すべての鍵が消される。鍵の組は 2^60 個のメッセージの後にも取り替えるが、実際の接続はそこまで送らない。',
      },
      events: [
        ...model.up('ping-2', data('#2', INDEX.server2, 1, ping, insideText), now + 5),
        ...model.serverReceives('#2', 1),
      ],
    },
  ]
}

function underLoadSteps(): Step[] {
  const model = new WgModel()
  const ping = echoRequest(ADDR.laptopTunnel, ADDR.internal)
  return [
    {
      id: 'setup',
      title: { en: 'The server is under attack', ja: 'サーバーが攻撃を受けている' },
      description: {
        en: `${SETUP_TEXT.en} An attacker floods the server with handshake initiations from spoofed addresses. Each one would cost the server Curve25519 computations, so the server is “under load”.`,
        ja: `${SETUP_TEXT.ja}攻撃者は、偽の送信元のアドレスからハンドシェイクを大量に送りつけている。1 つずつに Curve25519 の計算がかかるので、サーバーは「負荷が高い」。`,
      },
      events: [...baseSetup(model), set(SERVER, LOAD, 'under load (cookie required)')],
    },
    {
      id: 'flood',
      title: { en: 'A flood of spoofed handshakes', ja: '偽のハンドシェイクの洪水' },
      description: {
        en: 'Under load, the server does no Curve25519 work for an initiation without a valid mac2. It answers each with a Cookie Reply instead, which is smaller than the initiation, so it does not amplify the attack. The replies go to the spoofed addresses, where nobody uses them (not drawn).',
        ja: '負荷が高いあいだ、サーバーは正しい mac2 のないハンドシェイクに Curve25519 の計算をしない。代わりにそれぞれに Cookie Reply を返す。ハンドシェイクより小さいので、攻撃を増幅しない。返事は偽のアドレスに届き、誰も使わない（描かない）。',
      },
      events: [
        send(
          packet(
            'flood',
            ATTACKER,
            SERVER,
            'many (spoofed)',
            SERVER_ENDPOINT,
            initiation(
              '…',
              'E_pub(…)',
              '…',
              '0 (no cookie)',
              {
                en: 'Many initiations from spoofed sources.',
                ja: '偽の送信元からの大量のハンドシェイク。',
              },
              'Handshake Initiation ×1000 (spoofed)',
            ),
            'rejected',
          ),
        ),
        set(SERVER, DECISION, 'under load: no mac2, answer with Cookie Reply'),
      ],
    },
    {
      id: 'initiation',
      title: {
        en: 'The laptop’s handshake gets a cookie',
        ja: 'ノート PC のハンドシェイクが cookie をもらう',
      },
      description: {
        en: 'The laptop sends an initiation. Its mac1 is valid, but it has no mac2, and the server is under load, so it gets a Cookie Reply too. The cookie is a MAC of the source address and port the server saw, the NAT’s public address, under a secret that changes every 2 minutes. It is encrypted, and bound to the initiation’s mac1.',
        ja: 'ノート PC がハンドシェイクを送る。mac1 は正しいが mac2 がなく、サーバーは負荷が高いので、これにも Cookie Reply を返す。cookie は、サーバーに見えた送信元のアドレスとポート（NAT のグローバルアドレス）から、2 分ごとに変わる秘密で作った MAC。暗号化され、ハンドシェイクの mac1 に結びつけてある。',
      },
      events: [
        ...model.up(
          'initiation',
          initiation(INDEX.laptop1, 'E_pub(laptop #1)', 't = 0 s', '0 (no cookie)', {
            en: 'A normal initiation, without mac2.',
            ja: 'mac2 のない、ふつうのハンドシェイク。',
          }),
          0,
          { authenticated: false },
        ),
        set(SERVER, DECISION, 'mac1 ok, mac2 missing: Cookie Reply'),
        ...(() => {
          model.endpoint = `${ADDR.homePublic}:40001`
          const events = model.down(
            'cookie',
            cookieReply(INDEX.laptop1, {
              en: 'A 64-byte reply: smaller than the 148-byte initiation.',
              ja: '64 バイトの返事。148 バイトのハンドシェイクより小さい。',
            }),
            0,
          )
          model.endpoint = '-'
          return events
        })(),
      ],
    },
    {
      id: 'wait',
      title: {
        en: 'The laptop stores the cookie and waits',
        ja: 'ノート PC は cookie をしまって待つ',
      },
      description: {
        en: 'The laptop decrypts and stores the cookie, but does not resend at once. It waits for its usual retry after 5 seconds.',
        ja: 'ノート PC は cookie を復号してしまっておくが、すぐには送り直さない。いつもどおり 5 秒後の送り直しを待つ。',
      },
      events: [
        set(LAPTOP, DECISION, 'cookie stored; retry after REKEY_TIMEOUT'),
        timer(LAPTOP, 'REKEY_TIMEOUT', REKEY_TIMEOUT * 1000),
      ],
    },
    {
      id: 'retry',
      title: { en: 'The retry carries mac2', ja: '送り直しには mac2 が付く' },
      description: {
        en: 'The retry is a new initiation, with a new ephemeral key and a new index, and this time with mac2 computed from the cookie. It proves the laptop really receives packets at its source address, which a spoofing attacker cannot do.',
        ja: '送り直しは、新しい一時的な鍵と新しいインデックスの新しいハンドシェイクで、今度は cookie から計算した mac2 が付く。ノート PC が送信元のアドレスで本当にパケットを受け取れることを示す。送信元を偽る攻撃者にはできない。',
      },
      events: [
        ...model.up(
          'retry',
          initiation(
            INDEX.laptopRetry,
            'E_pub(laptop, retry)',
            't = 5 s',
            'MAC(cookie, …)',
            {
              en: 'A new initiation with mac2.',
              ja: 'mac2 の付いた新しいハンドシェイク。',
            },
            'Handshake Initiation (mac2)',
          ),
          REKEY_TIMEOUT,
        ),
        set(SERVER, TIMESTAMP, 'TAI64N t = 5 s'),
        set(SERVER, DECISION, 'mac2 ok: process the initiation'),
      ],
    },
    {
      id: 'response',
      title: { en: 'The handshake completes', ja: 'ハンドシェイクが終わる' },
      description: {
        en: 'Now the server does the work and responds. The laptop sends its ping on the new keypair. Under load, the server spends Curve25519 computations only on peers that can prove their address.',
        ja: 'サーバーはここで計算をして応答する。ノート PC は新しい鍵の組で ping を送る。負荷が高いあいだ、サーバーは、アドレスを示せる相手にだけ Curve25519 の計算を使う。',
      },
      events: (() => {
        model.serverSlots = responderAdds(model.serverSlots, '#1')
        const events: StepEvent[] = [
          ...model.slots(),
          ...model.down(
            'response',
            response(INDEX.server1, INDEX.laptopRetry, '#1', {
              en: 'The response to the initiation with mac2.',
              ja: 'mac2 の付いたハンドシェイクへの応答。',
            }),
            REKEY_TIMEOUT,
          ),
        ]
        model.laptopSlots = initiatorAdds(model.laptopSlots, '#1')
        model.latestHandshake = `t = ${String(REKEY_TIMEOUT)} s`
        return [
          ...events,
          ...model.slots(),
          ...model.up('ping', data('#1', INDEX.server1, 0, ping, insideText), REKEY_TIMEOUT),
          ...model.serverReceives('#1', 0),
          model.serverPeers(),
          model.laptopPeers(),
        ]
      })(),
    },
  ]
}

function buildSteps(options: WireguardOptions): readonly Step[] {
  const builders: Record<Situation, () => Step[]> = {
    handshake: handshakeSteps,
    rejected: rejectedSteps,
    roaming: roamingSteps,
    keepalive: keepaliveSteps,
    rekey: rekeySteps,
    underLoad: underLoadSteps,
  }
  return builders[options.situation]()
}

export const wireguardScenario: Scenario<WireguardOptions> = {
  id: 'wireguard',
  title: {
    en: 'WireGuard: a remote-access VPN built on public keys',
    ja: 'WireGuard: 公開鍵で結ぶリモートアクセス VPN',
  },
  actors,
  optionDefs: {
    situation: {
      kind: 'select',
      label: { en: 'Situation', ja: '状況' },
      choices: [
        {
          value: 'handshake',
          label: { en: 'First handshake and data', ja: '最初のハンドシェイクとデータ' },
        },
        {
          value: 'rejected',
          label: {
            en: 'Replayed, forged and disallowed packets',
            ja: '送り直し、偽物、許されないパケット',
          },
        },
        {
          value: 'roaming',
          label: { en: 'The laptop moves to a café', ja: 'ノート PC がカフェに移る' },
        },
        {
          value: 'keepalive',
          label: {
            en: 'NAT timeout and PersistentKeepalive',
            ja: 'NAT の寿命と PersistentKeepalive',
          },
        },
        { value: 'rekey', label: { en: 'New keys after 120 seconds', ja: '120 秒で鍵を更新する' } },
        {
          value: 'underLoad',
          label: {
            en: 'A busy server answers with a cookie',
            ja: '負荷の高いサーバーが cookie で答える',
          },
        },
      ],
      defaultValue: 'handshake',
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
