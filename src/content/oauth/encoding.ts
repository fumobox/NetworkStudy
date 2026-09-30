/** base64（RFC 4648 §4）、base64url（§5。OAuth と JWT は詰め物の = を付けない）、client_secret_basic（RFC 6749 §2.3.1） */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export const utf8 = (text: string) => new TextEncoder().encode(text)

export function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0
    const b1 = bytes[i + 1] ?? 0
    const b2 = bytes[i + 2] ?? 0
    const n = (b0 << 16) | (b1 << 8) | b2
    const chars = [18, 12, 6, 0].map((shift) => ALPHABET.charAt((n >> shift) & 63))
    const kept = Math.min(bytes.length - i, 3) + 1
    out += chars.slice(0, kept).join('') + '='.repeat(4 - kept)
  }
  return out
}

/** base64url。+ と / を - と _ にし、= を付けない */
export const base64url = (bytes: Uint8Array): string =>
  base64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')

/** application/x-www-form-urlencoded の 1 つの値 */
const formEncode = (value: string): string => new URLSearchParams([['', value]]).toString().slice(1)

/** client_secret_basic: client_id と client_secret を form-urlencode してから、HTTP の Basic 認証にする */
export const clientSecretBasic = (clientId: string, clientSecret: string): string =>
  `Basic ${base64(utf8(`${formEncode(clientId)}:${formEncode(clientSecret)}`))}`
