/**
 * Wi-Fi: 無線 LAN につながる
 *
 * 根拠（IEEE の規格は RFC のように本文へ直接リンクできないので、規格名・年・節の題名で引く。節の番号は 802.11-2016 / 2020 と同じ並び）:
 * - IEEE Std 802.11-2024
 *   - clause 4 "General description": BSS、ESS、DS（ディストリビューションシステム）、IBSS（AP のない独立した BSS）
 *   - clause 9 "Frame formats": 9.2.4.1 "Frame Control field"（To DS / From DS、Retry、Protected Frame）、9.2.4.2 "Duration/ID field"、
 *     9.2.4.3 "Address fields"（IBSS の BSSID は I/G ビット 0、U/L ビット 1、残り 46 ビットは乱数）、9.2.4.4 "Sequence Control field"、
 *     9.3.1 の RTS・CTS・Ack、9.3.2 "Data frames"（To DS / From DS ごとのアドレスの中身）、9.3.3 の Beacon、Probe Request / Response、
 *     Authentication、Association Request / Response、Deauthentication、9.4.1 の Authentication Algorithm Number（0 は Open System）、
 *     Capability Information（ESS、IBSS、Privacy）、Reason Code（15 は 4-Way Handshake timeout）、AID、Status Code、
 *     9.4.2 の SSID 要素（長さ 0 はワイルドカード）と RSNE
 *   - clause 10 "MAC sublayer functional description": 10.3 "DCF"（キャリアセンス、DIFS、ランダムなバックオフ、SIFS 後の Ack、再送、
 *     NAV による仮想キャリアセンス、RTS/CTS、重複の検出）
 *   - clause 11 "MLME": 11.1 "Synchronization"（IBSS ではすべての STA がビーコンを送る。各ビーコン時刻にランダムに待ち、
 *     先に届いたら自分の分を取りやめる。受け取った TSF が自分より進んでいれば合わせる）、11.1.4 のパッシブ・アクティブスキャン、
 *     11.3 の状態（State 1〜4。IBSS の STA どうしのデータフレームは Class 1 で、認証もアソシエーションもいらない）
 *   - clause 12 "Security": 12.3.3.2 "Open System authentication"（誰でも受け入れる）、12.7.1 の鍵の階層（PMK から PRF-384 で
 *     PTK = KCK‖KEK‖TK。WPA2-Personal では PMK は PSK）、12.7.2 "EAPOL-Key frames"、12.7.6 "4-way handshake"
 *     （メッセージ 1 は MIC なし。メッセージ 2 の MIC が正しくなければ AP は黙って捨てる。メッセージ 3 の Key Data は KEK で包んだ GTK。
 *     STA はメッセージ 4 を送ってから PTK を入れる）
 *   - Annex J.4 "Suggested pass-phrase-to-PSK mapping": PSK = PBKDF2(HMAC-SHA1, パスフレーズ, SSID, 4096, 256 ビット)
 *     （テストでは付属のテストベクタも再現する）
 * - RFC 8018 §5.2（PBKDF2）、RFC 3394（AES Key Wrap）
 * - RFC 9542 §2.1.4（説明用の MAC アドレス 00-00-5E-00-53-00〜FF）、§2.1.1（ローカルに管理されたアドレス）
 * - 触れるだけ: Wi-Fi Alliance の WPA3 の仕様（SAE、PMF の必須化）、Wi-Fi Direct、IEEE 802.11s（メッシュ）、
 *   KRACK（Vanhoef, Piessens, "Key Reinstallation Attacks", ACM CCS 2017）
 *
 * 学習用の単純化: 5 GHz の 1 つのチャネル（36）。PHY は 802.11a と同じ non-HT の OFDM で、ユニキャストと制御フレームは 24 Mb/s
 * （基本レートは 6、12、24 Mb/s）。メディアアクセスは DCF（DIFS、QoS なしのデータフレーム）。実際の 802.11n/ac/ax の機器は
 * EDCA の AIFS（ベストエフォートなら 43 µs）を使い、ヘッダーに QoS Control がある（概要で触れる）。
 * 管理フレームと EAPOL のフレームにも Ack が返るが、図が込み入るので Ack はデータの区間からだけ描く。
 * パワーセーブ、DTIM、フラグメンテーション、A-MPDU は扱わない。ノンスは値を省き、シーケンス番号と PN は例の値。
 * MIC は大きさだけ示す。IBSS は暗号化なし。隠れ端末の上りの宛先は有線 LAN のルーター（図には描かない）。
 * RTS/CTS の場合はすべてのデータフレームの前に RTS を送る（RTS threshold 0）。パスフレーズを誤った場合、
 * AP はメッセージ 1 を 1 回だけ送り直してから切る。タイマーは使わない（µs の値はフィールドと状態で示す）
 */
import { z } from 'zod'
import type {
  Actor,
  ActorId,
  Message,
  MessageId,
  MessageStatus,
  PacketField,
  Scenario,
  StateKey,
  StateTable,
  Step,
  StepEvent,
} from '@/engine/types'
import type { LocalizedText } from '@/lib/i18n/locale'
import {
  ACK_BYTES,
  CTS_BYTES,
  CW_MIN,
  DIFS_US,
  RTS_BYTES,
  SIFS_US,
  SLOT_US,
  TU_US,
  ctsDurationUs,
  dataDurationUs,
  dataMpduBytes,
  nextCw,
  ofdmTxTimeUs,
  rtsDurationUs,
  type OfdmRate,
} from './airtime'
import { HANDSHAKE_KEY_INFO, hex16 } from './eapol'
import {
  addressFields,
  frameControl,
  hex,
  type DsDirection,
  type FrameFlags,
  type FrameKind,
} from './frame'

const SITUATIONS = [
  'normal',
  'wrongPassphrase',
  'lostAck',
  'hiddenNode',
  'rtsCts',
  'adhoc',
] as const
type Situation = (typeof SITUATIONS)[number]

const optionsSchema = z.object({
  situation: z.enum(SITUATIONS).catch('normal'),
})
export type WifiOptions = z.infer<typeof optionsSchema>

const STA_A: ActorId = 'staA'
const AP: ActorId = 'ap'
const STA_B: ActorId = 'staB'
const HEARS: StateKey = 'hears'
const STATE: StateKey = 'state'
const PORT: StateKey = 'port'
const SCAN: StateKey = 'scan'
const KEYS: StateKey = 'keys'
const MEDIUM: StateKey = 'medium'
const BSS: StateKey = 'bss'
const STATIONS: StateKey = 'stations'
const LAST_FRAME: StateKey = 'lastFrame'
export const SCAN_COLUMNS = ['SSID', 'BSSID', 'Security', 'Via'] as const
export const KEY_COLUMNS = ['Key', 'Bits', 'Value'] as const
export const STATION_COLUMNS = ['MAC', 'State', 'AID'] as const

export const SSID = 'example-wifi'
export const IBSS_SSID = 'example-adhoc'
export const CHANNEL = 36
export const PASSPHRASE = 'correct horse battery'
/** PBKDF2(HMAC-SHA1, PASSPHRASE, SSID, 4096, 256 ビット)。テストで WebCrypto と照らし合わせる */
export const PMK = '03b3b3d9d03517e64bc39eaaf7cd5a5a3b9519346db4dfcfe657af8fde0f2b2e'
/** 最後の 1 文字を打ち間違えたパスフレーズ */
export const WRONG_PASSPHRASE = 'correct horse batterx'
export const WRONG_PMK = '226c7faaea3849246d7be688de10df698d811b24a2786e764b955b21ce2f03c3'

/** 説明用の MAC アドレス（RFC 9542 §2.1.4）。AP の MAC アドレスがそのまま BSSID になる */
export const MAC = {
  ap: '00:00:5e:00:53:01',
  staA: '00:00:5e:00:53:0a',
  staB: '00:00:5e:00:53:0b',
  router: '00:00:5e:00:53:fe',
} as const
/** IBSS の BSSID の例（I/G 0、U/L 1、残りは乱数） */
export const IBSS_BSSID = 'a2:4f:21:9c:0e:3b'
const BROADCAST = 'ff:ff:ff:ff:ff:ff'

export const RATE: OfdmRate = 24
/** 送る IP パケットの大きさ（バイト） */
export const IP_BYTES = 100
export const PROTECTED_MPDU_BYTES = dataMpduBytes(IP_BYTES, true)
export const OPEN_MPDU_BYTES = dataMpduBytes(IP_BYTES, false)
export const DATA_DURATION_US = dataDurationUs(RATE)
export const RTS_DURATION_US = rtsDurationUs(PROTECTED_MPDU_BYTES, RATE)
export const CTS_DURATION_US = ctsDurationUs(RTS_DURATION_US, RATE)
const DATA_AIRTIME_US = ofdmTxTimeUs(PROTECTED_MPDU_BYTES, RATE)
const OPEN_AIRTIME_US = ofdmTxTimeUs(OPEN_MPDU_BYTES, RATE)
const ACK_AIRTIME_US = ofdmTxTimeUs(ACK_BYTES, RATE)
const RTS_AIRTIME_US = ofdmTxTimeUs(RTS_BYTES, RATE)
const CTS_AIRTIME_US = ofdmTxTimeUs(CTS_BYTES, RATE)
const RETRY_CW = nextCw(CW_MIN)

const shortKey = (key: string) => `${key.slice(0, 8)}…${key.slice(-6)}`
const us = (value: number) => `${String(value)} µs`
const backoff = (slots: number, cw: number) =>
  `DIFS ${us(DIFS_US)} + ${String(slots)} × ${us(SLOT_US)} (CW ${String(cw)})`

const STATE_1 = 'State 1 (unauthenticated)'
const STATE_2 = 'State 2 (authenticated)'
const STATE_3 = 'State 3 (associated)'
const STATE_4 = 'State 4 (RSNA established)'

const hearsSlot = {
  key: HEARS,
  label: { en: 'In radio range', ja: '電波が届く相手' },
  initial: '-',
}
const mediumSlot = {
  key: MEDIUM,
  label: { en: 'Medium access', ja: '送信の順番待ち' },
  initial: '-',
}
const lastFrameSlot = {
  key: LAST_FRAME,
  label: { en: 'Last frame received', ja: '最後に受けたフレーム' },
  initial: '-',
}
const stateSlot = {
  key: STATE,
  label: { en: '802.11 state', ja: '802.11 の状態' },
  initial: '-',
}
const keysSlot = {
  key: KEYS,
  label: { en: 'Keys', ja: '鍵' },
  initial: { columns: KEY_COLUMNS, rows: [] },
}

