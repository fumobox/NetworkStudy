/**
 * NAT 越え: STUN・TURN・ICE
 *
 * 根拠:
 * - RFC 8489（STUN。RFC 5389 を置き換えた）Abstract・§1（STUN だけでは NAT 越えの解決にならない）、§5（20 バイトのヘッダー、型のビット、
 *   マジッククッキー 0x2112A442、96 ビットのトランザクション ID、Message Length はヘッダーを含まない 4 の倍数）、§6.2.1（UDP の再送）、
 *   §9.1（短期の資格情報）、§9.2（長期の資格情報: 401 と REALM・NONCE の後に、新しいトランザクション ID で資格情報を付けて送り直す）、
 *   §14（属性は 4 バイトの境界に詰める）、§14.2（XOR-MAPPED-ADDRESS。アドレスを書き換える ALG のため）、§14.7（FINGERPRINT）、
 *   §18.4（401 は Unauthenticated）、§18.5.1（MD5 は古い実装との互換のためだけ。SHA-256 を使う）
 * - RFC 8656（TURN。RFC 5766 を置き換えた）§1（中継はサーバーの帯域を使うので、ほかの手段がないときだけ）、§2（TURN のサーバーは STUN の
 *   サーバーでもある）、§3.1（クライアントとサーバーの間が TCP・TLS でも、サーバーと相手の間は UDP）、§3.3、§9（許可はアドレスだけを比べる。
 *   寿命は 300 秒。CreatePermission と ChannelBind だけが作り、更新する）、§3.5、§12（チャネル 0x4000〜0x4FFF。ChannelData のヘッダーは
 *   4 バイト、Send・Data の通知は 36 バイト。チャネルの寿命は 600 秒）、§6（割り当ては 5-tuple で見分ける。寿命の既定は 600 秒）、
 *   §7.2（Allocate の応答: XOR-RELAYED-ADDRESS、XOR-MAPPED-ADDRESS、LIFETIME）、§8（Refresh。LIFETIME 0 で消す）、§10.1（CreatePermission。
 *   ポートは見ない）、§11（Send と Data の通知には MESSAGE-INTEGRITY がない）、§12.5（TCP・TLS の上では ChannelData を 4 の倍数に詰める）、
 *   §20（例の値: レルム example.com、NONCE）
 * - RFC 8445（ICE。RFC 5245 を置き換えた）§2（シグナリングは ICE の外）、§4（server reflexive、peer reflexive、基底）、§5.1.2.1（候補の優先度）、
 *   §6.1.1（オファーを出す側が controlling）、§6.1.2.3（候補ペアの優先度）、§6.1.2.4（基底の同じ候補を除く）、§7.1.1（PRIORITY は peer reflexive の
 *   優先度で計算する）、§7.1.2（USE-CANDIDATE は controlling だけ）、§7.2.2（USERNAME は相手の ufrag:自分の ufrag）、§7.2.4（チェックには
 *   FINGERPRINT が必須）、§7.2.5.3（有効なペアはマップされたアドレスから作る。知らないアドレスなら peer reflexive）、§7.3.1.3、§7.3.1.4
 *   （知らない送信元は peer reflexive の相手の候補。トリガーされたチェック）、§8.1.1、§8.1.2（指名。ほかのペアを除く）、§8.3.1（使わない候補は
 *   3 秒後に放す）、§11（キープアライブ 15 秒）
 * - RFC 4787 §4.1（対応づけ: エンドポイントに依存しない EIM、アドレスとポートに依存する APDM。セキュリティはフィルタリングから）、
 *   §5（フィルタリング。REQ-8 の理由: 両側が APDF でないと、ICE は peer reflexive で直接の経路を見つける）
 * - RFC 8839 §4.2.3、§5.1（SDP の a=candidate、ice-ufrag、ice-pwd）、RFC 5769（テストベクター）
 * - 触れるだけ: RFC 8838（Trickle ICE）、RFC 7675（consent freshness: 4〜6 秒ごと、30 秒で期限切れ）
 *
 * 学習用の単純化: IPv4 だけ。ICE は UDP だけ（ICE-TCP は扱わない）。ストリームとコンポーネントは 1 つずつ。両側とも full ICE で、候補を集めてから
 * 送る（Trickle ICE は使わない）。シグナリングのサーバーは描かない。PC B は TURN を使わない。ホスト候補どうしのチェックは描かない
 * （プライベートアドレスはインターネットで経路が広告されない）。トランザクション ID、ufrag、パスワード、タイブレーカー、ポートは例の値
 * （本当は乱数。RFC 6056）。SOFTWARE の属性は省き、MESSAGE-INTEGRITY と FINGERPRINT は大きさだけを見せる。PC A は Binding と Allocate を
 * 同じホストのポートから送る。NAT の対応の寿命は描かない。TCP・TLS・DTLS のハンドシェイクは描かない（それぞれのテーマを参照）。
 * 最初の有効なペアで指名する。4 分後に許可と割り当てをまとめて更新する。NAT A は、どの場合もフィルタリングが APDF
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
import { priorityOf, sdpCandidate } from './ice'
import {
  CREDENTIALS,
  hop,
  INTEGRITY_SHA256,
  Nat,
  stunFields,
  xorAttribute,
  type Attribute,
  type Proto,
} from './model'
import { channelDataHeader, hex, messageType, paddedSize } from './stun'

const optionsSchema = z.object({
  network: z.enum(['independent', 'symmetric', 'udpBlocked']).catch('independent'),
  permissionExpires: z.stringbool().catch(false),
})
export type NatTraversalOptions = z.infer<typeof optionsSchema>
type Network = NatTraversalOptions['network']

const PC_A: ActorId = 'pcA'
const NAT_A: ActorId = 'natA'
const SERVER: ActorId = 'server'
const NAT_B: ActorId = 'natB'
const PC_B: ActorId = 'pcB'

const LOCAL: StateKey = 'local'
const REMOTE: StateKey = 'remote'
const CHECKLIST: StateKey = 'checklist'
const ICE_STATE: StateKey = 'ice'
const SELECTED: StateKey = 'selected'
const BEHAVIOUR: StateKey = 'behaviour'
const NAT_TABLE: StateKey = 'nat'
const ALLOCATION: StateKey = 'allocation'
const PERMISSIONS: StateKey = 'permissions'
const CHANNELS: StateKey = 'channels'

export const CANDIDATE_COLUMNS = ['Type', 'Address', 'Priority'] as const
export const CHECKLIST_COLUMNS = ['Local', 'Remote', 'State'] as const
export const ALLOCATION_COLUMNS = ['Field', 'Value'] as const
export const PERMISSION_COLUMNS = ['Peer IP', 'Expires in'] as const
export const CHANNEL_COLUMNS = ['Channel', 'Peer', 'Expires in'] as const
const NAT_COLUMNS = ['Proto', 'Internal', 'External', 'Remote'] as const

export const ADDRESSES = {
  aHost: '192.168.1.10:49152',
  aTlsHost: '192.168.1.10:49153',
  natA: '203.0.113.5',
  server: '198.51.100.3:3478',
  serverTls: '198.51.100.3:443',
  relay: '198.51.100.3:55000',
  natB: '192.0.2.77',
  bHost: '10.0.0.20:50000',
} as const
const A_SRFLX = '203.0.113.5:40001'
const B_SRFLX = '192.0.2.77:60001'
const RELAY_IP = '198.51.100.3'
const RELAY_PORT = 55000
export const CHANNEL = 0x4000
export const RELEASE_MS = 3000
export const REFRESH_MS = 240_000
export const PERMISSION_LEFT_MS = 60_000

/** トランザクション ID（例の値。RFC 8656 §20 と同じものもある） */
const TX = {
  aBinding: '5a3c91e07d42b816c90f2ea7',
  bBinding: '7f1c0b9a2d4e6f8a1b3c5d7e',
  allocate: 'a56250d3f17abe679422de85',
  allocateAuth: 'c271e932ad7446a32c234492',
  permission: 'e5913a8f460956ca277d3319',
  aCheck: 'b8c3e5f1a2d4967c0e8b1f3a',
  bCheck: '4d7a2c9e8f1b3a5c6e0d2b94',
  aTriggered: 'e2a9c4b7d1f3856a0c9e2d71',
  nominate: 'f5b1d8c3a7e2496b0d3c8e15',
  channelBind: '3d8a61f0c2b94e57a1d6f028',
  channelBind2: '9b24e0c7d51f3a86e2c47b19',
  refresh: '0864b3c27ade9354b4312414',
  release: '6c1e94a2b7d03f58c9a2e417',
  indication1: '1a2b3c4d5e6f708192a3b4c5',
  indication2: '2b3c4d5e6f708192a3b4c5d6',
  indication3: '3c4d5e6f708192a3b4c5d6e7',
  indication4: '4d5e6f708192a3b4c5d6e7f8',
  indication5: '5e6f708192a3b4c5d6e7f809',
  indication6: '6f708192a3b4c5d6e7f8091a',
} as const

