/**
 * EAPOL-Key フレームの Key Information（IEEE Std 802.11-2024 12.7.2 "EAPOL-Key frames"）
 *
 * ビット 0〜2 は Key Descriptor Version（2 は MIC が HMAC-SHA1-128、鍵の包みが AES Key Wrap）、3 は Key Type
 * （1 ならペアワイズ）、6 は Install、7 は Key Ack、8 は Key MIC、9 は Secure、10 は Error、11 は Request、
 * 12 は Encrypted Key Data。4 ウェイハンドシェイクの各メッセージに立てるビットは 12.7.6.2〜12.7.6.5
 */

export interface KeyInformationFlags {
  readonly pairwise?: boolean
  readonly install?: boolean
  readonly ack?: boolean
  readonly mic?: boolean
  readonly secure?: boolean
  readonly encryptedKeyData?: boolean
}

/** WPA2-Personal（AKM 2）と CCMP-128 の組み合わせで使う Key Descriptor Version */
export const KEY_DESCRIPTOR_VERSION = 2

const bit = (flag: boolean | undefined, value: number) => (flag === true ? value : 0)

export function keyInformation(flags: KeyInformationFlags): number {
  return (
    KEY_DESCRIPTOR_VERSION |
    bit(flags.pairwise, 0x0008) |
    bit(flags.install, 0x0040) |
    bit(flags.ack, 0x0080) |
    bit(flags.mic, 0x0100) |
    bit(flags.secure, 0x0200) |
    bit(flags.encryptedKeyData, 0x1000)
  )
}

export const hex16 = (value: number): string => `0x${value.toString(16).padStart(4, '0')}`

/** 4 ウェイハンドシェイクの各メッセージの Key Information */
export const HANDSHAKE_KEY_INFO = {
  1: keyInformation({ pairwise: true, ack: true }),
  2: keyInformation({ pairwise: true, mic: true }),
  3: keyInformation({
    pairwise: true,
    install: true,
    ack: true,
    mic: true,
    secure: true,
    encryptedKeyData: true,
  }),
  4: keyInformation({ pairwise: true, mic: true, secure: true }),
} as const