const actors: readonly Actor[] = [
  {
    id: STA_A,
    kind: 'client',
    name: { en: 'Laptop (STA A)', ja: 'ノート PC（STA A）' },
    shortName: { en: 'STA A', ja: 'STA A' },
    stateSlots: [
      hearsSlot,
      stateSlot,
      { key: PORT, label: { en: '802.1X port', ja: '802.1X のポート' }, initial: '-' },
      {
        key: SCAN,
        label: { en: 'Scan results', ja: 'スキャンの結果' },
        initial: { columns: SCAN_COLUMNS, rows: [] },
      },
      keysSlot,
      mediumSlot,
      lastFrameSlot,
    ],
  },
  {
    id: AP,
    // AP は無線と有線（DS）の間でフレームを中継する L2 の機器なので、スイッチの色で描く
    kind: 'switch',
    name: { en: 'Access point (AP)', ja: 'アクセスポイント（AP）' },
    shortName: { en: 'AP', ja: 'AP' },
    stateSlots: [
      hearsSlot,
      { key: BSS, label: { en: 'BSS', ja: 'BSS' }, initial: '-' },
      {
        key: STATIONS,
        label: { en: 'Associated stations', ja: 'アソシエーション中の端末' },
        initial: { columns: STATION_COLUMNS, rows: [] },
      },
      keysSlot,
      mediumSlot,
      lastFrameSlot,
    ],
  },
  {
    id: STA_B,
    kind: 'client',
    name: { en: 'Phone (STA B)', ja: 'スマートフォン（STA B）' },
    shortName: { en: 'STA B', ja: 'STA B' },
    stateSlots: [hearsSlot, stateSlot, mediumSlot, lastFrameSlot],
  },
]

const set = (actorId: ActorId, key: StateKey, value: string | StateTable): StepEvent => ({
  kind: 'stateChange',
  actorId,
  key,
  value,
})
const send = (message: Message): StepEvent => ({ kind: 'message', message })

const FRAME_NAMES: Record<FrameKind, string> = {
  associationRequest: 'Association Request',
  associationResponse: 'Association Response',
  probeRequest: 'Probe Request',
  probeResponse: 'Probe Response',
  beacon: 'Beacon',
  authentication: 'Authentication',
  deauthentication: 'Deauthentication',
  rts: 'RTS',
  cts: 'CTS',
  ack: 'Ack',
  data: 'Data',
}

function frameControlSummary(kind: FrameKind, flags: FrameFlags): string {
  const bits = [
    flags.toDs === true ? 'ToDS=1' : null,
    flags.fromDs === true ? 'FromDS=1' : null,
    flags.retry === true ? 'Retry=1' : null,
    flags.protected === true ? 'Protected=1' : null,
  ].filter((bit) => bit !== null)
  return [FRAME_NAMES[kind], ...bits].join(', ')
}

const FIELD_TEXT = {
  frameControl: {
    en: 'Type and subtype of the frame, and flags such as ToDS / FromDS, Retry and Protected',
    ja: 'フレームの種類（タイプとサブタイプ）と、ToDS / FromDS、Retry、Protected などのフラグ',
  },
  duration: {
    en: 'How long the medium stays reserved after this frame. Other stations that hear it set their NAV to this value, if it is longer than their current NAV',
    ja: 'このフレームのあと、媒体を予約しておく時間。聞こえたほかの STA は、今の NAV より長ければ NAV をこの値にする',
  },
  address1: {
    en: 'Address 1 is always the receiver on this hop (RA)',
    ja: 'Address 1 は常に、この 1 区間の受信者（RA）',
  },
  sequence: {
    en: 'Numbered by the sender. A retransmission keeps the number, so the receiver can spot duplicates',
    ja: '送信者が付ける番号。再送でも同じ番号なので、受信者は重複に気づける',
  },
  airtime: {
    en: `Not a header field: how long the frame is on the air at ${String(RATE)} Mb/s (preamble included)`,
    ja: `ヘッダーのフィールドではない。${String(RATE)} Mb/s でフレームを送るのにかかる時間（プリアンブルを含む）`,
  },
  rsne: {
    en: 'RSN element: which ciphers and key management (AKM) the network supports',
    ja: 'RSN 要素。ネットワークが使える暗号と鍵の管理方式（AKM）',
  },
  keyInfo: {
    en: 'Bits that say which message of the handshake this is and what to do with it',
    ja: 'ハンドシェイクの何番目のメッセージか、受け手が何をすべきかを表すビット',
  },
  replay: {
    en: 'Increased by the AP for every new message; the station echoes it. Protects against replayed messages',
    ja: 'AP が新しいメッセージごとに増やし、STA は同じ値を返す。古いメッセージの使い回しを防ぐ',
  },
  mic: {
    en: 'Message integrity code computed with the KCK. Only someone who knows the PMK can compute it',
    ja: 'KCK で計算するメッセージ認証コード。PMK を知っている者にしか計算できない',
  },
} satisfies Record<string, LocalizedText>

interface FrameSpec {
  readonly id: MessageId
  readonly from: ActorId
  readonly to: ActorId
  readonly label: string
  readonly kind: FrameKind
  readonly flags?: FrameFlags
  readonly fields: readonly PacketField[]
  readonly status?: MessageStatus
  readonly retransmitOf?: MessageId
  readonly encrypted?: boolean
}

function frame(spec: FrameSpec): Message {
  const flags = spec.flags ?? {}
  return {
    id: spec.id,
    from: spec.from,
    to: spec.to,
    label: spec.label,
    status: spec.status ?? 'delivered',
    fields: [
      {
        name: 'Frame Control',
        value: `${hex(frameControl(spec.kind, flags))} (${frameControlSummary(spec.kind, flags)})`,
        description: FIELD_TEXT.frameControl,
      },
      ...spec.fields,
    ],
    ...(spec.retransmitOf === undefined ? {} : { retransmitOf: spec.retransmitOf }),
    ...(spec.encrypted === true ? { encrypted: true } : {}),
  }
}

interface Roles {
  readonly da: string
  readonly sa: string
  readonly bssid: string
}

function addresses(direction: DsDirection, roles: Roles): PacketField[] {
  return addressFields(direction, roles).map((field, index) =>
    index === 0 ? { ...field, description: FIELD_TEXT.address1 } : field,
  )
}

const RSNE_WPA2 = 'v1, group CCMP-128, pairwise CCMP-128, AKM 00-0F-AC:2 (PSK)'
const RSNE_CHOSEN = 'v1, pairwise CCMP-128, AKM 00-0F-AC:2 (PSK)'
const RATES = '6(B) 9 12(B) 18 24(B) 36 48 54 Mb/s'

const SECTIONS = {
  find: { en: 'Finding the network', ja: 'ネットワークを見つける' },
  join: { en: 'Authentication and association', ja: '認証とアソシエーション' },
  handshake: { en: '4-way handshake', ja: '4 ウェイハンドシェイク' },
  data: { en: 'Sending data', ja: 'データを送る' },
  ibss: { en: 'Starting an IBSS', ja: 'IBSS を始める' },
} satisfies Record<string, LocalizedText>

const inSection = (section: LocalizedText, steps: readonly Omit<Step, 'section'>[]): Step[] =>
  steps.map((step) => ({ ...step, section }))

const keyTable = (rows: readonly (readonly [string, number, string])[]): StateTable => ({
  columns: KEY_COLUMNS,
  rows: rows.map(([key, bits, value]) => [key, String(bits), value]),
})

const stationTable = (rows: readonly (readonly [string, string, number])[]): StateTable => ({
  columns: STATION_COLUMNS,
  rows: rows.map(([mac, state, aid]) => [mac, state, String(aid)]),
})

const scanTable = (via: string): StateTable => ({
  columns: SCAN_COLUMNS,
  rows: [[SSID, MAC.ap, 'WPA2-PSK (CCMP-128)', via]],
})

const AP_KEYS_BASE: [string, number, string][] = [
  ['PMK', 256, shortKey(PMK)],
  ['PTK (STA B)', 384, 'installed'],
  ['GTK', 128, 'installed'],
]
const STATION_B: [string, string, number] = [MAC.staB, 'State 4', 1]

/** 1 つのデータフレームの、Frame Control の後ろのフィールド */
interface DataSpec {
  readonly direction: DsDirection
  readonly roles: Roles
  readonly sequence: number
  /** CCMP で保護するなら PN と、どの STA の TK で暗号化したか */
  readonly ccmp: { readonly pn: number; readonly tkOf: string } | null
}

function dataFields(spec: DataSpec): PacketField[] {
  const bytes = spec.ccmp === null ? OPEN_MPDU_BYTES : PROTECTED_MPDU_BYTES
  return [
    {
      name: 'Duration',
      value: `${us(DATA_DURATION_US)} (SIFS + Ack)`,
      description: FIELD_TEXT.duration,
    },
    ...addresses(spec.direction, spec.roles),
    {
      name: 'Sequence Number',
      value: String(spec.sequence),
      description: FIELD_TEXT.sequence,
    },
    ...(spec.ccmp === null
      ? []
      : [{ name: 'CCMP PN', value: String(spec.ccmp.pn) } satisfies PacketField]),
    { name: 'LLC/SNAP EtherType', value: '0x0800 (IPv4)' },
    {
      name: 'Payload',
      value:
        spec.ccmp === null
          ? `IPv4, ${String(IP_BYTES)} bytes (not encrypted)`
          : `IPv4, ${String(IP_BYTES)} bytes (TK of ${spec.ccmp.tkOf})`,
    },
    { name: 'MPDU length', value: `${String(bytes)} bytes` },
    {
      name: 'Airtime',
      value: us(spec.ccmp === null ? OPEN_AIRTIME_US : DATA_AIRTIME_US),
      description: FIELD_TEXT.airtime,
    },
  ]
}

function ack(id: MessageId, from: ActorId, to: ActorId, ra: string, status?: MessageStatus) {
  return frame({
    id,
    from,
    to,
    label: 'Ack',
    kind: 'ack',
    ...(status === undefined ? {} : { status }),
    fields: [
      { name: 'Duration', value: '0 µs', description: FIELD_TEXT.duration },
      { name: 'Address 1 (RA)', value: ra, description: FIELD_TEXT.address1 },
      { name: 'Airtime', value: us(ACK_AIRTIME_US), description: FIELD_TEXT.airtime },
    ],
  })
}

