/**
 * IEEE 802.11 の MAC ヘッダーの純関数（IEEE Std 802.11-2024 clause 9 "Frame formats"）
 *
 * - 9.2.4.1 "Frame Control field": 1 オクテット目は Protocol Version（2 ビット）、Type（2 ビット）、Subtype（4 ビット）を
 *   下位ビットから並べる。2 オクテット目は To DS、From DS、More Fragments、Retry、Power Management、More Data、
 *   Protected Frame、+HTC の各 1 ビット
 * - 9.2.4.1.3 "Type and Subtype subfields": 管理 0、制御 1、データ 2。Beacon 8、Probe Request 4、Probe Response 5、
 *   Authentication 11、Deauthentication 12、Association Request 0、Association Response 1、RTS 11、CTS 12、Ack 13、Data 0
 * - 9.2.4.1.4 "To DS and From DS subfields" と 9.3.2.1（データフレームのアドレスの中身の表）: To DS / From DS の組み合わせで
 *   Address 1〜3 の意味が変わる。Address 1 は受信者（RA）、Address 2 は送信者（TA）
 * - MAC アドレスの最初のオクテットの最下位ビットは I/G（1 ならグループ）、次のビットは U/L（1 ならローカルに管理された
 *   アドレス）（RFC 9542 §2.1.1）
 */

const TYPE_VALUES = { management: 0, control: 1, data: 2 } as const
type FrameType = keyof typeof TYPE_VALUES

interface FrameKindSpec {
  readonly type: FrameType
  readonly subtype: number
}

export const FRAME_KINDS = {
  associationRequest: { type: 'management', subtype: 0 },
  associationResponse: { type: 'management', subtype: 1 },
  probeRequest: { type: 'management', subtype: 4 },
  probeResponse: { type: 'management', subtype: 5 },
  beacon: { type: 'management', subtype: 8 },
  authentication: { type: 'management', subtype: 11 },
  deauthentication: { type: 'management', subtype: 12 },
  rts: { type: 'control', subtype: 11 },
  cts: { type: 'control', subtype: 12 },
  ack: { type: 'control', subtype: 13 },
  data: { type: 'data', subtype: 0 },
} as const satisfies Record<string, FrameKindSpec>
export type FrameKind = keyof typeof FRAME_KINDS

export interface FrameFlags {
  readonly toDs?: boolean
  readonly fromDs?: boolean
  readonly retry?: boolean
  readonly protected?: boolean
}

/** Frame Control の 2 オクテット（Protocol Version は 0） */
export function frameControl(kind: FrameKind, flags: FrameFlags = {}): readonly [number, number] {
  const { type, subtype } = FRAME_KINDS[kind]
  const first = (subtype << 4) | (TYPE_VALUES[type] << 2)
  const second =
    (flags.toDs === true ? 0x01 : 0) |
    (flags.fromDs === true ? 0x02 : 0) |
    (flags.retry === true ? 0x08 : 0) |
    (flags.protected === true ? 0x40 : 0)
  return [first, second]
}

export const hex = (bytes: readonly number[]): string =>
  bytes.map((b) => `0x${b.toString(16).padStart(2, '0')}`).join(' ')

/** To DS / From DS の向き。両方 1（メッシュや WDS の 4 アドレス）は扱わない */
export type DsDirection = 'none' | 'toDs' | 'fromDs'

export interface AddressRoles {
  /** 最終的な宛先 */
  readonly da: string
  /** 元の送信元 */
  readonly sa: string
  readonly bssid: string
}

export interface AddressField {
  readonly name: string
  readonly value: string
}

/**
 * Address 1〜3 の名前と値。管理フレームと、IBSS の中のデータフレームは 'none' と同じ並び（DA、SA、BSSID）。
 * どの向きでも Address 1 が RA、Address 2 が TA になる
 */
export function addressFields(
  direction: DsDirection,
  roles: AddressRoles,
): readonly [AddressField, AddressField, AddressField] {
  switch (direction) {
    case 'none':
      return [
        { name: 'Address 1 (DA)', value: roles.da },
        { name: 'Address 2 (SA)', value: roles.sa },
        { name: 'Address 3 (BSSID)', value: roles.bssid },
      ]
    case 'toDs':
      return [
        { name: 'Address 1 (BSSID)', value: roles.bssid },
        { name: 'Address 2 (SA)', value: roles.sa },
        { name: 'Address 3 (DA)', value: roles.da },
      ]
    case 'fromDs':
      return [
        { name: 'Address 1 (DA)', value: roles.da },
        { name: 'Address 2 (BSSID)', value: roles.bssid },
        { name: 'Address 3 (SA)', value: roles.sa },
      ]
  }
}

function firstOctet(mac: string): number {
  return Number.parseInt(mac.slice(0, 2), 16)
}

/** I/G ビットが 1（ブロードキャスト・マルチキャスト） */
export const isGroupAddress = (mac: string): boolean => (firstOctet(mac) & 0x01) !== 0

/** U/L ビットが 1（製造元の割り当てではなく、ローカルに管理されたアドレス） */
export const isLocallyAdministered = (mac: string): boolean => (firstOctet(mac) & 0x02) !== 0