const actors: readonly Actor[] = [
  {
    id: PC_A,
    kind: 'client',
    name: { en: 'PC A (192.168.1.10)', ja: 'PC A（192.168.1.10）' },
    shortName: { en: 'PC A', ja: 'PC A' },
    stateSlots: [
      {
        key: LOCAL,
        label: { en: 'Local candidates', ja: '自分の候補' },
        initial: { columns: CANDIDATE_COLUMNS, rows: [] },
      },
      {
        key: REMOTE,
        label: { en: 'Remote candidates (from SDP)', ja: '相手の候補（SDP から）' },
        initial: { columns: CANDIDATE_COLUMNS, rows: [] },
      },
      {
        key: CHECKLIST,
        label: { en: 'Checklist', ja: 'チェックリスト' },
        initial: { columns: CHECKLIST_COLUMNS, rows: [] },
      },
      { key: ICE_STATE, label: { en: 'ICE', ja: 'ICE' }, initial: '-' },
      { key: SELECTED, label: { en: 'Selected pair', ja: '選ばれたペア' }, initial: '-' },
    ],
  },
  {
    id: NAT_A,
    kind: 'router',
    name: { en: 'NAT A (192.168.1.1 / 203.0.113.5)', ja: 'NAT A（192.168.1.1 / 203.0.113.5）' },
    shortName: { en: 'NAT A', ja: 'NAT A' },
    stateSlots: [
      {
        key: BEHAVIOUR,
        label: { en: 'Behaviour (RFC 4787)', ja: '振る舞い（RFC 4787）' },
        initial: '-',
      },
      {
        key: NAT_TABLE,
        label: { en: 'NAT table', ja: 'NAT の変換表' },
        initial: { columns: NAT_COLUMNS, rows: [] },
      },
    ],
  },
  {
    id: SERVER,
    kind: 'server',
    name: { en: 'STUN/TURN server (198.51.100.3)', ja: 'STUN・TURN サーバー（198.51.100.3）' },
    shortName: { en: 'Server', ja: 'サーバー' },
    stateSlots: [
      {
        key: ALLOCATION,
        label: { en: 'TURN allocation', ja: 'TURN の割り当て' },
        initial: { columns: ALLOCATION_COLUMNS, rows: [] },
      },
      {
        key: PERMISSIONS,
        label: { en: 'Permissions', ja: '許可' },
        initial: { columns: PERMISSION_COLUMNS, rows: [] },
      },
      {
        key: CHANNELS,
        label: { en: 'Channels', ja: 'チャネル' },
        initial: { columns: CHANNEL_COLUMNS, rows: [] },
      },
    ],
  },
  {
    id: NAT_B,
    kind: 'router',
    name: { en: 'NAT B (10.0.0.1 / 192.0.2.77)', ja: 'NAT B（10.0.0.1 / 192.0.2.77）' },
    shortName: { en: 'NAT B', ja: 'NAT B' },
    stateSlots: [
      {
        key: BEHAVIOUR,
        label: { en: 'Behaviour (RFC 4787)', ja: '振る舞い（RFC 4787）' },
        initial: '-',
      },
      {
        key: NAT_TABLE,
        label: { en: 'NAT table', ja: 'NAT の変換表' },
        initial: { columns: NAT_COLUMNS, rows: [] },
      },
    ],
  },
  {
    id: PC_B,
    kind: 'client',
    name: { en: 'PC B (10.0.0.20)', ja: 'PC B（10.0.0.20）' },
    shortName: { en: 'PC B', ja: 'PC B' },
    stateSlots: [
      {
        key: LOCAL,
        label: { en: 'Local candidates', ja: '自分の候補' },
        initial: { columns: CANDIDATE_COLUMNS, rows: [] },
      },
      {
        key: REMOTE,
        label: { en: 'Remote candidates (from SDP)', ja: '相手の候補（SDP から）' },
        initial: { columns: CANDIDATE_COLUMNS, rows: [] },
      },
      {
        key: CHECKLIST,
        label: { en: 'Checklist', ja: 'チェックリスト' },
        initial: { columns: CHECKLIST_COLUMNS, rows: [] },
      },
      { key: ICE_STATE, label: { en: 'ICE', ja: 'ICE' }, initial: '-' },
      { key: SELECTED, label: { en: 'Selected pair', ja: '選ばれたペア' }, initial: '-' },
    ],
  },
]

type CandidateType = 'host' | 'srflx' | 'prflx' | 'relay'
type Candidate = readonly [CandidateType, string]
const candidates = (...rows: Candidate[]): StateTable => ({
  columns: CANDIDATE_COLUMNS,
  rows: rows.map(([type, address]) => [type, address, String(priorityOf(type))]),
})
type PairState = 'Waiting' | 'In-Progress' | 'Succeeded' | 'Failed' | 'Succeeded, nominated'
type Pair = readonly [string, string, PairState]
const checklist = (...rows: Pair[]): StateTable => ({ columns: CHECKLIST_COLUMNS, rows })

const GATHER: LocalizedText = { en: 'Gathering candidates', ja: '候補を集める' }
const SIGNAL: LocalizedText = {
  en: 'Signalling (offer/answer)',
  ja: 'シグナリング（オファー／アンサー）',
}
const CHECKS: LocalizedText = { en: 'Connectivity checks', ja: '接続性チェック' }
const MEDIA: LocalizedText = { en: 'Media', ja: 'メディア' }
const KEEP: LocalizedText = { en: 'Keeping the relay', ja: '中継を保つ' }

interface StepText {
  readonly id: string
  readonly section: LocalizedText
  readonly title: LocalizedText
  readonly description: LocalizedText
}

/** ICE のチェック（Binding の要求）の属性（RFC 8445 §7.1.1、§7.2.2、§7.2.4） */
function checkAttributes(from: 'A' | 'B', useCandidate = false): Attribute[] {
  const attributes: Attribute[] = [
    {
      name: 'USERNAME',
      value: from === 'A' ? 'bxkW:EsAw' : 'EsAw:bxkW',
      length: 9,
      description: {
        en: 'The remote agent’s ufrag, a colon, then the sender’s own ufrag (short-term credential)',
        ja: '相手の ufrag、コロン、自分の ufrag（短期の資格情報）',
      },
    },
    {
      name: 'PRIORITY',
      value: String(priorityOf('prflx')),
      length: 4,
      description: {
        en: 'Computed with the peer-reflexive type preference (110), in case this check reveals a new address',
        ja: 'peer reflexive の種類の優先度（110）で計算する。このチェックで新しいアドレスがわかったときのため',
      },
    },
    from === 'A'
      ? { name: 'ICE-CONTROLLING', value: '0x4a7c19e2d3b58f60', length: 8 }
      : { name: 'ICE-CONTROLLED', value: '0x932ff9b151263b36', length: 8 },
  ]
  if (useCandidate) {
    attributes.push({
      name: 'USE-CANDIDATE',
      value: '(no value)',
      length: 0,
      highlight: true,
      description: {
        en: 'Nomination: only the controlling agent sends it',
        ja: '指名。controlling の側だけが送る',
      },
    })
  }
  attributes.push(
    {
      name: 'MESSAGE-INTEGRITY',
      value: '(20 bytes, HMAC-SHA1)',
      length: 20,
      description: {
        en: 'Keyed with the remote agent’s ice-pwd from the SDP',
        ja: 'SDP で受け取った相手の ice-pwd を鍵にする',
      },
    },
    {
      name: 'FINGERPRINT',
      value: '(CRC-32 XOR 0x5354554e)',
      length: 4,
      description: {
        en: 'Helps tell STUN apart from media on the same port. Mandatory in ICE checks',
        ja: '同じポートのメディアと STUN を見分けるため。ICE のチェックでは必須',
      },
    },
  )
  return attributes
}

function checkResponseAttributes(mappedIp: string, mappedPort: number): Attribute[] {
  return [
    xorAttribute('XOR-MAPPED-ADDRESS', mappedIp, mappedPort, {
      en: 'The source address this check arrived from, as the receiver saw it',
      ja: 'このチェックが届いた送信元のアドレス（受け取った側から見たもの）',
    }),
    { name: 'MESSAGE-INTEGRITY', value: '(20 bytes, HMAC-SHA1)', length: 20 },
    { name: 'FINGERPRINT', value: '(CRC-32 XOR 0x5354554e)', length: 4 },
  ]
}

const checkBytes = (useCandidate = false) => 20 + (useCandidate ? 72 : 68)
const RESPONSE_BYTES = 20 + 44

function splitEndpoint(value: string): [string, number] {
  const index = value.lastIndexOf(':')
  return [value.slice(0, index), Number(value.slice(index + 1))]
}

/** 1 つのシナリオの流れを組み立てる */
class Flow {
  readonly steps: Step[] = []
  readonly natA: Nat
  readonly natB: Nat
  private events: StepEvent[] = []
  private last = { natA: '[]', natB: '[]' }
  private counter = 0
  readonly tls: boolean

  readonly network: Network

  constructor(network: Network) {
    this.network = network
    this.natA = new Nat(ADDRESSES.natA, 'EIM', 40001)
    this.natB = new Nat(ADDRESSES.natB, network === 'symmetric' ? 'APDM' : 'EIM', 60001)
    this.tls = network === 'udpBlocked'
  }

  step(text: StepText, body: () => void) {
    this.events = []
    body()
    for (const [key, nat, actor] of [
      ['natA', this.natA, NAT_A],
      ['natB', this.natB, NAT_B],
    ] as const) {
      const json = JSON.stringify(nat.rows)
      if (json !== this.last[key]) {
        this.events.push(this.set(actor, NAT_TABLE, nat.table()))
        this.last[key] = json
      }
    }
    this.steps.push({ ...text, events: this.events })
  }

  set(actorId: ActorId, key: StateKey, value: string | StateTable): StepEvent {
    return { kind: 'stateChange', actorId, key, value }
  }

  emit(...events: StepEvent[]) {
    this.events.push(...events)
  }

  timer(actorId: ActorId, name: string, durationMs: number) {
    this.events.push({ kind: 'timer', actorId, name, durationMs })
  }

  private send(message: Message) {
    this.events.push({ kind: 'message', message })
  }

  private id(base: string) {
    this.counter += 1
    return `${base}-${String(this.counter)}`
  }

  /** PC A からサーバーへ（UDP なら 3478、TLS なら 443） */
  aToServer(base: string, label: string, fields: readonly PacketField[], forceUdp = false) {
    const tls = this.tls && !forceUdp
    const proto: Proto = tls ? 'TCP' : 'UDP'
    const internal = tls ? ADDRESSES.aTlsHost : ADDRESSES.aHost
    const server = tls ? ADDRESSES.serverTls : ADDRESSES.server
    const transport = tls ? 'TLS over TCP' : 'UDP'
    if (this.network === 'udpBlocked' && !tls) {
      // UDP は NAT A の網で止められる
      this.send(
        hop({
          id: this.id(base),
          from: PC_A,
          to: NAT_A,
          label,
          src: internal,
          dst: server,
          transport,
          fields,
          status: 'rejected',
        }),
      )
      return
    }
    const external = this.natA.out(proto, internal, server)
    this.send(
      hop({
        id: this.id(base),
        from: PC_A,
        to: NAT_A,
        label,
        src: internal,
        dst: server,
        transport,
        fields,
        encrypted: tls,
      }),
    )
    this.send(
      hop({
        id: this.id(base),
        from: NAT_A,
        to: SERVER,
        label,
        src: external,
        dst: server,
        transport,
        fields,
        translation: `src ${internal} → ${external}`,
        encrypted: tls,
      }),
    )
  }

  /** サーバーから PC A へ */
  serverToA(base: string, label: string, fields: readonly PacketField[]) {
    const proto: Proto = this.tls ? 'TCP' : 'UDP'
    const internal = this.tls ? ADDRESSES.aTlsHost : ADDRESSES.aHost
    const server = this.tls ? ADDRESSES.serverTls : ADDRESSES.server
    const transport = this.tls ? 'TLS over TCP' : 'UDP'
    const external =
      this.natA.rows.find(([p, i, , r]) => p === proto && i === internal && r === server)?.[2] ??
      A_SRFLX
    const allowed = this.natA.allows(proto, external, server)
    this.send(
      hop({
        id: this.id(base),
        from: SERVER,
        to: NAT_A,
        label,
        src: server,
        dst: external,
        transport,
        fields,
        status: allowed ? 'delivered' : 'rejected',
        encrypted: this.tls,
      }),
    )
    if (!allowed) return
    this.send(
      hop({
        id: this.id(base),
        from: NAT_A,
        to: PC_A,
        label,
        src: server,
        dst: internal,
        transport,
        fields,
        translation: `dst ${external} → ${internal}`,
        encrypted: this.tls,
      }),
    )
  }

  /** PC B からサーバーの宛先（3478 か、中継のアドレス）へ。返り値はサーバーに届いたときの送信元 */
  bToServer(
    base: string,
    label: string,
    fields: readonly PacketField[],
    dst: string,
    status: Message['status'] = 'delivered',
  ) {
    const external = this.natB.out('UDP', ADDRESSES.bHost, dst)
    this.send(
      hop({
        id: this.id(base),
        from: PC_B,
        to: NAT_B,
        label,
        src: ADDRESSES.bHost,
        dst,
        transport: 'UDP',
        fields,
      }),
    )
    this.send(
      hop({
        id: this.id(base),
        from: NAT_B,
        to: SERVER,
        label,
        src: external,
        dst,
        transport: 'UDP',
        fields,
        translation: `src ${ADDRESSES.bHost} → ${external}`,
        status,
      }),
    )
    return external
  }