// ---------- インフラストラクチャモード ----------

function discovery(hidden: boolean, wrongPassphrase: boolean): Step[] {
  const beaconFields: PacketField[] = [
    ...addresses('none', { da: BROADCAST, sa: MAC.ap, bssid: MAC.ap }),
    { name: 'Timestamp', value: 'TSF of the AP (64-bit µs counter)' },
    {
      name: 'Beacon Interval',
      value: `100 TU (${String((100 * TU_US) / 1000)} ms)`,
    },
    { name: 'Capability', value: 'ESS=1, IBSS=0, Privacy=1', highlight: true },
    { name: 'SSID', value: SSID, highlight: true },
    { name: 'Supported Rates', value: RATES },
    { name: 'TIM', value: 'DTIM Count 0, DTIM Period 1' },
    { name: 'RSNE', value: RSNE_WPA2, description: FIELD_TEXT.rsne },
  ]
  const probeFields: PacketField[] = [
    ...addresses('none', { da: BROADCAST, sa: MAC.staA, bssid: BROADCAST }),
    { name: 'SSID', value: '(wildcard, length 0)', highlight: true },
    { name: 'Supported Rates', value: RATES },
  ]
  const probeRequest = (id: MessageId, to: ActorId, status: MessageStatus) =>
    frame({
      id,
      from: STA_A,
      to,
      label: 'Probe Request (wildcard SSID)',
      kind: 'probeRequest',
      status,
      fields: probeFields,
    })
  return [
    ...inSection(SECTIONS.find, [
      {
        id: 'setup',
        title: {
          en: 'A laptop arrives at a Wi-Fi network',
          ja: 'ノート PC が Wi-Fi のネットワークに来る',
        },
        description: {
          en: `The access point runs a BSS called ${SSID} on 5 GHz channel ${String(CHANNEL)}, protected with WPA2-Personal. The phone (STA B) has already joined and has association ID 1. The laptop (STA A) knows the SSID and the passphrase, but is not part of the network yet (State 1). ${hidden ? 'The laptop and the phone are on opposite sides of the AP: each can hear the AP, but not the other.' : 'All three are close enough to hear each other.'}${wrongPassphrase ? ' This time the user mistypes the last letter of the passphrase.' : ''}`,
          ja: `アクセスポイントは 5 GHz のチャネル ${String(CHANNEL)} で ${SSID} という BSS を運用し、WPA2-Personal で保護している。スマートフォン（STA B）はすでに参加していて、アソシエーション ID は 1。ノート PC（STA A）は SSID とパスフレーズを知っているが、まだネットワークに入っていない（State 1）。${hidden ? 'ノート PC とスマートフォンは AP を挟んで反対側にいて、どちらも AP の電波は届くが、互いの電波は届かない。' : '3 台とも、互いの電波が届く距離にいる。'}${wrongPassphrase ? '今回、利用者はパスフレーズの最後の 1 文字を打ち間違える。' : ''}`,
        },
        events: [
          set(STA_A, HEARS, hidden ? 'AP' : 'AP, STA B'),
          set(AP, HEARS, 'STA A, STA B'),
          set(STA_B, HEARS, hidden ? 'AP' : 'AP, STA A'),
          set(STA_A, STATE, STATE_1),
          set(AP, BSS, `${SSID} (channel ${String(CHANNEL)}, WPA2-PSK)`),
          set(AP, STATIONS, stationTable([STATION_B])),
          set(AP, KEYS, keyTable(AP_KEYS_BASE)),
          set(STA_B, STATE, STATE_4),
        ],
      },
      {
        id: 'beacon',
        title: {
          en: 'The AP announces itself with a beacon',
          ja: 'AP がビーコンで自分を知らせる',
        },
        description: {
          en: 'About every 100 TU (102.4 ms), the AP broadcasts a Beacon with the SSID, the BSSID (the AP’s own MAC address), its capabilities and an RSN element that says “WPA2: CCMP-128 with a pre-shared key”. It goes to the broadcast address, so nobody sends an Ack. Listening for beacons like this is passive scanning: the laptop adds the network to its scan results. The phone, already a member, uses the timestamp to keep its clock in step with the AP.',
          ja: 'AP はおよそ 100 TU（102.4 ms）ごとに Beacon をブロードキャストする。中身は SSID、BSSID（AP 自身の MAC アドレス）、機能、そして「WPA2、CCMP-128、事前共有鍵」を表す RSN 要素。宛先はブロードキャストアドレスなので、誰も Ack を返さない。このようにビーコンを待ち受けるのがパッシブスキャンで、ノート PC はネットワークをスキャンの結果に加える。すでに参加しているスマートフォンは、タイムスタンプで時計を AP に合わせる。',
        },
        events: [
          send(
            frame({
              id: 'beacon-a',
              from: AP,
              to: STA_A,
              label: `Beacon (SSID ${SSID})`,
              kind: 'beacon',
              fields: beaconFields,
            }),
          ),
          send(
            frame({
              id: 'beacon-b',
              from: AP,
              to: STA_B,
              label: `Beacon (SSID ${SSID})`,
              kind: 'beacon',
              fields: beaconFields,
            }),
          ),
          set(STA_A, SCAN, scanTable('Beacon')),
          set(STA_B, LAST_FRAME, 'Beacon (TSF synced)'),
        ],
      },
      {
        id: 'probe',
        title: { en: 'The laptop asks who is there', ja: 'ノート PC が周りに問い合わせる' },
        description: {
          en: `Instead of waiting for beacons, a station can scan actively: it broadcasts a Probe Request with a wildcard SSID (length 0), which means “any network”. Only APs answer. ${hidden ? 'The phone is out of the laptop’s range and does not receive it.' : 'The phone receives it too but, as a station in a BSS, does not reply.'}`,
          ja: `ビーコンを待つ代わりに、アクティブにスキャンすることもできる。ワイルドカードの SSID（長さ 0）、つまり「どのネットワークでも」を入れた Probe Request をブロードキャストする。答えるのは AP だけ。${hidden ? 'スマートフォンはノート PC の電波が届かないので、受け取らない。' : 'スマートフォンも受け取るが、BSS の中の STA なので答えない。'}`,
        },
        events: [
          send(probeRequest('probe-ap', AP, 'delivered')),
          ...(hidden
            ? []
            : [
                send(probeRequest('probe-b', STA_B, 'rejected')),
                set(STA_B, LAST_FRAME, 'ignored (not an AP)'),
              ]),
        ],
      },
      {
        id: 'probe-response',
        title: {
          en: 'The AP answers with a Probe Response',
          ja: 'AP が Probe Response で答える',
        },
        description: {
          en: 'The Probe Response goes only to the laptop and carries almost the same information as a beacon. Unlike a beacon, it is a unicast frame, so the laptop acknowledges it with an Ack after SIFS. Every unicast management frame is acknowledged this way; to keep the diagram readable, Acks are drawn only in the data section.',
          ja: 'Probe Response はノート PC だけに送られ、ビーコンとほぼ同じ情報を持つ。ビーコンと違ってユニキャストのフレームなので、ノート PC は SIFS のあとに Ack を返す。ユニキャストの管理フレームにはすべてこうして Ack が返るが、図を読みやすくするため、Ack はデータの区間でだけ描く。',
        },
        events: [
          send(
            frame({
              id: 'probe-response',
              from: AP,
              to: STA_A,
              label: `Probe Response (${SSID})`,
              kind: 'probeResponse',
              fields: [
                ...addresses('none', { da: MAC.staA, sa: MAC.ap, bssid: MAC.ap }),
                { name: 'Capability', value: 'ESS=1, IBSS=0, Privacy=1' },
                { name: 'SSID', value: SSID },
                { name: 'Supported Rates', value: RATES },
                { name: 'RSNE', value: RSNE_WPA2, description: FIELD_TEXT.rsne },
              ],
            }),
          ),
          set(STA_A, SCAN, scanTable('Beacon, Probe Response')),
        ],
      },
    ]),
    ...inSection(SECTIONS.join, [
      {
        id: 'auth-request',
        title: {
          en: 'Open System authentication: the request',
          ja: 'Open System 認証の要求',
        },
        description: {
          en: 'Before it can associate, a station must authenticate. With Open System authentication, the laptop only states who it is: its MAC address.',
          ja: 'アソシエーションの前に、STA は認証を受けなければならない。Open System 認証では、ノート PC は自分が誰か（MAC アドレス）を名乗るだけ。',
        },
        events: [
          send(
            frame({
              id: 'auth-request',
              from: STA_A,
              to: AP,
              label: 'Authentication (Open System, 1)',
              kind: 'authentication',
              fields: [
                ...addresses('none', { da: MAC.ap, sa: MAC.staA, bssid: MAC.ap }),
                { name: 'Authentication Algorithm', value: '0 (Open System)', highlight: true },
                { name: 'Authentication Transaction Sequence', value: '1' },
              ],
            }),
          ),
        ],
      },
      {
        id: 'auth-response',
        title: { en: 'The AP accepts, as always', ja: 'AP は、いつもどおり受け入れる' },
        description: {
          en: 'With Open System, the AP accepts everyone: no password, no proof. So this step is not security. It remains for historical reasons (the old WEP shared-key method used these frames), and the real check comes later, in the 4-way handshake. WPA3-Personal is different: its SAE exchange uses these same Authentication frames, with algorithm number 3.',
          ja: 'Open System では、AP は誰でも受け入れる。パスワードも証明もいらない。つまりこのステップはセキュリティではない。歴史的な理由で残っていて（古い WEP の共有鍵認証がこのフレームを使った）、本当の確認はあとの 4 ウェイハンドシェイクで行う。WPA3-Personal は違い、SAE のやり取りをこの Authentication フレームで行う（アルゴリズム番号 3）。',
        },
        events: [
          send(
            frame({
              id: 'auth-response',
              from: AP,
              to: STA_A,
              label: 'Authentication (Open System, 2)',
              kind: 'authentication',
              fields: [
                ...addresses('none', { da: MAC.staA, sa: MAC.ap, bssid: MAC.ap }),
                { name: 'Authentication Algorithm', value: '0 (Open System)' },
                { name: 'Authentication Transaction Sequence', value: '2' },
                { name: 'Status Code', value: '0 (success)', highlight: true },
              ],
            }),
          ),
          set(STA_A, STATE, STATE_2),
        ],
      },
      {
        id: 'assoc-request',
        title: { en: 'The laptop asks to join', ja: 'ノート PC が参加を求める' },
        description: {
          en: 'Now the laptop asks to become a member of the BSS. It repeats the SSID and says which of the offered security options it chose: CCMP-128 with a pre-shared key.',
          ja: '次にノート PC は BSS のメンバーになることを求める。SSID をもう一度示し、示されたセキュリティの方式のうちどれを選んだか（CCMP-128 と事前共有鍵）を伝える。',
        },
        events: [
          send(
            frame({
              id: 'assoc-request',
              from: STA_A,
              to: AP,
              label: `Association Request (${SSID})`,
              kind: 'associationRequest',
              fields: [
                ...addresses('none', { da: MAC.ap, sa: MAC.staA, bssid: MAC.ap }),
                { name: 'Capability', value: 'ESS=1, IBSS=0, Privacy=1' },
                { name: 'Listen Interval', value: '10 (beacon intervals)' },
                { name: 'SSID', value: SSID },
                { name: 'Supported Rates', value: RATES },
                {
                  name: 'RSNE',
                  value: RSNE_CHOSEN,
                  highlight: true,
                  description: FIELD_TEXT.rsne,
                },
              ],
            }),
          ),
        ],
      },
      {
        id: 'assoc-response',
        title: {
          en: 'Associated, but the port is still closed',
          ja: 'アソシエーションしたが、ポートはまだ閉じている',
        },
        description: {
          en: 'The AP records the laptop and gives it association ID (AID) 2; the phone has 1. The laptop is now associated (State 3), but its 802.1X port is still closed: until the 4-way handshake succeeds, only EAPOL frames may pass, and no IP packet.',
          ja: 'AP はノート PC を記録し、アソシエーション ID（AID）2 を割り当てる（スマートフォンは 1）。ノート PC はアソシエーションした（State 3）が、802.1X のポートはまだ閉じている。4 ウェイハンドシェイクが成功するまでは EAPOL のフレームしか通れず、IP パケットは通らない。',
        },
        events: [
          send(
            frame({
              id: 'assoc-response',
              from: AP,
              to: STA_A,
              label: 'Association Response (AID 2)',
              kind: 'associationResponse',
              fields: [
                ...addresses('none', { da: MAC.staA, sa: MAC.ap, bssid: MAC.ap }),
                { name: 'Capability', value: 'ESS=1, IBSS=0, Privacy=1' },
                { name: 'Status Code', value: '0 (success)' },
                { name: 'AID', value: '2', highlight: true },
                { name: 'Supported Rates', value: RATES },
              ],
            }),
          ),
          set(STA_A, STATE, STATE_3),
          set(STA_A, PORT, 'EAPOL only'),
          set(AP, STATIONS, stationTable([STATION_B, [MAC.staA, 'State 3', 2]])),
        ],
      },
    ]),
  ]
}

