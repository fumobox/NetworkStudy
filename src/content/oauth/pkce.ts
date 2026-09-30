/** PKCE（RFC 7636）。S256 は code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))（§4.2） */
import { base64url, utf8 } from './encoding'
import { sha256 } from './sha256'

/** §4.1: 使える文字は A-Z a-z 0-9 - . _ ~ で、43〜128 文字 */
export const isValidCodeVerifier = (verifier: string): boolean =>
  /^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)

export const codeChallengeS256 = (verifier: string): string => base64url(sha256(utf8(verifier)))

/**
 * トークンエンドポイントでの確かめ（§4.6）。認可要求に code_challenge がなければ、確かめるものがない（noChallenge）。
 * 一致しなければ invalid_grant で拒む
 */
export type PkceCheck = 'match' | 'mismatch' | 'noChallenge'

export function verifyCodeVerifier(challenge: string | null, verifier: string | null): PkceCheck {
  if (challenge === null) {
    return 'noChallenge'
  }
  return verifier !== null && codeChallengeS256(verifier) === challenge ? 'match' : 'mismatch'
}