  /** サーバー（3478 か、中継のアドレス）から PC B の外側のアドレスへ */
  serverToB(base: string, label: string, fields: readonly PacketField[], src: string, dst: string) {
    const allowed = this.natB.allows('UDP', dst, src)
    this.send(
      hop({
        id: this.id(base),
        from: SERVER,
        to: NAT_B,
        label,
        src,
        dst,
        transport: 'UDP',
        fields,
        status: allowed ? 'delivered' : 'rejected',
      }),
    )
    if (!allowed) return false
    this.send(
      hop({
        id: this.id(base),
        from: NAT_B,
        to: PC_B,
        label,
        src,
        dst: ADDRESSES.bHost,
        transport: 'UDP',
        fields,
        translation: `dst ${dst} → ${ADDRESSES.bHost}`,
      }),
    )
    return true
  }

  /** PC A から PC B の外側のアドレスへ、直接 */
  aToB(base: string, label: string, fields: readonly PacketField[], dst: string): boolean {
    if (this.network === 'udpBlocked') {
      this.send(
        hop({
          id: this.id(base),
          from: PC_A,
          to: NAT_A,
          label,
          src: ADDRESSES.aHost,
          dst,
          transport: 'UDP',
          fields,
          status: 'rejected',
        }),
      )
      return false
    }
    const external = this.natA.out('UDP', ADDRESSES.aHost, dst)
    this.send(
      hop({
        id: this.id(base),
        from: PC_A,
        to: NAT_A,
        label,
        src: ADDRESSES.aHost,
        dst,
        transport: 'UDP',
        fields,
      }),
    )
    const allowed = this.natB.allows('UDP', dst, external)
    this.send(
      hop({
        id: this.id(base),
        from: NAT_A,
        to: NAT_B,
        label,
        src: external,
        dst,
        transport: 'UDP',
        fields,
        translation: `src ${ADDRESSES.aHost} → ${external}`,
        status: allowed ? 'delivered' : 'rejected',
      }),
    )
    if (!allowed) return false
    const internal = this.natB.internalOf('UDP', dst) ?? ADDRESSES.bHost
    this.send(
      hop({
        id: this.id(base),
        from: NAT_B,
        to: PC_B,
        label,
        src: external,
        dst: internal,
        transport: 'UDP',
        fields,
        translation: `dst ${dst} → ${internal}`,
      }),
    )
    return true
  }

  /** PC B から PC A の外側のアドレスへ、直接。返り値は NAT B の外側のアドレス */
  bToA(base: string, label: string, fields: readonly PacketField[], dst: string): string {
    const external = this.natB.out('UDP', ADDRESSES.bHost, dst)
    this.send(
      hop({
        id: this.id(base),
        from: PC_B,
        to: NAT_B,
        label,
        src: ADDRESSES.bHost,
        dst,
        transport: 'UDP',
        fields,
      }),
    )
    const allowed = this.natA.allows('UDP', dst, external)
    this.send(
      hop({
        id: this.id(base),
        from: NAT_B,
        to: NAT_A,
        label,
        src: external,
        dst,
        transport: 'UDP',
        fields,
        translation: `src ${ADDRESSES.bHost} → ${external}`,
        status: allowed ? 'delivered' : 'rejected',
      }),
    )
    if (allowed) {
      this.send(
        hop({
          id: this.id(base),
          from: NAT_A,
          to: PC_A,
          label,
          src: external,
          dst: ADDRESSES.aHost,
          transport: 'UDP',
          fields,
          translation: `dst ${dst} → ${ADDRESSES.aHost}`,
        }),
      )
    }
    return external
  }
}

/** Send・Data の通知のフィールド（RFC 8656 §11）。相手のアドレスと、中に運ぶデータ */
function indicationFields(
  kind: 'send' | 'data',
  txId: string,
  peer: string,
  dataBytes: number,
  dataName: string,
) {
  const [ip, port] = splitEndpoint(peer)
  return stunFields({
    type: messageType(kind === 'send' ? 0x006 : 0x007, 'indication'),
    typeName: kind === 'send' ? 'Send indication' : 'Data indication',
    transactionId: txId,
    attributes: [
      xorAttribute('XOR-PEER-ADDRESS', ip, port, {
        en: kind === 'send' ? 'Where the server should send the data' : 'Where the data came from',
        ja: kind === 'send' ? 'サーバーにデータを送ってほしい相手' : 'データを送ってきた相手',
      }),
      {
        name: 'DATA',
        value: `${dataName} (${String(dataBytes)} bytes)`,
        length: dataBytes,
        description: {
          en: 'The packet to relay, carried inside the indication. Indications have no MESSAGE-INTEGRITY',
          ja: '中継するパケットを通知の中に入れて運ぶ。通知には MESSAGE-INTEGRITY がない',
        },
      },
    ],
  })
}

const innerFields = (description: string): PacketField[] => [
  { name: 'Payload', value: description, highlight: true },
]

function allocationTable(tls: boolean, lifetime: string): StateTable {
  return {
    columns: ALLOCATION_COLUMNS,
    rows: [
      [
        '5-tuple',
        tls
          ? `TLS/TCP ${A_SRFLX} ↔ ${ADDRESSES.serverTls}`
          : `UDP ${A_SRFLX} ↔ ${ADDRESSES.server}`,
      ],
      ['Relayed', ADDRESSES.relay],
      ['Lifetime', lifetime],
      ['Username', 'alice'],
    ],
  }
}

const permissions = (...rows: (readonly [string, string])[]): StateTable => ({
  columns: PERMISSION_COLUMNS,
  rows,
})
const channels = (...rows: (readonly [string, string, string])[]): StateTable => ({
  columns: CHANNEL_COLUMNS,
  rows,
})
const EMPTY_ALLOCATION: StateTable = { columns: ALLOCATION_COLUMNS, rows: [] }

// ---- 流れ ----