interface EapolSpec {
  readonly id: MessageId
  readonly number: 1 | 2 | 3 | 4
  readonly replayCounter: number
  readonly nonce: string
  readonly mic: string
  readonly keyData?: string
  readonly status?: MessageStatus
  readonly retransmitOf?: MessageId
}

function eapol(spec: EapolSpec): Message {
  const fromAp = spec.number === 1 || spec.number === 3
  const labels = {
    1: 'EAPOL-Key 1/4 (ANonce)',
    2: 'EAPOL-Key 2/4 (SNonce, MIC)',
    3: 'EAPOL-Key 3/4 (Install, GTK)',
    4: 'EAPOL-Key 4/4 (MIC)',
  } as const
  const bitNames = {
    1: 'Pairwise, Key Ack',
    2: 'Pairwise, Key MIC',
    3: 'Pairwise, Install, Key Ack, Key MIC, Secure, Encrypted Key Data',
    4: 'Pairwise, Key MIC, Secure',
  } as const
  return frame({
    id: spec.id,
    from: fromAp ? AP : STA_A,
    to: fromAp ? STA_A : AP,
    label: labels[spec.number],
    kind: 'data',
    flags: fromAp ? { fromDs: true } : { toDs: true },
    ...(spec.status === undefined ? {} : { status: spec.status }),
    ...(spec.retransmitOf === undefined ? {} : { retransmitOf: spec.retransmitOf }),
    fields: [
      ...(fromAp
        ? addresses('fromDs', { da: MAC.staA, sa: MAC.ap, bssid: MAC.ap })
        : addresses('toDs', { da: MAC.ap, sa: MAC.staA, bssid: MAC.ap })),
      { name: 'LLC/SNAP EtherType', value: '0x888e (EAPOL)' },
      { name: 'Descriptor Type', value: '2 (RSN)' },
      {
        name: 'Key Information',
        value: `${hex16(HANDSHAKE_KEY_INFO[spec.number])} (${bitNames[spec.number]})`,
        highlight: true,
        description: FIELD_TEXT.keyInfo,
      },
      {
        name: 'Key Replay Counter',
        value: String(spec.replayCounter),
        description: FIELD_TEXT.replay,
      },
      { name: 'Key Nonce', value: spec.nonce },
      { name: 'Key MIC', value: spec.mic, description: FIELD_TEXT.mic },
      ...(spec.keyData === undefined ? [] : [{ name: 'Key Data', value: spec.keyData }]),
    ],
  })
}

const MIC_VALUE = '16 bytes (HMAC-SHA1-128, KCK)'
const ANONCE = 'ANonce (32 random bytes)'
const SNONCE = 'SNonce (32 random bytes)'
const DERIVED_KEYS: [string, number, string][] = [
  ['KCK', 128, 'derived'],
  ['KEK', 128, 'derived'],
  ['TK', 128, 'derived'],
]

function pmkStep(wrongPassphrase: boolean): Omit<Step, 'section'> {
  return {
    id: 'pmk',
    title: { en: 'Both sides compute the PMK', ja: '両者が PMK を計算する' },
    description: wrongPassphrase
      ? {
          en: 'With WPA2-Personal, the pairwise master key (PMK) is derived from the passphrase: PBKDF2 with HMAC-SHA1, the SSID as the salt, 4,096 iterations, 256 bits. Because of the typo (“batterx”), the laptop’s PMK is completely different from the AP’s. Nothing shows it yet: neither the passphrase nor the PMK is ever sent over the air.',
          ja: 'WPA2-Personal では、ペアワイズマスター鍵（PMK）をパスフレーズから導く。HMAC-SHA1 を使う PBKDF2 で、ソルトは SSID、4,096 回、256 ビット。打ち間違い（「batterx」）のせいで、ノート PC の PMK は AP のものとまったく違う。それはまだどこにも表れない。パスフレーズも PMK も、電波で送ることはないから。',
        }
      : {
          en: 'With WPA2-Personal, the pairwise master key (PMK) is derived from the passphrase: PBKDF2 with HMAC-SHA1, the SSID as the salt, 4,096 iterations, 256 bits. The laptop computes it from the passphrase the user typed; the AP has it from its configuration. Neither the passphrase nor the PMK is ever sent over the air.',
          ja: 'WPA2-Personal では、ペアワイズマスター鍵（PMK）をパスフレーズから導く。HMAC-SHA1 を使う PBKDF2 で、ソルトは SSID、4,096 回、256 ビット。ノート PC は利用者が入力したパスフレーズから計算し、AP は設定から持っている。パスフレーズも PMK も、電波で送ることはない。',
        },
    events: [
      set(STA_A, KEYS, keyTable([['PMK', 256, shortKey(wrongPassphrase ? WRONG_PMK : PMK)]])),
    ],
  }
}

const message1Step = (wrongPassphrase: boolean): Omit<Step, 'section'> => ({
  id: 'message-1',
  title: { en: 'Message 1: the AP’s nonce', ja: 'メッセージ 1: AP のノンス' },
  description: {
    en: `The AP sends a random number, the ANonce, in an EAPOL-Key frame (a data frame with EtherType 0x888e). Message 1 has no MIC: there is no key to compute one yet. The laptop picks its own random SNonce and derives the pairwise transient key (PTK) = PRF-384(PMK, "Pairwise key expansion", both MAC addresses, both nonces). The 384 bits are split into three 128-bit keys: the KCK (for MICs), the KEK (for wrapping keys) and the TK (for encrypting data).${wrongPassphrase ? ' Because the PMK is different, this PTK is different from the AP’s too.' : ''}`,
    ja: `AP は乱数の ANonce を EAPOL-Key フレーム（EtherType 0x888e のデータフレーム）で送る。メッセージ 1 には MIC がない。まだ計算に使う鍵がないから。ノート PC は自分の乱数 SNonce を選び、ペアワイズ一時鍵（PTK）= PRF-384(PMK, "Pairwise key expansion", 両者の MAC アドレス, 両者のノンス) を導く。384 ビットを 128 ビットずつ 3 つの鍵に分ける。KCK（MIC 用）、KEK（鍵を包む用）、TK（データの暗号化用）。${wrongPassphrase ? 'PMK が違うので、この PTK も AP のものとは違う。' : ''}`,
  },
  events: [
    send(
      eapol({ id: 'message-1', number: 1, replayCounter: 1, nonce: ANONCE, mic: '0 (no PTK yet)' }),
    ),
    set(
      STA_A,
      KEYS,
      keyTable([['PMK', 256, shortKey(wrongPassphrase ? WRONG_PMK : PMK)], ...DERIVED_KEYS]),
    ),
  ],
})

const message2 = (id: MessageId, replayCounter: number, status?: MessageStatus) =>
  eapol({
    id,
    number: 2,
    replayCounter,
    nonce: SNONCE,
    mic: MIC_VALUE,
    keyData: `RSNE (${RSNE_CHOSEN})`,
    ...(status === undefined ? {} : { status }),
  })

