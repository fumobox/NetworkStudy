/**
 * トークンエンドポイントが認可コードを引き換えるときの確かめ（RFC 6749 §4.1.2・§4.1.3・§5.2、RFC 7636 §4.6）。
 * コードは 1 回だけ使え、短い時間で切れ、発行したクライアントだけが、同じ redirect_uri で引き換えられる
 */
import { verifyCodeVerifier, type PkceCheck } from './pkce'

export interface CodeRecord {
  readonly code: string
  readonly clientId: string
  readonly redirectUri: string
  readonly codeChallenge: string | null
  readonly user: string
  readonly expiresAt: number
  readonly used: boolean
}

export interface CodeRequest {
  /** クライアント認証（client_secret_basic）で確かめた client_id */
  readonly clientId: string
  readonly code: string
  readonly redirectUri: string
  readonly codeVerifier: string | null
}

export type RedeemResult =
  | { readonly ok: true; readonly pkce: Exclude<PkceCheck, 'mismatch'> }
  | { readonly ok: false; readonly error: 'invalid_grant'; readonly reason: string }

export function redeemCode(record: CodeRecord, request: CodeRequest, now: number): RedeemResult {
  const fail = (reason: string): RedeemResult => ({ ok: false, error: 'invalid_grant', reason })
  if (record.code !== request.code) return fail('unknown code')
  if (record.used) return fail('code already used')
  if (now >= record.expiresAt) return fail('code expired')
  if (record.clientId !== request.clientId) return fail('issued to another client')
  if (record.redirectUri !== request.redirectUri) return fail('redirect_uri differs')
  const pkce = verifyCodeVerifier(record.codeChallenge, request.codeVerifier)
  if (pkce === 'mismatch') return fail('code_verifier does not match code_challenge')
  return { ok: true, pkce }
}