function gather(flow: Flow) {
  const { network } = flow
  flow.step(
    {
      id: 'start',
      section: GATHER,
      title: { en: 'Two PCs behind two NATs', ja: '2 つの NAT の内側の 2 台の PC' },
      description:
        network === 'udpBlocked'
          ? {
              en: 'PC A wants to start a video call with PC B. Each knows only its own private address (its host candidate), and private addresses are not reachable from the Internet. PC A’s network is stricter than usual: its firewall lets only TCP ports 80 and 443 out, so no UDP gets through.',
              ja: 'PC A が PC B とビデオ通話を始めたい。どちらも自分のプライベートアドレス（ホスト候補）しか知らず、プライベートアドレスにはインターネットから届かない。PC A の網はふだんより厳しく、ファイアウォールが TCP の 80 番と 443 番しか外に出さないので、UDP は通らない。',
            }
          : network === 'symmetric'
            ? {
                en: 'PC A wants to start a video call with PC B. Each knows only its own private address (its host candidate), which the Internet cannot reach. NAT A keeps one external port per internal port (endpoint-independent mapping), but NAT B picks a new external port for every destination (address- and port-dependent mapping, often called a “symmetric” NAT). Both only let in packets from addresses they have sent to.',
                ja: 'PC A が PC B とビデオ通話を始めたい。どちらも自分のプライベートアドレス（ホスト候補）しか知らず、インターネットからは届かない。NAT A は内側のポートごとに外側のポートを 1 つ使う（宛先によらない対応づけ）が、NAT B は宛先ごとに新しい外側のポートを選ぶ（宛先のアドレスとポートごとの対応づけ。いわゆるシンメトリック NAT）。どちらも、送ったことのある相手からのパケットしか通さない。',
              }
            : {
                en: 'PC A wants to start a video call with PC B. Each knows only its own private address (its host candidate), which the Internet cannot reach. Both NATs keep one external port per internal port, whatever the destination (endpoint-independent mapping), but only let in packets from addresses they have already sent to (address- and port-dependent filtering).',
                ja: 'PC A が PC B とビデオ通話を始めたい。どちらも自分のプライベートアドレス（ホスト候補）しか知らず、インターネットからは届かない。どちらの NAT も、宛先によらず内側のポートごとに外側のポートを 1 つ使う（宛先によらない対応づけ）が、すでに送ったことのある相手からのパケットしか通さない（宛先のアドレスとポートごとのフィルタリング）。',
              },
    },
    () => {
      flow.emit(
        flow.set(PC_A, LOCAL, candidates(['host', ADDRESSES.aHost])),
        flow.set(PC_B, LOCAL, candidates(['host', ADDRESSES.bHost])),
        flow.set(
          NAT_A,
          BEHAVIOUR,
          network === 'udpBlocked' ? 'UDP blocked (TCP 80/443 only)' : 'EIM, APDF',
        ),
        flow.set(NAT_B, BEHAVIOUR, network === 'symmetric' ? 'APDM, APDF' : 'EIM, APDF'),
      )
    },
  )

  const bindingRequest = (tx: string) =>
    stunFields({
      type: messageType(0x001, 'request'),
      typeName: 'Binding Request',
      transactionId: tx,
      attributes: [],
    })

  if (network === 'udpBlocked') {
    flow.step(
      {
        id: 'a-binding-blocked',
        section: GATHER,
        title: { en: 'UDP is blocked', ja: 'UDP が止められる' },
        description: {
          en: 'PC A sends a STUN Binding Request over UDP, and its network drops it. The Allocate over UDP to port 3478 is dropped too (not drawn). Over UDP a STUN client retransmits with a doubling timeout, and gives up after 39.5 seconds; PC A tries its other configured servers in parallel.',
          ja: 'PC A は UDP で STUN の Binding Request を送るが、網が捨てる。UDP の 3478 番への Allocate も捨てられる（描いていない）。UDP の STUN のクライアントは待ち時間を倍にしながら再送し、39.5 秒であきらめる。PC A は、設定されたほかのサーバーを同時に試す。',
        },
      },
      () => {
        flow.aToServer('a-binding', 'Binding Request', bindingRequest(TX.aBinding), true)
      },
    )
    flow.step(
      {
        id: 'a-tls',
        section: GATHER,
        title: { en: 'TURN over TLS on port 443', ja: 'TLS の上の TURN（443 番）' },
        description: {
          en: 'PC A falls back to its turns: server on TCP port 443, which the firewall allows. The TCP and TLS handshakes are not drawn (see those themes). From now on everything between PC A and the server is encrypted.',
          ja: 'PC A は、ファイアウォールが通す TCP の 443 番の turns: のサーバーに切り替える。TCP と TLS のハンドシェイクは描かない（それぞれのテーマを参照）。これからは、PC A とサーバーの間はすべて暗号化される。',
        },
      },
      () => {
        flow.natA.out('TCP', ADDRESSES.aTlsHost, ADDRESSES.serverTls)
      },
    )
  } else {
    flow.step(
      {
        id: 'a-binding',
        section: GATHER,
        title: { en: 'STUN: “what address do you see?”', ja: 'STUN:「どのアドレスに見える？」' },
        description: {
          en: 'PC A sends a STUN Binding Request to the server on UDP port 3478. It has no attributes: just the 20-byte header with the magic cookie and a random transaction ID. NAT A creates a mapping for it, like any outgoing packet.',
          ja: 'PC A は、サーバーの UDP の 3478 番に STUN の Binding Request を送る。属性はなく、マジッククッキーと乱数のトランザクション ID を入れた 20 バイトのヘッダーだけ。NAT A は、外へ出るほかのパケットと同じように対応を作る。',
        },
      },
      () => {
        flow.aToServer('a-binding', 'Binding Request', bindingRequest(TX.aBinding))
      },
    )
    flow.step(
      {
        id: 'a-binding-response',
        section: GATHER,
        title: {
          en: 'PC A learns its public address',
          ja: 'PC A が自分のグローバルアドレスを知る',
        },
        description: {
          en: 'The server copies the source address it saw, 203.0.113.5:40001, into XOR-MAPPED-ADDRESS. It is XORed with the magic cookie so that NATs which rewrite copies of their own address inside packets leave it alone; NAT A itself only rewrites the IP and UDP headers. PC A now has a server-reflexive (srflx) candidate. STUN alone does not get anyone through a NAT: it only tells PC A what the outside sees.',
          ja: 'サーバーは、見えた送信元のアドレス 203.0.113.5:40001 を XOR-MAPPED-ADDRESS に入れる。マジッククッキーと XOR するのは、パケットの中にある自分のアドレスの写しまで書き換える NAT に触られないため。NAT A 自身が書き換えるのは IP と UDP のヘッダーだけ。これで PC A は server reflexive（srflx）の候補を持つ。STUN だけで NAT を越えられるわけではない。外からどう見えるかを教えるだけ。',
        },
      },
      () => {
        flow.serverToA(
          'a-binding-response',
          'Binding Success',
          stunFields({
            type: messageType(0x001, 'success'),
            typeName: 'Binding Success Response',
            transactionId: TX.aBinding,
            attributes: [
              xorAttribute('XOR-MAPPED-ADDRESS', '203.0.113.5', 40001, {
                en: 'X-Port = port XOR 0x2112, X-Address = address XOR 0x2112a442',
                ja: 'X-Port = ポート XOR 0x2112、X-Address = アドレス XOR 0x2112a442',
              }),
            ],
          }),
        )
        flow.emit(flow.set(PC_A, LOCAL, candidates(['host', ADDRESSES.aHost], ['srflx', A_SRFLX])))
      },
    )
  }

  const tls = flow.tls
  flow.step(
    {
      id: 'a-allocate',
      section: GATHER,
      title: { en: 'TURN: asking for a relay address', ja: 'TURN: 中継のアドレスを頼む' },
      description: {
        en: `PC A sends an Allocate request${tls ? ' over the TLS connection' : ' from the same port, so NAT A reuses its mapping'}. REQUESTED-TRANSPORT 17 asks for a UDP relay${tls ? ': between the server and the peer it is always UDP, even when PC A talks to the server over TLS' : ''}. It carries no credentials yet.`,
        ja: `PC A は${tls ? ' TLS の接続で' : '同じポートから'} Allocate の要求を送る${tls ? '' : '（NAT A は対応を使い回す）'}。REQUESTED-TRANSPORT 17 は UDP の中継を頼む${tls ? '（PC A とサーバーの間が TLS でも、サーバーと相手の間はいつも UDP）' : ''}。資格情報はまだ付けない。`,
      },
    },
    () => {
      flow.aToServer(
        'a-allocate',
        'Allocate Request',
        stunFields({
          type: messageType(0x003, 'request'),
          typeName: 'Allocate Request',
          transactionId: TX.allocate,
          attributes: [{ name: 'REQUESTED-TRANSPORT', value: '17 (UDP)', length: 4 }],
        }),
      )
    },
  )
  flow.step(
    {
      id: 'a-401',
      section: GATHER,
      title: { en: 'The server asks who is asking: 401', ja: 'サーバーが誰かを確かめる: 401' },
      description: {
        en: 'A relay uses the server’s bandwidth, so TURN always requires long-term credentials. The server answers 401 (Unauthenticated) with its REALM and a NONCE, and says which password algorithms it supports.',
        ja: '中継はサーバーの帯域を使うので、TURN はいつも長期の資格情報を求める。サーバーは 401（Unauthenticated）で答え、REALM と NONCE と、使えるパスワードのアルゴリズムを知らせる。',
      },
    },
    () => {
      flow.serverToA(
        'a-401',
        'Allocate Error 401',
        stunFields({
          type: messageType(0x003, 'error'),
          typeName: 'Allocate Error Response',
          transactionId: TX.allocate,
          attributes: [
            { name: 'ERROR-CODE', value: '401 (Unauthenticated)', length: 19, highlight: true },
            { name: 'REALM', value: 'example.com', length: 11 },
            {
              name: 'NONCE',
              value: 'obMatJos2gAAAadl7W7PeDU4hKE72jda',
              length: 32,
              description: {
                en: 'Starts with obMatJos2 and a bit field saying the server supports PASSWORD-ALGORITHMS',
                ja: 'obMatJos2 と、サーバーが PASSWORD-ALGORITHMS を使えることを示すビットで始まる',
              },
            },
            { name: 'PASSWORD-ALGORITHMS', value: 'MD5, SHA-256', length: 8 },
          ],
        }),
      )
    },
  )
  flow.step(
    {
      id: 'a-allocate-auth',
      section: GATHER,
      title: { en: 'Allocate again, with credentials', ja: '資格情報を付けて Allocate をもう一度' },
      description: {
        en: 'PC A sends the Allocate again, with a new transaction ID, adding USERNAME, REALM, NONCE and an HMAC-SHA256 over the message. The server creates the allocation and identifies it by its 5-tuple: the protocol and PC A’s server-reflexive address and the server’s address.',
        ja: 'PC A は新しいトランザクション ID で Allocate を送り直し、USERNAME、REALM、NONCE と、メッセージの HMAC-SHA256 を足す。サーバーは割り当てを作り、5-tuple（プロトコル、PC A の server reflexive のアドレス、サーバーのアドレス）で見分ける。',
      },
    },
    () => {
      flow.aToServer(
        'a-allocate-auth',
        'Allocate Request (credentials)',
        stunFields({
          type: messageType(0x003, 'request'),
          typeName: 'Allocate Request',
          transactionId: TX.allocateAuth,
          attributes: [
            { name: 'REQUESTED-TRANSPORT', value: '17 (UDP)', length: 4 },
            ...CREDENTIALS,
          ],
        }),
      )
      flow.emit(flow.set(SERVER, ALLOCATION, allocationTable(tls, '600 s')))
    },
  )
  flow.step(
    {
      id: 'a-allocate-success',
      section: GATHER,
      title: { en: 'A relayed address on the server', ja: 'サーバーの上の中継のアドレス' },
      description: {
        en: `The server reserves 198.51.100.3:55000 for PC A (XOR-RELAYED-ADDRESS) for 600 seconds, and also reports the mapped address. PC A now has a relayed candidate. It gets the lowest priority: relaying costs the server bandwidth and adds delay, so it is used only when nothing else works.${tls ? ' The mapped address is a TCP mapping, so it is not offered as a UDP candidate.' : ''}`,
        ja: `サーバーは 198.51.100.3:55000 を 600 秒のあいだ PC A のために取っておき（XOR-RELAYED-ADDRESS）、マップされたアドレスも知らせる。これで PC A は relay の候補を持つ。優先度はいちばん低い。中継はサーバーの帯域を使い、遅れも増えるので、ほかに手がないときだけ使う。${tls ? 'マップされたアドレスは TCP の対応なので、UDP の候補としては出さない。' : ''}`,
      },
    },
    () => {
      flow.serverToA(
        'a-allocate-success',
        'Allocate Success',
        stunFields({
          type: messageType(0x003, 'success'),
          typeName: 'Allocate Success Response',
          transactionId: TX.allocateAuth,
          attributes: [
            xorAttribute('XOR-RELAYED-ADDRESS', RELAY_IP, RELAY_PORT, {
              en: 'The address on the server that relays for PC A',
              ja: 'サーバーの上で PC A のために中継するアドレス',
            }),
            xorAttribute('XOR-MAPPED-ADDRESS', '203.0.113.5', 40001),
            { name: 'LIFETIME', value: '600 (seconds)', length: 4, highlight: true },
            INTEGRITY_SHA256,
          ],
        }),
      )
      flow.emit(
        flow.set(
          PC_A,
          LOCAL,
          tls
            ? candidates(['host', ADDRESSES.aHost], ['relay', ADDRESSES.relay])
            : candidates(['host', ADDRESSES.aHost], ['srflx', A_SRFLX], ['relay', ADDRESSES.relay]),
        ),
      )
    },
  )

  const offerLines = [
    'a=ice-ufrag:EsAw',
    'a=ice-pwd:P2uYro0UCOQ4zxjKXaWCBui1',
    sdpCandidate({ foundation: '1', type: 'host', ip: '192.168.1.10', port: 49152 }),
    ...(tls
      ? []
      : [
          sdpCandidate({
            foundation: '2',
            type: 'srflx',
            ip: '203.0.113.5',
            port: 40001,
            related: { ip: '192.168.1.10', port: 49152 },
          }),
        ]),
    sdpCandidate({
      foundation: '3',
      type: 'relay',
      ip: RELAY_IP,
      port: RELAY_PORT,
      related: { ip: '203.0.113.5', port: 40001 },
    }),
  ]
  flow.step(
    {
      id: 'offer',
      section: SIGNAL,
      title: { en: 'Signalling: PC A sends an offer', ja: 'シグナリング: PC A がオファーを送る' },
      description: {
        en: `PC A puts its candidates, ufrag and password into an SDP offer, and the app’s signalling server (for example over WebSocket) passes it to PC B. That path is not drawn: ICE does not define signalling. The offerer is the controlling agent. This page sends the candidates only after gathering them all; Trickle ICE would send each one as soon as it is found. ${offerLines.join(' | ')}`,
        ja: `PC A は候補と ufrag とパスワードを SDP のオファーに入れ、アプリケーションのシグナリングのサーバー（たとえば WebSocket）が PC B に渡す。この通り道は描かない。ICE はシグナリングを決めていない。オファーを出す側が controlling（制御する側）。このページでは、候補を集め終えてから送る。Trickle ICE なら、見つけた候補からすぐに送る。${offerLines.join(' | ')}`,
      },
    },
    () => {
      flow.emit(
        flow.set(
          PC_B,
          REMOTE,
          tls
            ? candidates(['host', ADDRESSES.aHost], ['relay', ADDRESSES.relay])
            : candidates(['host', ADDRESSES.aHost], ['srflx', A_SRFLX], ['relay', ADDRESSES.relay]),
        ),
        flow.set(PC_A, ICE_STATE, 'controlling, Running'),
      )
    },
  )

  flow.step(
    {
      id: 'b-binding',
      section: GATHER,
      title: { en: 'PC B asks the STUN server too', ja: 'PC B も STUN のサーバーに聞く' },
      description: {
        en: 'After receiving the offer, PC B gathers its own candidates. It sends a Binding Request to the same server; NAT B creates a mapping to 192.0.2.77:60001. On this page PC B does not use TURN.',
        ja: 'オファーを受け取った PC B は、自分の候補を集める。同じサーバーに Binding Request を送り、NAT B は 192.0.2.77:60001 への対応を作る。このページでは、PC B は TURN を使わない。',
      },
    },
    () => {
      flow.bToServer('b-binding', 'Binding Request', bindingRequest(TX.bBinding), ADDRESSES.server)
    },
  )
  flow.step(
    {
      id: 'b-binding-response',
      section: GATHER,
      title: { en: 'PC B learns its public address', ja: 'PC B が自分のグローバルアドレスを知る' },
      description: {
        en: 'The server answers with XOR-MAPPED-ADDRESS 192.0.2.77:60001, and PC B has a server-reflexive candidate.',
        ja: 'サーバーは XOR-MAPPED-ADDRESS 192.0.2.77:60001 で答え、PC B は server reflexive の候補を持つ。',
      },
    },
    () => {
      flow.serverToB(
        'b-binding-response',
        'Binding Success',
        stunFields({
          type: messageType(0x001, 'success'),
          typeName: 'Binding Success Response',
          transactionId: TX.bBinding,
          attributes: [xorAttribute('XOR-MAPPED-ADDRESS', '192.0.2.77', 60001)],
        }),
        ADDRESSES.server,
        B_SRFLX,
      )
      flow.emit(flow.set(PC_B, LOCAL, candidates(['host', ADDRESSES.bHost], ['srflx', B_SRFLX])))
    },
  )

  const answerLines = [
    'a=ice-ufrag:bxkW',
    'a=ice-pwd:7u3mZ0kS9cQv1LnB5hTpXe',
    sdpCandidate({ foundation: '1', type: 'host', ip: '10.0.0.20', port: 50000 }),
    sdpCandidate({
      foundation: '2',
      type: 'srflx',
      ip: '192.0.2.77',
      port: 60001,
      related: { ip: '10.0.0.20', port: 50000 },
    }),
  ]
  flow.step(
    {
      id: 'answer',
      section: SIGNAL,
      title: {
        en: 'Signalling: PC B answers; both build a checklist',
        ja: 'シグナリング: PC B が答え、両方がチェックリストを作る',
      },
      description: {
        en: `PC B sends its answer the same way. Each side pairs its candidates with the other side’s and sorts the pairs by priority: 2^32 × MIN(G, D) + 2 × MAX(G, D) + (G > D ? 1 : 0), where G is the controlling side’s candidate priority. Candidates with the same base as the host candidate are checked from the host, so PC A’s srflx candidate is not paired on its own. ${answerLines.join(' | ')}`,
        ja: `PC B も同じように答えを送る。どちらの側も、自分の候補と相手の候補を組にし、優先度の順に並べる。優先度は 2^32 × MIN(G, D) + 2 × MAX(G, D) + (G > D ? 1 : 0) で、G は controlling の側の候補の優先度。ホスト候補と基底が同じ候補はホストから送るので、PC A の srflx の候補は別の組にしない。${answerLines.join(' | ')}`,
      },
    },
    () => {
      flow.emit(
        flow.set(PC_A, REMOTE, candidates(['host', ADDRESSES.bHost], ['srflx', B_SRFLX])),
        flow.set(
          PC_A,
          CHECKLIST,
          checklist(
            [ADDRESSES.aHost, ADDRESSES.bHost, 'Waiting'],
            [ADDRESSES.aHost, B_SRFLX, 'Waiting'],
            [ADDRESSES.relay, ADDRESSES.bHost, 'Waiting'],
            [ADDRESSES.relay, B_SRFLX, 'Waiting'],
          ),
        ),
        flow.set(
          PC_B,
          CHECKLIST,
          tls
            ? checklist(
                [ADDRESSES.bHost, ADDRESSES.aHost, 'Waiting'],
                [ADDRESSES.bHost, ADDRESSES.relay, 'Waiting'],
              )
            : checklist(
                [ADDRESSES.bHost, ADDRESSES.aHost, 'Waiting'],
                [ADDRESSES.bHost, A_SRFLX, 'Waiting'],
                [ADDRESSES.bHost, ADDRESSES.relay, 'Waiting'],
              ),
        ),
        flow.set(PC_B, ICE_STATE, 'controlled, Running'),
      )
    },
  )

  flow.step(
    {
      id: 'permission',
      section: SIGNAL,
      title: { en: 'A TURN permission for PC B', ja: 'PC B のための TURN の許可' },
      description: {
        en: 'Now that it knows PC B’s addresses, PC A asks the server to accept packets from them at the relayed address. One CreatePermission can carry several XOR-PEER-ADDRESS attributes. A permission is for an IP address only (the port is ignored) and lasts 300 seconds.',
        ja: 'PC B のアドレスがわかったので、PC A は、中継のアドレスでそこからのパケットを受け付けるようサーバーに頼む。1 つの CreatePermission に XOR-PEER-ADDRESS をいくつも入れられる。許可は IP アドレスだけに対するもの（ポートは見ない）で、300 秒続く。',
      },
    },
    () => {
      flow.aToServer(
        'permission',
        'CreatePermission Request',
        stunFields({
          type: messageType(0x008, 'request'),
          typeName: 'CreatePermission Request',
          transactionId: TX.permission,
          attributes: [
            xorAttribute('XOR-PEER-ADDRESS', '10.0.0.20', 0),
            xorAttribute('XOR-PEER-ADDRESS', '192.0.2.77', 0, {
              en: 'Only the IP address counts; the port (here 0) is ignored',
              ja: '意味があるのは IP アドレスだけ。ポート（ここでは 0）は見ない',
            }),
            ...CREDENTIALS,
          ],
        }),
      )
      flow.serverToA(
        'permission',
        'CreatePermission Success',
        stunFields({
          type: messageType(0x008, 'success'),
          typeName: 'CreatePermission Success Response',
          transactionId: TX.permission,
          attributes: [INTEGRITY_SHA256],
        }),
      )
      flow.emit(
        flow.set(SERVER, PERMISSIONS, permissions(['10.0.0.20', '300 s'], ['192.0.2.77', '300 s'])),
      )
    },
  )
}