function handshake(): Omit<Step, 'section'>[] {
  return [
    pmkStep(false),
    message1Step(false),
    {
      id: 'message-2',
      title: {
        en: 'Message 2: the laptop proves it knows the PMK',
        ja: 'メッセージ 2: ノート PC が PMK を知っていると示す',
      },
      description: {
        en: 'The laptop sends its SNonce and a MIC over the message, computed with the KCK. Now the AP has both nonces too, derives the same PTK and recomputes the MIC. They match, so the laptop must know the PMK, and hence the passphrase: proven without sending it. The AP also checks that the RSN element matches the one in the Association Request.',
        ja: 'ノート PC は SNonce と、メッセージ全体に対する MIC（KCK で計算）を送る。これで AP も両方のノンスを持つので、同じ PTK を導いて MIC を計算し直す。一致したので、ノート PC は PMK を、つまりパスフレーズを知っているはず。送らずに証明できた。AP は RSN 要素が Association Request のものと同じことも確かめる。',
      },
      events: [
        send(message2('message-2', 1)),
        set(AP, KEYS, keyTable([...AP_KEYS_BASE, ['PTK (STA A)', 384, 'derived']])),
        set(AP, LAST_FRAME, 'MIC valid'),
      ],
    },
    {
      id: 'message-3',
      title: {
        en: 'Message 3: install the keys, here is the GTK',
        ja: 'メッセージ 3: 鍵を入れる指示と GTK',
      },
      description: {
        en: 'The AP sends the ANonce again, a MIC that proves to the laptop that the AP knows the PMK too, and the group temporal key (GTK) that the AP uses for broadcast and multicast. The frame itself is not encrypted, but its Key Data field is: the GTK is wrapped with the KEK (AES Key Wrap). The Install bit tells the laptop to install the PTK. The laptop checks that the RSN element matches the beacon’s, which detects a downgrade by an attacker.',
        ja: 'AP は、もう一度 ANonce を送るとともに、AP も PMK を知っていることをノート PC に示す MIC と、AP がブロードキャストとマルチキャストに使うグループ一時鍵（GTK）を送る。フレーム自体は暗号化されていないが、Key Data のフィールドは暗号化されている。GTK は KEK で包まれている（AES Key Wrap）。Install のビットは、PTK を入れるようノート PC に伝える。ノート PC は RSN 要素がビーコンのものと同じことを確かめ、攻撃者による格下げに気づけるようにする。',
      },
      events: [
        send(
          eapol({
            id: 'message-3',
            number: 3,
            replayCounter: 2,
            nonce: 'ANonce (same as message 1)',
            mic: MIC_VALUE,
            keyData: 'RSNE + GTK KDE (Key ID 1), wrapped with the KEK',
          }),
        ),
        set(
          STA_A,
          KEYS,
          keyTable([['PMK', 256, shortKey(PMK)], ...DERIVED_KEYS, ['GTK', 128, 'received']]),
        ),
      ],
    },
    {
      id: 'message-4',
      title: { en: 'Message 4: done, the port opens', ja: 'メッセージ 4: 完了、ポートが開く' },
      description: {
        en: 'The laptop confirms with message 4, then installs the PTK and the GTK. The AP installs the laptop’s PTK when message 4 arrives. Message 4 is sent before the keys are installed, so it is not encrypted. Both sides open the 802.1X port: the laptop is in State 4 and may send IP packets (in practice it would now ask for an address with DHCP).',
        ja: 'ノート PC はメッセージ 4 で確認を返し、そのあとで PTK と GTK を入れる。AP はメッセージ 4 を受け取ったときに、ノート PC の PTK を入れる。メッセージ 4 は鍵を入れる前に送るので、暗号化されていない。両者が 802.1X のポートを開く。ノート PC は State 4 になり、IP パケットを送れる（実際には、ここで DHCP でアドレスを求める）。',
      },
      events: [
        send(
          eapol({
            id: 'message-4',
            number: 4,
            replayCounter: 2,
            nonce: '0 (not used)',
            mic: MIC_VALUE,
          }),
        ),
        set(STA_A, STATE, STATE_4),
        set(STA_A, PORT, 'open'),
        set(
          STA_A,
          KEYS,
          keyTable([
            ['PMK', 256, shortKey(PMK)],
            ['KCK', 128, 'derived'],
            ['KEK', 128, 'derived'],
            ['TK', 128, 'installed'],
            ['GTK', 128, 'installed'],
          ]),
        ),
        set(AP, KEYS, keyTable([...AP_KEYS_BASE, ['PTK (STA A)', 384, 'installed']])),
        set(AP, STATIONS, stationTable([STATION_B, [MAC.staA, 'State 4', 2]])),
        set(AP, LAST_FRAME, 'EAPOL-Key 4/4 (MIC valid)'),
      ],
    },
  ]
}

function failedHandshake(): Omit<Step, 'section'>[] {
  return [
    pmkStep(true),
    message1Step(true),
    {
      id: 'message-2',
      title: {
        en: 'Message 2 has the wrong MIC',
        ja: 'メッセージ 2 の MIC が合わない',
      },
      description: {
        en: 'The laptop’s PMK is wrong, so its PTK, its KCK and its MIC are wrong too. The AP computes a different MIC and silently discards message 2. It does not say why, and it cannot: to the AP, a wrong MIC looks the same whether the passphrase was mistyped or someone is guessing.',
        ja: 'ノート PC の PMK が違うので、PTK も KCK も、そして MIC も違う。AP は違う MIC を計算し、メッセージ 2 を黙って捨てる。理由は伝えないし、伝えようがない。AP から見ると、打ち間違いでも誰かが推測していても、MIC が合わないことに変わりはない。',
      },
      events: [
        send(message2('message-2', 1, 'rejected')),
        set(AP, LAST_FRAME, 'MIC invalid (discarded)'),
      ],
    },
    {
      id: 'message-1-again',
      title: { en: 'The AP tries message 1 again', ja: 'AP がメッセージ 1 を送り直す' },
      description: {
        en: 'No valid message 2 arrived, so after a timeout the AP sends message 1 again, with a new replay counter (2) and the same ANonce. The laptop answers with the same wrong MIC, and the AP discards it again.',
        ja: '正しいメッセージ 2 が届かないので、AP はタイムアウトのあとメッセージ 1 を送り直す。リプレイカウンターは新しい値（2）、ANonce は同じ。ノート PC は同じく間違った MIC で答え、AP はまた捨てる。',
      },
      events: [
        send(
          eapol({
            id: 'message-1-again',
            number: 1,
            replayCounter: 2,
            nonce: 'ANonce (same as before)',
            mic: '0 (no PTK yet)',
            retransmitOf: 'message-1',
          }),
        ),
        send(message2('message-2-again', 2, 'rejected')),
      ],
    },
    {
      id: 'deauth',
      title: { en: 'The AP gives up', ja: 'AP があきらめる' },
      description: {
        en: 'After too many attempts (the number and the timeouts depend on the implementation), the AP deauthenticates the laptop with reason code 15, “4-way handshake timeout”. Both sides go back to State 1 and the AP forgets the association. The laptop only knows that the handshake failed; the operating system then guesses “wrong password?”. This also shows WPA2-Personal’s weakness: anyone who records messages 1 and 2 of a successful handshake can test passphrase guesses offline, by doing exactly this MIC check.',
        ja: '何度か失敗すると（回数とタイムアウトは実装による）、AP は理由コード 15「4-way handshake timeout」でノート PC の認証を解除する。両者は State 1 に戻り、AP はアソシエーションを忘れる。ノート PC にわかるのはハンドシェイクが失敗したことだけで、OS が「パスワードが違うのでは」と推測する。WPA2-Personal の弱点もここにある。成功したハンドシェイクのメッセージ 1 と 2 を記録すれば、誰でもこの MIC の確認をそのまま使って、パスフレーズの推測をオフラインで試せる。',
      },
      events: [
        send(
          frame({
            id: 'deauth',
            from: AP,
            to: STA_A,
            label: 'Deauthentication (reason 15)',
            kind: 'deauthentication',
            fields: [
              ...addresses('none', { da: MAC.staA, sa: MAC.ap, bssid: MAC.ap }),
              { name: 'Reason Code', value: '15 (4-way handshake timeout)', highlight: true },
            ],
          }),
        ),
        set(STA_A, STATE, STATE_1),
        set(STA_A, PORT, '-'),
        set(STA_A, KEYS, keyTable([])),
        set(AP, STATIONS, stationTable([STATION_B])),
        set(AP, KEYS, keyTable(AP_KEYS_BASE)),
      ],
    },
  ]
}

const uplink = (from: 'staA' | 'staB', da: string) => ({
  roles: { da, sa: from === 'staA' ? MAC.staA : MAC.staB, bssid: MAC.ap },
  tkOf: from === 'staA' ? 'STA A' : 'STA B',
})

function dataToB(options: { retry: boolean }): Message {
  const { roles, tkOf } = uplink('staA', MAC.staB)
  return frame({
    id: options.retry ? 'data-a-retry' : 'data-a',
    from: STA_A,
    to: AP,
    label: options.retry ? 'Data (Retry=1) to STA B' : 'Data (ToDS=1) to STA B',
    kind: 'data',
    flags: { toDs: true, protected: true, retry: options.retry },
    encrypted: true,
    ...(options.retry ? { retransmitOf: 'data-a' } : {}),
    fields: dataFields({ direction: 'toDs', roles, sequence: 1, ccmp: { pn: 1, tkOf } }),
  })
}

const relayStep: Omit<Step, 'section'> = {
  id: 'relay',
  title: {
    en: 'The AP relays the packet to the phone',
    ja: 'AP がパケットをスマートフォンに中継する',
  },
  description: {
    en: 'The AP decrypts the frame with the laptop’s TK and sends the packet on to the phone, encrypted with the phone’s own TK. FromDS=1: the frame comes from the distribution system. Now Address 1 is the phone, Address 2 the AP, and Address 3 keeps the original sender, the laptop. Before sending, the AP waits for DIFS and a backoff like any station. Even between two stations of the same BSS, frames normally go through the AP: 2 frames, not 1.',
    ja: 'AP はノート PC の TK でフレームを復号し、スマートフォンの TK で暗号化し直してパケットを送る。FromDS=1 は、フレームがディストリビューションシステムの側から来たという意味。今度は Address 1 がスマートフォン、Address 2 が AP で、Address 3 に元の送信者のノート PC が残る。AP も送る前に、ほかの STA と同じく DIFS とバックオフを待つ。同じ BSS の STA どうしでも、フレームはふつう AP を通る。1 回ではなく 2 回送ることになる。',
  },
  events: [
    set(AP, MEDIUM, backoff(5, CW_MIN)),
    send(
      frame({
        id: 'relay',
        from: AP,
        to: STA_B,
        label: 'Data (FromDS=1) from STA A',
        kind: 'data',
        flags: { fromDs: true, protected: true },
        encrypted: true,
        fields: dataFields({
          direction: 'fromDs',
          roles: { da: MAC.staB, sa: MAC.staA, bssid: MAC.ap },
          sequence: 203,
          ccmp: { pn: 198, tkOf: 'STA B' },
        }),
      }),
    ),
  ],
}