function checkFields(tx: string, from: 'A' | 'B', useCandidate = false) {
  return stunFields({
    type: messageType(0x001, 'request'),
    typeName: 'Binding Request (ICE check)',
    transactionId: tx,
    attributes: checkAttributes(from, useCandidate),
  })
}
function responseFields(tx: string, mapped: string) {
  const [ip, port] = splitEndpoint(mapped)
  return stunFields({
    type: messageType(0x001, 'success'),
    typeName: 'Binding Success Response',
    transactionId: tx,
    attributes: checkResponseAttributes(ip, port),
  })
}

function direct(flow: Flow) {
  const A_SRFLX_TO_B = A_SRFLX
  flow.step(
    {
      id: 'a-check',
      section: CHECKS,
      title: {
        en: 'PC A’s first check is dropped at NAT B',
        ja: 'PC A の最初のチェックは NAT B で捨てられる',
      },
      description: {
        en: 'PC A sends a connectivity check (a Binding Request with ICE attributes) from its host address to PC B’s server-reflexive address. NAT A creates a mapping for this destination with the same external port. NAT B has never sent anything to 203.0.113.5:40001, so its filter drops the packet. (The host-to-host check, not drawn, fails too: private addresses are not routed on the Internet.)',
        ja: 'PC A は、ホストのアドレスから PC B の server reflexive のアドレスへ接続性チェック（ICE の属性を付けた Binding Request）を送る。NAT A はこの宛先への対応を、同じ外側のポートで作る。NAT B は 203.0.113.5:40001 に何も送ったことがないので、フィルターがパケットを捨てる（ホストどうしのチェックも失敗する。描いていないが、プライベートアドレスはインターネットで経路が広告されない）。',
      },
    },
    () => {
      flow.aToB('a-check', 'Binding Request (check)', checkFields(TX.aCheck, 'A'), B_SRFLX)
      flow.emit(
        flow.set(
          PC_A,
          CHECKLIST,
          checklist(
            [ADDRESSES.aHost, ADDRESSES.bHost, 'Failed'],
            [ADDRESSES.aHost, B_SRFLX, 'In-Progress'],
            [ADDRESSES.relay, ADDRESSES.bHost, 'Waiting'],
            [ADDRESSES.relay, B_SRFLX, 'Waiting'],
          ),
        ),
      )
    },
  )
  flow.step(
    {
      id: 'b-check',
      section: CHECKS,
      title: { en: 'PC B’s check gets through', ja: 'PC B のチェックは通る' },
      description: {
        en: 'PC B sends its own check to 203.0.113.5:40001. NAT B keeps the same external port 60001 (endpoint-independent mapping). NAT A lets it in, because PC A has just sent to 192.0.2.77:60001: that outgoing check opened the way. This is hole punching, and it only works because both sides send.',
        ja: 'PC B も 203.0.113.5:40001 へチェックを送る。NAT B は同じ外側のポート 60001 を使う（宛先によらない対応づけ）。NAT A はこれを通す。PC A がちょうど 192.0.2.77:60001 に送ったから。その外向きのチェックが道を開けた。これがホールパンチングで、両側が送るから通る。',
      },
    },
    () => {
      flow.bToA('b-check', 'Binding Request (check)', checkFields(TX.bCheck, 'B'), A_SRFLX_TO_B)
      flow.emit(
        flow.set(
          PC_B,
          CHECKLIST,
          checklist(
            [ADDRESSES.bHost, ADDRESSES.aHost, 'Failed'],
            [ADDRESSES.bHost, A_SRFLX, 'In-Progress'],
            [ADDRESSES.bHost, ADDRESSES.relay, 'Waiting'],
          ),
        ),
      )
    },
  )
  flow.step(
    {
      id: 'a-response',
      section: CHECKS,
      title: { en: 'PC A answers PC B’s check', ja: 'PC A が PC B のチェックに答える' },
      description: {
        en: 'PC A answers with the source address it saw, 192.0.2.77:60001, and NAT B lets the answer in (PC B sent to 203.0.113.5:40001). PC B’s pair has succeeded. Because PC A received a check on a pair it is also checking, it schedules a triggered check on that pair.',
        ja: 'PC A は見えた送信元のアドレス 192.0.2.77:60001 で答え、NAT B はその答えを通す（PC B が 203.0.113.5:40001 に送ったから）。PC B のペアは成功した。PC A は、自分もチェックしているペアでチェックを受け取ったので、そのペアでトリガーされたチェックを予定する。',
      },
    },
    () => {
      flow.aToB(
        'a-response',
        'Binding Success (check)',
        responseFields(TX.bCheck, B_SRFLX),
        B_SRFLX,
      )
      flow.emit(
        flow.set(
          PC_B,
          CHECKLIST,
          checklist(
            [ADDRESSES.bHost, ADDRESSES.aHost, 'Failed'],
            [ADDRESSES.bHost, A_SRFLX, 'Succeeded'],
            [ADDRESSES.bHost, ADDRESSES.relay, 'Waiting'],
          ),
        ),
      )
    },
  )
  flow.step(
    {
      id: 'a-triggered',
      section: CHECKS,
      title: {
        en: 'PC A’s triggered check now gets through',
        ja: 'PC A のトリガーされたチェックが今度は通る',
      },
      description: {
        en: 'PC A checks the same pair again. This time NAT B has a mapping with 203.0.113.5:40001 as its remote, so the check passes.',
        ja: 'PC A は同じペアをもう一度チェックする。今度は NAT B に 203.0.113.5:40001 を相手とする対応があるので、チェックは通る。',
      },
    },
    () => {
      flow.aToB('a-triggered', 'Binding Request (check)', checkFields(TX.aTriggered, 'A'), B_SRFLX)
    },
  )
  flow.step(
    {
      id: 'b-response',
      section: CHECKS,
      title: { en: 'Both directions work', ja: '両方の向きが通る' },
      description: {
        en: 'PC B answers with 203.0.113.5:40001. PC A’s pair has succeeded too. The valid pair is built from the mapped address: PC A’s server-reflexive address with PC B’s.',
        ja: 'PC B は 203.0.113.5:40001 で答える。PC A のペアも成功した。有効なペアはマップされたアドレスから作るので、PC A と PC B の server reflexive のアドレスの組になる。',
      },
    },
    () => {
      flow.bToA(
        'b-response',
        'Binding Success (check)',
        responseFields(TX.aTriggered, A_SRFLX),
        A_SRFLX,
      )
      flow.emit(
        flow.set(
          PC_A,
          CHECKLIST,
          checklist(
            [ADDRESSES.aHost, ADDRESSES.bHost, 'Failed'],
            [A_SRFLX, B_SRFLX, 'Succeeded'],
            [ADDRESSES.relay, ADDRESSES.bHost, 'Waiting'],
            [ADDRESSES.relay, B_SRFLX, 'Waiting'],
          ),
        ),
      )
    },
  )
  flow.step(
    {
      id: 'nominate',
      section: CHECKS,
      title: {
        en: 'PC A nominates the pair: USE-CANDIDATE',
        ja: 'PC A がペアを指名する: USE-CANDIDATE',
      },
      description: {
        en: 'Only the controlling agent nominates. PC A checks the valid pair once more with USE-CANDIDATE, and when it succeeds both sides select it and stop checking the other pairs. (When to nominate is up to the agent; this page nominates the first valid pair.)',
        ja: '指名できるのは controlling の側だけ。PC A は USE-CANDIDATE を付けて有効なペアをもう一度チェックし、成功すると両側がそれを選び、ほかのペアのチェックをやめる（いつ指名するかは各実装が決める。このページでは最初の有効なペアを指名する）。',
      },
    },
    () => {
      flow.aToB(
        'nominate',
        'Binding Request (USE-CANDIDATE)',
        checkFields(TX.nominate, 'A', true),
        B_SRFLX,
      )
      flow.bToA(
        'nominate',
        'Binding Success (check)',
        responseFields(TX.nominate, A_SRFLX),
        A_SRFLX,
      )
      flow.emit(
        flow.set(PC_A, CHECKLIST, checklist([A_SRFLX, B_SRFLX, 'Succeeded, nominated'])),
        flow.set(PC_B, CHECKLIST, checklist([B_SRFLX, A_SRFLX, 'Succeeded, nominated'])),
        flow.set(PC_A, ICE_STATE, 'controlling, Completed'),
        flow.set(PC_B, ICE_STATE, 'controlled, Completed'),
        flow.set(PC_A, SELECTED, `${A_SRFLX} ↔ ${B_SRFLX}`),
        flow.set(PC_B, SELECTED, `${B_SRFLX} ↔ ${A_SRFLX}`),
      )
    },
  )
  flow.step(
    {
      id: 'media',
      section: MEDIA,
      title: { en: 'Media flows directly', ja: 'メディアが直接流れる' },
      description: {
        en: 'Audio and video now go straight between the two NATs, as SRTP. (The DTLS handshake that sets up its keys is not drawn.) While the call lasts, each side keeps sending checks every 4–6 seconds to confirm that the other still wants the traffic (consent freshness).',
        ja: '音声と映像は、2 つの NAT の間を SRTP で直接流れる（その鍵を決める DTLS のハンドシェイクは描かない）。通話の間、どちらの側も 4〜6 秒ごとにチェックを送り、相手がまだこの通信を望んでいるかを確かめる（consent freshness）。',
      },
    },
    () => {
      flow.aToB('media-a', 'SRTP (media)', innerFields('SRTP (audio/video)'), B_SRFLX)
      flow.bToA('media-b', 'SRTP (media)', innerFields('SRTP (audio/video)'), A_SRFLX)
    },
  )
  flow.step(
    {
      id: 'free-relay',
      section: MEDIA,
      title: { en: 'The unused relay is released', ja: '使わない中継を返す' },
      description: {
        en: 'Three seconds after ICE has completed, PC A frees the candidates it does not use. For the relay it sends Refresh with LIFETIME 0, which deletes the allocation together with its permissions.',
        ja: 'ICE が完了してから 3 秒後、PC A は使わない候補を放す。中継には LIFETIME 0 の Refresh を送り、割り当てを許可ごと消す。',
      },
    },
    () => {
      flow.timer(PC_A, 'Release (3 s)', RELEASE_MS)
      flow.aToServer(
        'free-relay',
        'Refresh (LIFETIME 0)',
        stunFields({
          type: messageType(0x004, 'request'),
          typeName: 'Refresh Request',
          transactionId: TX.release,
          attributes: [
            { name: 'LIFETIME', value: '0 (delete)', length: 4, highlight: true },
            ...CREDENTIALS,
          ],
        }),
      )
      flow.serverToA(
        'free-relay',
        'Refresh Success',
        stunFields({
          type: messageType(0x004, 'success'),
          typeName: 'Refresh Success Response',
          transactionId: TX.release,
          attributes: [{ name: 'LIFETIME', value: '0', length: 4 }, INTEGRITY_SHA256],
        }),
      )
      flow.emit(
        flow.set(SERVER, ALLOCATION, EMPTY_ALLOCATION),
        flow.set(SERVER, PERMISSIONS, permissions()),
        flow.set(PC_A, LOCAL, candidates(['host', ADDRESSES.aHost], ['srflx', A_SRFLX])),
      )
    },
  )
}