const relayAckStep: Omit<Step, 'section'> = {
  id: 'relay-ack',
  title: { en: 'The phone acknowledges', ja: 'スマートフォンが Ack を返す' },
  description: {
    en: 'The phone acknowledges and the packet has arrived. Frames that the AP sends to a group address (broadcast or multicast) are encrypted with the GTK and get no Ack: many stations would answer at once.',
    ja: 'スマートフォンが Ack を返し、パケットが届いた。AP がグループアドレス（ブロードキャストやマルチキャスト）に送るフレームは GTK で暗号化し、Ack は返らない。多くの STA が一斉に答えてしまうから。',
  },
  events: [
    send(ack('relay-ack', STA_B, AP, MAC.ap)),
    set(AP, MEDIUM, 'Ack received'),
    set(STA_B, LAST_FRAME, 'Data from STA A (decrypted)'),
  ],
}

function contendStep(): Omit<Step, 'section'> {
  return {
    id: 'contend',
    title: { en: 'The laptop waits for its turn', ja: 'ノート PC が送る順番を待つ' },
    description: {
      en: `The laptop has a ${String(IP_BYTES)}-byte IP packet for the phone. All stations share one channel, so before sending, a station listens (carrier sense). The medium must be idle for DIFS (${us(DIFS_US)} = SIFS + 2 slots); then the station counts down a random backoff, a number of ${us(SLOT_US)} slots drawn from 0 to CW (${String(CW_MIN)} at first). The laptop drew 3. If another station starts sending, the countdown pauses until the medium is idle again.`,
      ja: `ノート PC にはスマートフォン宛ての ${String(IP_BYTES)} バイトの IP パケットがある。すべての STA が 1 つのチャネルを共有するので、送る前に聞く（キャリアセンス）。媒体が DIFS（${us(DIFS_US)} = SIFS + 2 スロット）のあいだ空いていたら、ランダムなバックオフを数える。0 から CW（最初は ${String(CW_MIN)}）までの中から選んだ数だけ、${us(SLOT_US)} のスロットを待つ。ノート PC は 3 を選んだ。途中でほかの STA が送り始めたら、媒体がまた空くまで数えるのを止める。`,
    },
    events: [set(STA_A, MEDIUM, backoff(3, CW_MIN))],
  }
}

function normalData(lostAck: boolean): Omit<Step, 'section'>[] {
  const sendStep: Omit<Step, 'section'> = {
    id: 'data',
    title: { en: 'The laptop sends to the AP', ja: 'ノート PC が AP に送る' },
    description: {
      en: `The frame goes to the AP (Address 1 = BSSID), although the packet is for the phone (Address 3 = DA). ToDS=1 means “towards the distribution system”, that is, to the AP. The body is encrypted with CCMP using the laptop’s TK; the header stays readable. The Duration field (${us(DATA_DURATION_US)}) tells every station that hears the frame how long the medium stays reserved: SIFS plus the Ack.`,
      ja: `パケットはスマートフォン宛て（Address 3 = DA）だが、フレームは AP に送る（Address 1 = BSSID）。ToDS=1 は「ディストリビューションシステムに向かう」、つまり AP 宛てという意味。本体はノート PC の TK を使って CCMP で暗号化し、ヘッダーは読めるまま。Duration のフィールド（${us(DATA_DURATION_US)}）は、フレームを聞いたすべての STA に、媒体をどれだけ予約しておくか（SIFS と Ack の分）を伝える。`,
    },
    events: [
      send(dataToB({ retry: false })),
      set(STA_A, MEDIUM, `sending (${us(DATA_AIRTIME_US)})`),
    ],
  }
  if (!lostAck) {
    return [
      contendStep(),
      sendStep,
      {
        id: 'ack',
        title: { en: 'An Ack after SIFS', ja: 'SIFS のあとに Ack' },
        description: {
          en: `The AP received the frame with a correct checksum (FCS), so after SIFS (${us(SIFS_US)}) it sends an Ack. SIFS is shorter than DIFS, so no other station can start in between: the Ack always goes first. An Ack has only the receiver’s address and is never encrypted. Wi-Fi needs it because a sender cannot detect a collision while it transmits: without the Ack, it would not know whether the frame arrived.`,
          ja: `AP はチェックサム（FCS）の正しいフレームを受け取ったので、SIFS（${us(SIFS_US)}）のあとに Ack を返す。SIFS は DIFS より短いので、あいだにほかの STA が送り始めることはできず、Ack が必ず先になる。Ack には受信者のアドレスしかなく、暗号化もしない。Wi-Fi に Ack が必要なのは、送信者が送っている最中には衝突に気づけないから。Ack がなければ、フレームが届いたかどうかわからない。`,
        },
        events: [
          send(ack('ack', AP, STA_A, MAC.staA)),
          set(STA_A, MEDIUM, 'Ack received'),
          set(AP, LAST_FRAME, 'Data from STA A (seq 1)'),
        ],
      },
      relayStep,
      relayAckStep,
    ]
  }
  return [
    contendStep(),
    sendStep,
    {
      id: 'ack',
      title: { en: 'The Ack is lost', ja: 'Ack が失われる' },
      description: {
        en: 'The AP received the frame and sends an Ack after SIFS, but the Ack is lost on the way, for example because of interference near the laptop.',
        ja: 'AP はフレームを受け取り、SIFS のあとに Ack を返すが、Ack は途中で失われる。たとえばノート PC の近くの電波の干渉で。',
      },
      events: [
        send(ack('ack', AP, STA_A, MAC.staA, 'lost')),
        set(AP, LAST_FRAME, 'Data from STA A (seq 1)'),
      ],
    },
    {
      id: 'ack-timeout',
      title: { en: 'No Ack: the laptop tries again', ja: 'Ack が来ない。ノート PC がやり直す' },
      description: {
        en: `The laptop waits for the Ack timeout (SIFS + a slot + the receiver’s start-up delay, about 50 µs here) and counts the frame as failed. It cannot tell whether the data or the Ack was lost. It doubles the contention window (CW ${String(CW_MIN)} → ${String(RETRY_CW)}), draws a new backoff (here 12 slots) and waits for DIFS and the backoff again.`,
        ja: `ノート PC は Ack のタイムアウト（SIFS + 1 スロット + 受信の立ち上がりの遅れ。ここではおよそ 50 µs）を待ち、送信を失敗とみなす。失われたのがデータか Ack かは区別できない。コンテンションウィンドウを 2 倍にし（CW ${String(CW_MIN)} → ${String(RETRY_CW)}）、新しいバックオフ（ここでは 12 スロット）を選んで、また DIFS とバックオフを待つ。`,
      },
      events: [set(STA_A, MEDIUM, `no Ack: ${backoff(12, RETRY_CW)}`)],
    },
    {
      id: 'retry',
      title: { en: 'The retransmission is a duplicate', ja: '再送されたフレームは重複' },
      description: {
        en: 'The retransmission is the same frame with the Retry bit set: the same sequence number and the same CCMP packet number. The AP has already received sequence number 1 from this laptop, so it recognizes the duplicate and discards it, but it still sends an Ack; otherwise the laptop would keep trying. The laptop sets CW back to 15.',
        ja: '再送は、Retry のビットを立てた同じフレーム。シーケンス番号も CCMP のパケット番号も同じ。AP はこのノート PC からシーケンス番号 1 をすでに受け取っているので、重複だと気づいて捨てる。それでも Ack は返す。返さなければノート PC は送り続けるから。ノート PC は CW を 15 に戻す。',
      },
      events: [
        send(dataToB({ retry: true })),
        set(AP, LAST_FRAME, 'duplicate discarded (seq 1)'),
        send(ack('ack-retry', AP, STA_A, MAC.staA)),
        set(STA_A, MEDIUM, `Ack received (CW back to ${String(CW_MIN)})`),
      ],
    },
    relayStep,
    relayAckStep,
  ]
}

function toRouter(from: 'staA' | 'staB', retry: boolean, status?: MessageStatus): Message {
  const { roles, tkOf } = uplink(from, MAC.router)
  const id = `data-${from === 'staA' ? 'a' : 'b'}`
  return frame({
    id: retry ? `${id}-retry` : id,
    from: from === 'staA' ? STA_A : STA_B,
    to: AP,
    label: retry ? 'Data (Retry=1) to router' : 'Data (ToDS=1) to router',
    kind: 'data',
    flags: { toDs: true, protected: true, retry },
    encrypted: true,
    ...(status === undefined ? {} : { status }),
    ...(retry ? { retransmitOf: id } : {}),
    fields: dataFields({
      direction: 'toDs',
      roles,
      sequence: from === 'staA' ? 1 : 88,
      ccmp: { pn: from === 'staA' ? 1 : 91, tkOf },
    }),
  })
}

const HIDDEN_CONTEND_TEXT: LocalizedText = {
  en: 'Now both the laptop and the phone have a packet for a server on the wired LAN (the frames go to the AP, and Address 3 is the router’s MAC address; the wired side is not drawn). Both wait for DIFS and count down a backoff: the laptop drew 5 slots, the phone 2.',
  ja: '今度はノート PC とスマートフォンの両方に、有線 LAN のサーバー宛てのパケットがある（フレームは AP に送り、Address 3 はルーターの MAC アドレス。有線の側は描かない）。両方が DIFS を待ってバックオフを数える。ノート PC は 5 スロット、スマートフォンは 2 スロットを選んだ。',
}