function relayed(flow: Flow, permissionExpires: boolean) {
  const { network, tls } = flow
  const symmetric = network === 'symmetric'

  if (tls) {
    flow.step(
      {
        id: 'a-check-blocked',
        section: CHECKS,
        title: { en: 'PC A’s direct checks cannot leave', ja: 'PC A の直接のチェックは出られない' },
        description: {
          en: 'PC A tries its host-to-server-reflexive pair over UDP, and its own network drops it. Only the relayed candidate can work.',
          ja: 'PC A はホストから server reflexive へのペアを UDP で試すが、自分の網が捨てる。使えるのは relay の候補だけ。',
        },
      },
      () => {
        flow.aToB('a-check', 'Binding Request (check)', checkFields(TX.aCheck, 'A'), B_SRFLX)
        flow.emit(
          flow.set(
            PC_A,
            CHECKLIST,
            checklist(
              [ADDRESSES.aHost, ADDRESSES.bHost, 'Failed'],
              [ADDRESSES.aHost, B_SRFLX, 'Failed'],
              [ADDRESSES.relay, ADDRESSES.bHost, 'Waiting'],
              [ADDRESSES.relay, B_SRFLX, 'Waiting'],
            ),
          ),
        )
      },
    )
  } else {
    flow.step(
      {
        id: 'a-check',
        section: CHECKS,
        title: {
          en: 'PC A’s first check is dropped at NAT B',
          ja: 'PC A の最初のチェックは NAT B で捨てられる',
        },
        description: {
          en: 'As in the normal case, PC A’s check to 192.0.2.77:60001 is dropped: NAT B’s port 60001 has only ever sent to the STUN server. (The host-to-host check, not drawn, fails too.)',
          ja: 'ふつうの場合と同じく、192.0.2.77:60001 への PC A のチェックは捨てられる。NAT B の 60001 番は、STUN のサーバーにしか送ったことがない（ホストどうしのチェックも失敗する。描いていない）。',
        },
      },
      () => {
        flow.aToB('a-check', 'Binding Request (check)', checkFields(TX.aCheck, 'A'), B_SRFLX)
        flow.emit(
          flow.set(
            PC_A,
            CHECKLIST,
            checklist(
              [ADDRESSES.aHost, ADDRESSES.bHost, 'Failed'],
              [ADDRESSES.aHost, B_SRFLX, 'In-Progress'],
              [ADDRESSES.relay, ADDRESSES.bHost, 'Waiting'],
              [ADDRESSES.relay, B_SRFLX, 'Waiting'],
            ),
          ),
        )
      },
    )
    flow.step(
      {
        id: 'b-check',
        section: CHECKS,
        title: {
          en: 'PC B’s check gets a new port, and is dropped',
          ja: 'PC B のチェックは新しいポートになり、捨てられる',
        },
        description: {
          en: 'PC B sends its check to 203.0.113.5:40001, but NAT B picks a new external port, 60002, for this new destination. NAT A only expects packets from 192.0.2.77:60001, so it drops this one. The two sides can never agree on a port: hole punching fails in both directions.',
          ja: 'PC B は 203.0.113.5:40001 へチェックを送るが、NAT B はこの新しい宛先に新しい外側のポート 60002 を選ぶ。NAT A が待っているのは 192.0.2.77:60001 からのパケットだけなので、これを捨てる。両側がポートで合意できないので、どちらの向きでもホールパンチングは失敗する。',
        },
      },
      () => {
        flow.bToA('b-check', 'Binding Request (check)', checkFields(TX.bCheck, 'B'), A_SRFLX)
        flow.emit(
          flow.set(
            PC_B,
            CHECKLIST,
            checklist(
              [ADDRESSES.bHost, ADDRESSES.aHost, 'Failed'],
              [ADDRESSES.bHost, A_SRFLX, 'In-Progress'],
              [ADDRESSES.bHost, ADDRESSES.relay, 'Waiting'],
            ),
          ),
        )
      },
    )
  }

  // PC B から中継のアドレスへのチェック
  const peerAtRelay = symmetric ? '192.0.2.77:60003' : B_SRFLX
  flow.step(
    {
      id: 'b-check-relay',
      section: CHECKS,
      title: {
        en: 'PC B’s check to the relayed address',
        ja: '中継のアドレスへの PC B のチェック',
      },
      description: symmetric
        ? {
            en: 'PC B checks its pair with PC A’s relayed address. NAT B opens yet another port, 60003. The server has a permission for 192.0.2.77, and permissions compare only the IP address, so it relays the check to PC A inside a Data indication. PC A has never heard of 192.0.2.77:60003, so it adds it as a peer-reflexive remote candidate.',
            ja: 'PC B は、PC A の中継のアドレスとのペアをチェックする。NAT B はさらに別のポート 60003 を開ける。サーバーには 192.0.2.77 の許可があり、許可は IP アドレスだけを比べるので、チェックを Data の通知に入れて PC A に中継する。PC A は 192.0.2.77:60003 を知らなかったので、peer reflexive の相手の候補として加える。',
          }
        : {
            en: `PC B checks its pair with PC A’s relayed address. NAT B reuses port 60001 (endpoint-independent mapping). The server has a permission for 192.0.2.77, so it relays the check to PC A inside a Data indication${tls ? ', over the TLS connection' : ''}. The source is PC B’s known server-reflexive address, so no new candidate appears.`,
            ja: `PC B は、PC A の中継のアドレスとのペアをチェックする。NAT B は 60001 番を使い回す（宛先によらない対応づけ）。サーバーには 192.0.2.77 の許可があるので、チェックを Data の通知に入れて${tls ? ' TLS の接続で' : ''} PC A に中継する。送信元は、すでに知っている PC B の server reflexive のアドレスなので、新しい候補は現れない。`,
          },
    },
    () => {
      flow.bToServer(
        'b-check-relay',
        'Binding Request (check)',
        checkFields(TX.bCheck, 'B'),
        ADDRESSES.relay,
      )
      flow.serverToA(
        'b-check-relay',
        'Data indication (check)',
        indicationFields(
          'data',
          TX.indication1,
          peerAtRelay,
          checkBytes(),
          'Binding Request from PC B',
        ),
      )
      flow.emit(
        flow.set(
          PC_B,
          CHECKLIST,
          tls
            ? checklist(
                [ADDRESSES.bHost, ADDRESSES.aHost, 'Failed'],
                [ADDRESSES.bHost, ADDRESSES.relay, 'In-Progress'],
              )
            : checklist(
                [ADDRESSES.bHost, ADDRESSES.aHost, 'Failed'],
                [ADDRESSES.bHost, A_SRFLX, 'In-Progress'],
                [ADDRESSES.bHost, ADDRESSES.relay, 'In-Progress'],
              ),
        ),
      )
      if (symmetric) {
        flow.emit(
          flow.set(
            PC_A,
            REMOTE,
            candidates(['host', ADDRESSES.bHost], ['srflx', B_SRFLX], ['prflx', peerAtRelay]),
          ),
        )
      }
    },
  )

  flow.step(
    {
      id: 'a-response-relay',
      section: CHECKS,
      title: { en: 'PC A answers through the relay', ja: 'PC A が中継を通して答える' },
      description: symmetric
        ? {
            en: 'PC A answers inside a Send indication. The server sends the answer from 198.51.100.3:55000, and NAT B lets it in, because port 60003 was opened towards exactly that address. The answer tells PC B its address as seen from the relay, 192.0.2.77:60003, which PC B adds as a peer-reflexive local candidate.',
            ja: 'PC A は Send の通知に答えを入れる。サーバーは 198.51.100.3:55000 から答えを送り、NAT B はそれを通す。60003 番は、ちょうどそのアドレスに向けて開けたものだから。答えは、中継から見た PC B のアドレス 192.0.2.77:60003 を知らせ、PC B はそれを peer reflexive の自分の候補として加える。',
          }
        : {
            en: 'PC A answers inside a Send indication. The server sends the answer from 198.51.100.3:55000, and NAT B lets it in, because PC B has just sent to that address. PC B’s pair with the relayed candidate has succeeded.',
            ja: 'PC A は Send の通知に答えを入れる。サーバーは 198.51.100.3:55000 から答えを送り、NAT B はそれを通す。PC B がちょうどそのアドレスに送ったから。PC B の、relay の候補とのペアは成功した。',
          },
    },
    () => {
      flow.aToServer(
        'a-response-relay',
        'Send indication (response)',
        indicationFields(
          'send',
          TX.indication2,
          peerAtRelay,
          RESPONSE_BYTES,
          'Binding Success to PC B',
        ),
      )
      flow.serverToB(
        'a-response-relay',
        'UDP from relay (response)',
        responseFields(TX.bCheck, peerAtRelay),
        ADDRESSES.relay,
        peerAtRelay,
      )
      if (symmetric) {
        flow.emit(
          flow.set(
            PC_B,
            LOCAL,
            candidates(['host', ADDRESSES.bHost], ['srflx', B_SRFLX], ['prflx', peerAtRelay]),
          ),
        )
      }
      flow.emit(
        flow.set(
          PC_B,
          CHECKLIST,
          tls
            ? checklist(
                [ADDRESSES.bHost, ADDRESSES.aHost, 'Failed'],
                [peerAtRelay, ADDRESSES.relay, 'Succeeded'],
              )
            : checklist(
                [ADDRESSES.bHost, ADDRESSES.aHost, 'Failed'],
                [ADDRESSES.bHost, A_SRFLX, 'In-Progress'],
                [peerAtRelay, ADDRESSES.relay, 'Succeeded'],
              ),
        ),
      )
    },
  )

  const aRelayRows = (state: 'In-Progress' | 'Succeeded'): Pair[] =>
    symmetric
      ? [
          [ADDRESSES.aHost, ADDRESSES.bHost, 'Failed'],
          [ADDRESSES.aHost, B_SRFLX, 'In-Progress'],
          [ADDRESSES.relay, ADDRESSES.bHost, 'Waiting'],
          [ADDRESSES.relay, peerAtRelay, state],
          [ADDRESSES.relay, B_SRFLX, 'Waiting'],
        ]
      : [
          [ADDRESSES.aHost, ADDRESSES.bHost, 'Failed'],
          [ADDRESSES.aHost, B_SRFLX, 'Failed'],
          [ADDRESSES.relay, ADDRESSES.bHost, 'Waiting'],
          [ADDRESSES.relay, B_SRFLX, state],
        ]
  flow.step(
    {
      id: 'a-triggered-relay',
      section: CHECKS,
      title: { en: 'PC A checks the relayed pair', ja: 'PC A が中継のペアをチェックする' },
      description: {
        en: `The check PC A received creates a triggered check on the pair (relayed, ${peerAtRelay})${symmetric ? ', which is added to the checklist in priority order' : ''}. PC A sends it through the server inside a Send indication.`,
        ja: `PC A が受け取ったチェックから、ペア（relay、${peerAtRelay}）のトリガーされたチェックが生まれる${symmetric ? '（優先度の順にチェックリストに加える）' : ''}。PC A はそれを Send の通知に入れて、サーバーを通して送る。`,
      },
    },
    () => {
      flow.aToServer(
        'a-triggered-relay',
        'Send indication (check)',
        indicationFields(
          'send',
          TX.indication3,
          peerAtRelay,
          checkBytes(),
          'Binding Request to PC B',
        ),
      )
      flow.serverToB(
        'a-triggered-relay',
        'UDP from relay (check)',
        checkFields(TX.aTriggered, 'A'),
        ADDRESSES.relay,
        peerAtRelay,
      )
      flow.emit(flow.set(PC_A, CHECKLIST, checklist(...aRelayRows('In-Progress'))))
    },
  )
  flow.step(
    {
      id: 'b-response-relay',
      section: CHECKS,
      title: { en: 'The relayed pair works', ja: '中継のペアが通る' },
      description: {
        en: 'PC B answers, and the server relays the answer to PC A in a Data indication. The mapped address in it is 198.51.100.3:55000, PC A’s relayed candidate, so PC A has a valid pair.',
        ja: 'PC B が答え、サーバーはそれを Data の通知で PC A に中継する。中のマップされたアドレスは PC A の relay の候補 198.51.100.3:55000 なので、PC A は有効なペアを持つ。',
      },
    },
    () => {
      flow.bToServer(
        'b-response-relay',
        'Binding Success (check)',
        responseFields(TX.aTriggered, ADDRESSES.relay),
        ADDRESSES.relay,
      )
      flow.serverToA(
        'b-response-relay',
        'Data indication (response)',
        indicationFields(
          'data',
          TX.indication4,
          peerAtRelay,
          RESPONSE_BYTES,
          'Binding Success from PC B',
        ),
      )
      flow.emit(flow.set(PC_A, CHECKLIST, checklist(...aRelayRows('Succeeded'))))
    },
  )
  flow.step(
    {
      id: 'nominate-relay',
      section: CHECKS,
      title: { en: 'PC A nominates the relayed pair', ja: 'PC A が中継のペアを指名する' },
      description: {
        en: 'PC A nominates the relayed pair with USE-CANDIDATE, through the server. Both sides select it and remove the other pairs, including the direct ones that never succeeded.',
        ja: 'PC A はサーバーを通して、USE-CANDIDATE で中継のペアを指名する。両側がそれを選び、成功しなかった直接のペアも含めて、ほかのペアを除く。',
      },
    },
    () => {
      flow.aToServer(
        'nominate-relay',
        'Send indication (check)',
        indicationFields(
          'send',
          TX.indication5,
          peerAtRelay,
          checkBytes(true),
          'Binding Request with USE-CANDIDATE',
        ),
      )
      flow.serverToB(
        'nominate-relay',
        'UDP from relay (check)',
        checkFields(TX.nominate, 'A', true),
        ADDRESSES.relay,
        peerAtRelay,
      )
      flow.bToServer(
        'nominate-relay',
        'Binding Success (check)',
        responseFields(TX.nominate, ADDRESSES.relay),
        ADDRESSES.relay,
      )
      flow.serverToA(
        'nominate-relay',
        'Data indication (response)',
        indicationFields(
          'data',
          TX.indication6,
          peerAtRelay,
          RESPONSE_BYTES,
          'Binding Success from PC B',
        ),
      )
      flow.emit(
        flow.set(
          PC_A,
          CHECKLIST,
          checklist([ADDRESSES.relay, peerAtRelay, 'Succeeded, nominated']),
        ),
        flow.set(
          PC_B,
          CHECKLIST,
          checklist([peerAtRelay, ADDRESSES.relay, 'Succeeded, nominated']),
        ),
        flow.set(PC_A, ICE_STATE, 'controlling, Completed'),
        flow.set(PC_B, ICE_STATE, 'controlled, Completed'),
        flow.set(PC_A, SELECTED, `${ADDRESSES.relay} ↔ ${peerAtRelay}`),
        flow.set(PC_B, SELECTED, `${peerAtRelay} ↔ ${ADDRESSES.relay}`),
      )
    },
  )

  const channelBind = (tx: string) => {
    const [ip, port] = splitEndpoint(peerAtRelay)
    flow.aToServer(
      'channel-bind',
      'ChannelBind 0x4000',
      stunFields({
        type: messageType(0x009, 'request'),
        typeName: 'ChannelBind Request',
        transactionId: tx,
        attributes: [
          { name: 'CHANNEL-NUMBER', value: '0x4000', length: 4, highlight: true },
          xorAttribute('XOR-PEER-ADDRESS', ip, port, {
            en: 'A channel is bound to the peer’s full transport address, IP and port',
            ja: 'チャネルは、相手のトランスポートアドレス（IP とポート）全体に結びつける',
          }),
          ...CREDENTIALS,
        ],
      }),
    )
    flow.serverToA(
      'channel-bind',
      'ChannelBind Success',
      stunFields({
        type: messageType(0x009, 'success'),
        typeName: 'ChannelBind Success Response',
        transactionId: tx,
        attributes: [INTEGRITY_SHA256],
      }),
    )
  }

  flow.step(
    {
      id: 'channel-bind',
      section: MEDIA,
      title: { en: 'A channel for cheaper relaying', ja: '安く中継するためのチャネル' },
      description: {
        en: `Every Send or Data indication adds 36 bytes of STUN around each media packet. PC A binds channel 0x4000 to ${peerAtRelay}, after which each packet needs only a 4-byte header. Binding a channel also refreshes the permission for that IP address. A channel lasts 600 seconds.`,
        ja: `Send や Data の通知は、メディアのパケットごとに STUN の 36 バイトを加える。PC A はチャネル 0x4000 を ${peerAtRelay} に結びつけ、その後はパケットごとに 4 バイトのヘッダーで済む。チャネルを結びつけると、その IP アドレスの許可も更新される。チャネルは 600 秒続く。`,
      },
    },
    () => {
      channelBind(TX.channelBind)
      flow.emit(
        flow.set(SERVER, CHANNELS, channels(['0x4000', peerAtRelay, '600 s'])),
        flow.set(SERVER, PERMISSIONS, permissions(['10.0.0.20', '300 s'], ['192.0.2.77', '300 s'])),
      )
    },
  )

  const srtpBytes = 122
  const channelDataFields: PacketField[] = [
    {
      name: 'ChannelData header',
      value: hex(channelDataHeader(CHANNEL, srtpBytes)),
      highlight: true,
      description: {
        en: 'Channel number (2 bytes) and length (2 bytes). Not a STUN message: no magic cookie, no transaction ID',
        ja: 'チャネル番号（2 バイト）と長さ（2 バイト）。STUN のメッセージではないので、マジッククッキーもトランザクション ID もない',
      },
    },
    { name: 'Payload', value: `SRTP (${String(srtpBytes)} bytes)` },
    ...(tls
      ? [
          {
            name: 'Padding',
            value: `${String(paddedSize(4 + srtpBytes) - (4 + srtpBytes))} bytes (to ${String(paddedSize(4 + srtpBytes))})`,
            description: {
              en: 'Over TCP and TLS, ChannelData is padded to a multiple of 4 bytes',
              ja: 'TCP・TLS の上では、ChannelData を 4 バイトの倍数に詰める',
            },
          },
        ]
      : []),
  ]
  flow.step(
    {
      id: 'media-relay',
      section: MEDIA,
      title: { en: 'Media through the relay', ja: '中継を通るメディア' },
      description: {
        en: `PC A sends media to the server as ChannelData${tls ? ' over TLS' : ''}; the server sends it on as plain UDP from 198.51.100.3:55000. In the other direction, the server wraps what PC B sends into ChannelData for PC A. Everything passes through the server, which costs its bandwidth.`,
        ja: `PC A は${tls ? ' TLS の上で' : ''}メディアを ChannelData でサーバーに送り、サーバーは 198.51.100.3:55000 からふつうの UDP で送り出す。逆の向きでは、サーバーは PC B から来たものを ChannelData に包んで PC A に送る。すべてがサーバーを通るので、サーバーの帯域を使う。`,
      },
    },
    () => {
      flow.aToServer('media-a', 'ChannelData 0x4000 (SRTP)', channelDataFields)
      flow.serverToB(
        'media-a',
        'SRTP (relayed)',
        innerFields(`SRTP (${String(srtpBytes)} bytes)`),
        ADDRESSES.relay,
        peerAtRelay,
      )
      flow.bToServer(
        'media-b',
        'SRTP (media)',
        innerFields(`SRTP (${String(srtpBytes)} bytes)`),
        ADDRESSES.relay,
      )
      flow.serverToA('media-b', 'ChannelData 0x4000 (SRTP)', channelDataFields)
    },
  )

  flow.step(
    {
      id: 'four-minutes',
      section: KEEP,
      title: permissionExpires
        ? {
            en: 'Four minutes later: PC A forgets the permission',
            ja: '4 分後: PC A が許可を忘れる',
          }
        : { en: 'Four minutes later: refreshing the permission', ja: '4 分後: 許可を更新する' },
      description: permissionExpires
        ? {
            en: 'Four minutes have passed. The permissions have only 60 seconds left, and PC A does not refresh them. (Sending data does not refresh anything.)',
            ja: '4 分たった。許可の残りは 60 秒だけだが、PC A は更新しない（データを送っても、何も更新されない）。',
          }
        : {
            en: 'Four minutes have passed. The permission would expire after 300 seconds and sending data does not refresh it, so PC A binds the channel again, which refreshes both the channel and the permission for 192.0.2.77.',
            ja: '4 分たった。許可は 300 秒で切れ、データを送っても更新されないので、PC A はチャネルを結びつけ直す。これでチャネルと、192.0.2.77 の許可の両方が更新される。',
          },
    },
    () => {
      flow.timer(PC_A, 'Refresh timer', REFRESH_MS)
      if (permissionExpires) {
        flow.emit(
          flow.set(SERVER, PERMISSIONS, permissions(['10.0.0.20', '60 s'], ['192.0.2.77', '60 s'])),
          flow.set(SERVER, CHANNELS, channels(['0x4000', peerAtRelay, '360 s'])),
          flow.set(SERVER, ALLOCATION, allocationTable(tls, '360 s')),
        )
      } else {
        channelBind(TX.channelBind2)
        flow.emit(
          flow.set(
            SERVER,
            PERMISSIONS,
            permissions(['10.0.0.20', '60 s'], ['192.0.2.77', '300 s']),
          ),
          flow.set(SERVER, CHANNELS, channels(['0x4000', peerAtRelay, '600 s'])),
          flow.set(SERVER, ALLOCATION, allocationTable(tls, '360 s')),
        )
      }
    },
  )
  flow.step(
    {
      id: 'refresh',
      section: KEEP,
      title: { en: 'Refresh keeps the allocation', ja: 'Refresh で割り当てを保つ' },
      description: {
        en: 'PC A sends Refresh with LIFETIME 600, and the allocation is good for another 600 seconds. Refresh extends only the allocation, not its permissions or channels.',
        ja: 'PC A は LIFETIME 600 の Refresh を送り、割り当ては 600 秒延びる。Refresh が延ばすのは割り当てだけで、許可やチャネルは延ばさない。',
      },
    },
    () => {
      flow.aToServer(
        'refresh',
        'Refresh (LIFETIME 600)',
        stunFields({
          type: messageType(0x004, 'request'),
          typeName: 'Refresh Request',
          transactionId: TX.refresh,
          attributes: [
            { name: 'LIFETIME', value: '600 (seconds)', length: 4, highlight: true },
            ...CREDENTIALS,
          ],
        }),
      )
      flow.serverToA(
        'refresh',
        'Refresh Success',
        stunFields({
          type: messageType(0x004, 'success'),
          typeName: 'Refresh Success Response',
          transactionId: TX.refresh,
          attributes: [{ name: 'LIFETIME', value: '600', length: 4 }, INTEGRITY_SHA256],
        }),
      )
      flow.emit(flow.set(SERVER, ALLOCATION, allocationTable(tls, '600 s')))
    },
  )

  if (!permissionExpires) return
  flow.step(
    {
      id: 'permission-expired',
      section: KEEP,
      title: { en: 'The permission expires', ja: '許可の期限が切れる' },
      description: {
        en: 'Another minute later, 300 seconds after the last CreatePermission, the permissions expire. The allocation and the channel are still there; only the permission for PC B’s IP address is gone.',
        ja: 'さらに 1 分後、最後の CreatePermission から 300 秒たって、許可の期限が切れる。割り当てもチャネルも残っているが、PC B の IP アドレスの許可だけがない。',
      },
    },
    () => {
      flow.timer(SERVER, 'Permission timer', PERMISSION_LEFT_MS)
      flow.emit(
        flow.set(SERVER, PERMISSIONS, permissions()),
        flow.set(SERVER, CHANNELS, channels(['0x4000', peerAtRelay, '300 s'])),
        flow.set(SERVER, ALLOCATION, allocationTable(tls, '540 s')),
      )
    },
  )
  flow.step(
    {
      id: 'dropped',
      section: KEEP,
      title: { en: 'PC B’s media is dropped', ja: 'PC B のメディアが捨てられる' },
      description: {
        en: 'PC B keeps sending media to the relayed address, and the server silently discards it: there is no permission for 192.0.2.77. Without anything coming back, consent expires after 30 seconds and the call breaks. Permissions must be refreshed more often than channels and allocations.',
        ja: 'PC B は中継のアドレスにメディアを送り続けるが、サーバーは黙って捨てる。192.0.2.77 の許可がないから。何も返らないので、30 秒で consent が切れ、通話は途切れる。許可は、チャネルや割り当てより頻繁に更新しなければならない。',
      },
    },
    () => {
      flow.bToServer(
        'dropped',
        'SRTP (media)',
        innerFields(`SRTP (${String(srtpBytes)} bytes)`),
        ADDRESSES.relay,
        'rejected',
      )
    },
  )
}