function hiddenNodeData(): Omit<Step, 'section'>[] {
  return [
    {
      id: 'contend',
      title: { en: 'Two stations, one AP', ja: '2 台の STA と 1 台の AP' },
      description: HIDDEN_CONTEND_TEXT,
      events: [set(STA_A, MEDIUM, backoff(5, CW_MIN)), set(STA_B, MEDIUM, backoff(2, CW_MIN))],
    },
    {
      id: 'collision',
      title: { en: 'Both frames collide at the AP', ja: 'AP で 2 つのフレームが衝突する' },
      description: {
        en: 'The phone’s countdown ends first and it starts sending. The laptop cannot hear the phone, so the medium seems idle and it keeps counting: 3 slots later it starts too. At the AP, both signals overlap and neither frame can be decoded. Neither sender notices: while transmitting, each hears only its own signal. This is the hidden node problem: carrier sense only works for stations that can hear each other.',
        ja: 'スマートフォンが先に数え終わり、送り始める。ノート PC にはスマートフォンの電波が届かないので、媒体は空いているように見え、数え続ける。3 スロット後にはノート PC も送り始める。AP では 2 つの信号が重なり、どちらのフレームも復号できない。どちらの送信者も気づかない。送っている最中は自分の信号しか聞こえないから。これが隠れ端末の問題で、キャリアセンスは互いの電波が届く STA の間でしか働かない。',
      },
      events: [
        send(toRouter('staB', false, 'lost')),
        send(toRouter('staA', false, 'lost')),
        set(STA_A, MEDIUM, `sending (${us(DATA_AIRTIME_US)})`),
        set(STA_B, MEDIUM, `sending (${us(DATA_AIRTIME_US)})`),
        set(AP, LAST_FRAME, 'collision (nothing decoded)'),
      ],
    },
    {
      id: 'ack-timeout',
      title: { en: 'No Ack for either', ja: 'どちらにも Ack が来ない' },
      description: {
        en: `No Ack arrives, so both time out, double CW (${String(CW_MIN)} → ${String(RETRY_CW)}) and draw new backoffs: the laptop 4 slots, the phone 20. They could collide again; with each failure CW doubles once more, and the channel is wasted on frames nobody can read.`,
        ja: `Ack が来ないので、両方がタイムアウトし、CW を 2 倍にして（${String(CW_MIN)} → ${String(RETRY_CW)}）新しいバックオフを選ぶ。ノート PC は 4 スロット、スマートフォンは 20 スロット。また衝突するかもしれない。失敗するたびに CW はさらに 2 倍になり、誰も読めないフレームにチャネルを使ってしまう。`,
      },
      events: [
        set(STA_A, MEDIUM, `no Ack: ${backoff(4, RETRY_CW)}`),
        set(STA_B, MEDIUM, `no Ack: ${backoff(20, RETRY_CW)}`),
      ],
    },
    {
      id: 'retry-a',
      title: { en: 'This time the laptop is far ahead', ja: '今度はノート PC がずっと先' },
      description: {
        en: 'The laptop’s countdown ends long before the phone’s, and its retransmission (Retry=1) arrives. The phone cannot hear the laptop’s frame, but it does hear the AP’s Ack, and pauses its countdown while the Ack is on the air.',
        ja: 'ノート PC はスマートフォンよりずっと早く数え終わり、再送（Retry=1）が届く。スマートフォンにはノート PC のフレームは聞こえないが、AP の Ack は聞こえるので、Ack が流れているあいだは数えるのを止める。',
      },
      events: [
        send(toRouter('staA', true)),
        send(ack('ack-a', AP, STA_A, MAC.staA)),
        set(STA_A, MEDIUM, `Ack received (CW back to ${String(CW_MIN)})`),
        set(STA_B, MEDIUM, 'paused (hears the AP’s Ack)'),
        set(AP, LAST_FRAME, 'Data from STA A (seq 1)'),
      ],
    },
    {
      id: 'retry-b',
      title: { en: 'Then the phone', ja: '次にスマートフォン' },
      description: {
        en: 'After the Ack, the phone waits for DIFS again, finishes its countdown and sends. Both packets have arrived and the AP passes them to the wired LAN, but each took two tries, and it was luck that the second draws were far apart. RTS/CTS (the next option) does not rely on luck.',
        ja: 'Ack のあと、スマートフォンはまた DIFS を待ち、残りを数え終えて送る。両方のパケットが届き、AP は有線 LAN に渡す。ただしそれぞれ 2 回かかり、2 回目の選んだ数が大きく離れていたのは運がよかっただけ。RTS/CTS（次の選択肢）なら運に頼らない。',
      },
      events: [
        send(toRouter('staB', true)),
        send(ack('ack-b', AP, STA_B, MAC.staB)),
        set(STA_B, MEDIUM, `Ack received (CW back to ${String(CW_MIN)})`),
        set(AP, LAST_FRAME, 'Data from STA B (seq 88)'),
      ],
    },
  ]
}

function rts(id: MessageId, from: 'staA' | 'staB'): Message {
  return frame({
    id,
    from: from === 'staA' ? STA_A : STA_B,
    to: AP,
    label: `RTS (Duration ${us(RTS_DURATION_US)})`,
    kind: 'rts',
    fields: [
      {
        name: 'Duration',
        value: `${us(RTS_DURATION_US)} (3 × SIFS + CTS + Data + Ack)`,
        highlight: true,
        description: FIELD_TEXT.duration,
      },
      { name: 'Address 1 (RA)', value: MAC.ap, description: FIELD_TEXT.address1 },
      { name: 'Address 2 (TA)', value: from === 'staA' ? MAC.staA : MAC.staB },
      { name: 'Airtime', value: us(RTS_AIRTIME_US), description: FIELD_TEXT.airtime },
    ],
  })
}

function cts(id: MessageId, to: 'staA' | 'staB', ra: string): Message {
  return frame({
    id,
    from: AP,
    to: to === 'staA' ? STA_A : STA_B,
    label: `CTS (Duration ${us(CTS_DURATION_US)})`,
    kind: 'cts',
    fields: [
      {
        name: 'Duration',
        value: `${us(CTS_DURATION_US)} (2 × SIFS + Data + Ack)`,
        highlight: true,
        description: FIELD_TEXT.duration,
      },
      { name: 'Address 1 (RA)', value: ra, description: FIELD_TEXT.address1 },
      { name: 'Airtime', value: us(CTS_AIRTIME_US), description: FIELD_TEXT.airtime },
    ],
  })
}

function rtsCtsData(): Omit<Step, 'section'>[] {
  const nav = `NAV ${us(CTS_DURATION_US)} (busy)`
  return [
    {
      id: 'contend',
      title: { en: 'Two stations, one AP', ja: '2 台の STA と 1 台の AP' },
      description: {
        en: 'Now both the laptop and the phone have a packet for a server on the wired LAN (the frames go to the AP, and Address 3 is the router’s MAC address; the wired side is not drawn). This time the stations send an RTS before every data frame. Both wait for DIFS and count down a backoff: the laptop drew 9 slots, the phone 2.',
        ja: '今度はノート PC とスマートフォンの両方に、有線 LAN のサーバー宛てのパケットがある（フレームは AP に送り、Address 3 はルーターの MAC アドレス。有線の側は描かない）。今回は、STA がデータフレームの前に必ず RTS を送る。両方が DIFS を待ってバックオフを数える。ノート PC は 9 スロット、スマートフォンは 2 スロットを選んだ。',
      },
      events: [set(STA_A, MEDIUM, backoff(9, CW_MIN)), set(STA_B, MEDIUM, backoff(2, CW_MIN))],
    },
    {
      id: 'rts-b',
      title: { en: 'The phone asks first: RTS', ja: 'スマートフォンが先に求める: RTS' },
      description: {
        en: `Instead of the data, the phone first sends a short RTS (request to send, ${String(RTS_BYTES)} bytes). Its Duration covers the whole exchange that follows. The laptop cannot hear the RTS either; if it started sending now, only the short RTS would be lost, not a long data frame.`,
        ja: `スマートフォンはデータの代わりに、まず短い RTS（送信の要求、${String(RTS_BYTES)} バイト）を送る。Duration は、続くやり取り全体の時間。ノート PC にはこの RTS も聞こえない。もしいま送り始めても、失われるのは長いデータフレームではなく短い RTS だけ。`,
      },
      events: [send(rts('rts-b', 'staB'))],
    },
    {
      id: 'cts-b',
      title: { en: 'The AP answers: CTS', ja: 'AP が答える: CTS' },
      description: {
        en: `The AP answers with a CTS (clear to send) addressed to the phone. The laptop can hear the AP, so it receives the CTS too. It is not the receiver, but it reads the Duration field and sets its NAV (network allocation vector) to ${us(CTS_DURATION_US)}: for that long it treats the medium as busy and pauses its countdown, with 3 of its 9 slots left, although it cannot hear the phone. This is virtual carrier sense, alongside the physical carrier sense of the radio (CCA).`,
        ja: `AP はスマートフォン宛ての CTS（送信の許可）で答える。ノート PC には AP の電波が届くので、CTS も受け取る。宛先ではないが、Duration のフィールドを読んで NAV（ネットワーク割り当てベクター）を ${us(CTS_DURATION_US)} にする。スマートフォンの電波は聞こえないのに、そのあいだは媒体が使用中とみなし、9 スロットのうち 3 スロットを残して数えるのを止める。これが仮想キャリアセンスで、無線の物理的なキャリアセンス（CCA）と組み合わせて使う。`,
      },
      events: [
        send(cts('cts-b', 'staB', MAC.staB)),
        send(cts('cts-b-overheard', 'staA', MAC.staB)),
        set(STA_A, MEDIUM, nav),
        set(STA_A, LAST_FRAME, 'CTS for STA B'),
      ],
    },
    {
      id: 'data-b',
      title: { en: 'The phone sends safely', ja: 'スマートフォンが安全に送る' },
      description: {
        en: `The phone sends its data and the AP acknowledges. The laptop’s NAV covers exactly this: SIFS + data + SIFS + Ack = ${us(CTS_DURATION_US)}. When it expires, the laptop waits for DIFS and counts down the 3 slots left.`,
        ja: `スマートフォンがデータを送り、AP が Ack を返す。ノート PC の NAV は、ちょうどこの時間（SIFS + データ + SIFS + Ack = ${us(CTS_DURATION_US)}）をまかなう。NAV が切れると、ノート PC は DIFS を待ち、残りの 3 スロットを数える。`,
      },
      events: [
        send(toRouter('staB', false)),
        send(ack('ack-b', AP, STA_B, MAC.staB)),
        set(STA_B, MEDIUM, 'Ack received'),
        set(STA_A, MEDIUM, 'NAV expired: DIFS + 3 slots left'),
        set(AP, LAST_FRAME, 'Data from STA B (seq 88)'),
      ],
    },
    {
      id: 'rts-a',
      title: { en: 'Now the laptop: RTS and CTS', ja: '次はノート PC: RTS と CTS' },
      description: {
        en: 'The laptop does the same. This time it is the phone that hears the CTS and sets its NAV.',
        ja: 'ノート PC も同じようにする。今度は、スマートフォンが CTS を聞いて NAV を設定する。',
      },
      events: [
        send(rts('rts-a', 'staA')),
        send(cts('cts-a', 'staA', MAC.staA)),
        send(cts('cts-a-overheard', 'staB', MAC.staA)),
        set(STA_B, MEDIUM, nav),
        set(STA_B, LAST_FRAME, 'CTS for STA A'),
      ],
    },
    {
      id: 'data-a',
      title: { en: 'No collision this time', ja: '今回は衝突しない' },
      description: {
        en: 'The laptop’s data and the Ack follow, and no frame collided. The price is two extra short frames (and two SIFS) for every data frame, so RTS/CTS is usually used only for large frames, above a configurable RTS threshold, or when hidden nodes cause trouble. An RTS can still collide, but it is short.',
        ja: 'ノート PC のデータと Ack が続き、衝突は 1 度もなかった。代わりに、データフレームごとに短いフレーム 2 つ（と SIFS 2 回）が増える。そのため RTS/CTS はふつう、設定できるしきい値（RTS threshold）より大きなフレームや、隠れ端末が問題になるときにだけ使う。RTS も衝突しうるが、短い。',
      },
      events: [
        send(toRouter('staA', false)),
        send(ack('ack-a', AP, STA_A, MAC.staA)),
        set(STA_A, MEDIUM, 'Ack received'),
        set(STA_B, MEDIUM, '-'),
        set(AP, LAST_FRAME, 'Data from STA A (seq 1)'),
      ],
    },
  ]
}

// ---------- アドホック（IBSS） ----------

function adhocSteps(): Step[] {
  const beacon = (id: MessageId, from: 'staA' | 'staB'): Message =>
    frame({
      id,
      from: from === 'staA' ? STA_A : STA_B,
      to: from === 'staA' ? STA_B : STA_A,
      label: `Beacon (IBSS ${IBSS_SSID})`,
      kind: 'beacon',
      fields: [
        ...addresses('none', {
          da: BROADCAST,
          sa: from === 'staA' ? MAC.staA : MAC.staB,
          bssid: IBSS_BSSID,
        }),
        { name: 'Timestamp', value: 'TSF of the sender (64-bit µs counter)' },
        { name: 'Beacon Interval', value: `100 TU (${String((100 * TU_US) / 1000)} ms)` },
        { name: 'Capability', value: 'ESS=0, IBSS=1, Privacy=0', highlight: true },
        { name: 'SSID', value: IBSS_SSID },
        { name: 'Supported Rates', value: RATES },
        { name: 'IBSS Parameter Set', value: 'ATIM Window 0' },
      ],
    })
  return [
    ...inSection(SECTIONS.ibss, [
      {
        id: 'setup',
        title: { en: 'Two devices, no access point', ja: 'アクセスポイントのない 2 台' },
        description: {
          en: `There is no AP (its lane stays empty). The laptop starts an independent BSS (IBSS) called ${IBSS_SSID} on channel ${String(CHANNEL)}. With no AP whose MAC address could serve as the BSSID, the laptop makes one up: 46 random bits, with the group bit 0 and the “locally administered” bit 1 (${IBSS_BSSID}). This network is open, without encryption.`,
          ja: `AP はない（AP のレーンは空のまま）。ノート PC がチャネル ${String(CHANNEL)} で ${IBSS_SSID} という独立した BSS（IBSS）を始める。BSSID に使える AP の MAC アドレスがないので、ノート PC は BSSID を作る。46 ビットは乱数で、グループのビットは 0、「ローカルに管理された」ビットは 1（${IBSS_BSSID}）。このネットワークは暗号化のないオープンなもの。`,
        },
        events: [
          set(STA_A, HEARS, 'STA B'),
          set(AP, HEARS, '-'),
          set(STA_B, HEARS, 'STA A'),
          set(AP, BSS, 'not used'),
          set(STA_A, STATE, 'IBSS started'),
          set(STA_B, STATE, `looking for ${IBSS_SSID}`),
        ],
      },
      {
        id: 'beacon-a',
        title: { en: 'The laptop sends the beacons', ja: 'ノート PC がビーコンを送る' },
        description: {
          en: 'The laptop sends beacons itself; the Capability field says IBSS=1 instead of ESS=1. The phone hears one and joins: it adopts the BSSID and the beacon interval, and sets its clock (TSF) to the beacon’s timestamp, since that is later than its own. There is no authentication and no association: in an IBSS, stations may exchange data frames right away.',
          ja: 'ビーコンはノート PC 自身が送る。Capability のフィールドは ESS=1 ではなく IBSS=1。スマートフォンはそれを聞いて参加する。BSSID とビーコンの間隔を取り入れ、ビーコンのタイムスタンプが自分より進んでいるので、時計（TSF）をそれに合わせる。認証もアソシエーションもない。IBSS では、STA どうしがすぐにデータフレームをやり取りできる。',
        },
        events: [
          send(beacon('beacon-a', 'staA')),
          set(STA_B, STATE, `joined ${IBSS_SSID}`),
          set(STA_B, LAST_FRAME, 'Beacon (TSF synced)'),
        ],
      },
      {
        id: 'beacon-b',
        title: { en: 'Now the phone sends the beacon', ja: '今度はスマートフォンがビーコンを送る' },
        description: {
          en: 'In an IBSS, all stations share the job of sending beacons. At each beacon time, every station waits a random delay; the first to send wins and the others cancel theirs. This time the phone was first.',
          ja: 'IBSS では、すべての STA がビーコンを送る役目を分け合う。ビーコンの時刻ごとに、各 STA がランダムな時間を待ち、最初に送った STA の勝ち。ほかの STA は自分の分を取りやめる。今回はスマートフォンが先だった。',
        },
        events: [send(beacon('beacon-b', 'staB')), set(STA_A, LAST_FRAME, 'Beacon (from STA B)')],
      },
    ]),
    ...inSection(SECTIONS.data, [
      {
        id: 'data',
        title: { en: 'Straight to the phone', ja: 'スマートフォンに直接送る' },
        description: {
          en: 'After DIFS and a backoff, as in any BSS, the laptop sends straight to the phone: one hop, not two. ToDS=0 and FromDS=0: no distribution system is involved. Address 1 is the phone, Address 2 the laptop, and Address 3 the BSSID of the IBSS, so that stations can tell which IBSS the frame belongs to.',
          ja: 'ほかの BSS と同じく DIFS とバックオフのあとで、ノート PC はスマートフォンに直接送る。2 回ではなく 1 回で届く。ToDS=0、FromDS=0 で、ディストリビューションシステムは関わらない。Address 1 はスマートフォン、Address 2 はノート PC、Address 3 は IBSS の BSSID。フレームがどの IBSS のものかを区別するため。',
        },
        events: [
          set(STA_A, MEDIUM, backoff(3, CW_MIN)),
          send(
            frame({
              id: 'data',
              from: STA_A,
              to: STA_B,
              label: 'Data (ToDS=0, FromDS=0)',
              kind: 'data',
              fields: dataFields({
                direction: 'none',
                roles: { da: MAC.staB, sa: MAC.staA, bssid: IBSS_BSSID },
                sequence: 1,
                ccmp: null,
              }),
            }),
          ),
        ],
      },
      {
        id: 'ack',
        title: { en: 'The phone acknowledges', ja: 'スマートフォンが Ack を返す' },
        description: {
          en: 'The phone acknowledges after SIFS, as in infrastructure mode. There is no AP to bridge to a wired LAN, and security is up to the stations themselves (an IBSS can also use a 4-way handshake, but this page shows an open one). Ad hoc mode is little used today; Wi-Fi Direct, where one device acts as the AP (the group owner), and mesh networks (802.11s) fill the same role.',
          ja: 'インフラストラクチャモードと同じく、スマートフォンは SIFS のあとに Ack を返す。有線 LAN につなぐ AP はなく、セキュリティは STA どうしに任される（IBSS でも 4 ウェイハンドシェイクを使えるが、このページではオープンなものを示す）。アドホックモードは今ではあまり使われない。同じ役目は、1 台が AP（グループオーナー）になる Wi-Fi Direct や、メッシュネットワーク（802.11s）が担う。',
        },
        events: [
          send(ack('ack', STA_B, STA_A, MAC.staA)),
          set(STA_A, MEDIUM, 'Ack received'),
          set(STA_B, LAST_FRAME, 'Data from STA A (seq 1)'),
        ],
      },
    ]),
  ]
}

function buildSteps({ situation }: WifiOptions): readonly Step[] {
  if (situation === 'adhoc') {
    return adhocSteps()
  }
  const hidden = situation === 'hiddenNode' || situation === 'rtsCts'
  const wrongPassphrase = situation === 'wrongPassphrase'
  const steps = discovery(hidden, wrongPassphrase)
  if (wrongPassphrase) {
    return [...steps, ...inSection(SECTIONS.handshake, failedHandshake())]
  }
  const data: Record<Exclude<Situation, 'adhoc' | 'wrongPassphrase'>, Omit<Step, 'section'>[]> = {
    normal: normalData(false),
    lostAck: normalData(true),
    hiddenNode: hiddenNodeData(),
    rtsCts: rtsCtsData(),
  }
  return [
    ...steps,
    ...inSection(SECTIONS.handshake, handshake()),
    ...inSection(SECTIONS.data, data[situation]),
  ]
}

export const wifiScenario: Scenario<WifiOptions> = {
  id: 'wifi',
  title: {
    en: 'Wi-Fi: joining a wireless network',
    ja: 'Wi-Fi: 無線 LAN につながる',
  },
  actors,
  optionDefs: {
    situation: {
      kind: 'select',
      label: { en: 'Situation', ja: '状況' },
      choices: [
        { value: 'normal', label: { en: 'Everything works', ja: 'すべて正常' } },
        { value: 'wrongPassphrase', label: { en: 'Wrong passphrase', ja: 'パスフレーズの誤り' } },
        { value: 'lostAck', label: { en: 'An Ack is lost', ja: 'Ack が失われる' } },
        {
          value: 'hiddenNode',
          label: { en: 'Hidden node (collision)', ja: '隠れ端末（衝突する）' },
        },
        { value: 'rtsCts', label: { en: 'Hidden node with RTS/CTS', ja: '隠れ端末と RTS/CTS' } },
        {
          value: 'adhoc',
          label: { en: 'Ad hoc (IBSS, no AP)', ja: 'アドホック（IBSS、AP なし）' },
        },
      ],
      defaultValue: 'normal',
    },
  },
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps,
}