function buildSteps(options: NatTraversalOptions): readonly Step[] {
  const flow = new Flow(options.network)
  gather(flow)
  if (options.network === 'independent') direct(flow)
  else relayed(flow, options.permissionExpires)
  return flow.steps
}

export const natTraversalScenario: Scenario<NatTraversalOptions> = {
  id: 'nat-traversal',
  title: { en: 'NAT traversal: STUN, TURN and ICE', ja: 'NAT 越え: STUN・TURN・ICE' },
  actors,
  optionDefs: {
    network: {
      kind: 'select',
      label: { en: 'The networks', ja: 'ネットワーク' },
      choices: [
        {
          value: 'independent',
          label: {
            en: 'Both NATs: endpoint-independent mapping',
            ja: 'どちらの NAT も宛先によらない対応づけ',
          },
        },
        {
          value: 'symmetric',
          label: {
            en: 'NAT B: address- and port-dependent mapping (a “symmetric” NAT)',
            ja: 'NAT B が宛先のアドレスとポートごとの対応づけ（いわゆるシンメトリック NAT）',
          },
        },
        {
          value: 'udpBlocked',
          label: { en: 'PC A’s network blocks UDP', ja: 'PC A の網が UDP を止める' },
        },
      ],
      defaultValue: 'independent',
    },
    permissionExpires: {
      kind: 'toggle',
      label: {
        en: 'PC A forgets to refresh the TURN permission',
        ja: 'PC A が TURN の許可の更新を忘れる',
      },
      description: {
        en: 'Has an effect only when the data goes through the TURN server.',
        ja: 'データが TURN のサーバーを通るときだけ影響する。',
      },
      defaultValue: false,
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
