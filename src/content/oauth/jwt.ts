/**
 * JWT（RFC 7519）の形と、受け取った側の確かめ。署名は計算しない（学習用。値は名前で示す）。
 * - ID トークン: OpenID Connect Core 1.0 §3.1.3.7（iss、aud、exp、iat、nonce）
 * - JWT のアクセストークン: RFC 9068 §4（typ、iss、aud、exp、scope）
 */
import { base64url, utf8 } from './encoding'

/** NumericDate（RFC 7519 §2）: 1970-01-01T00:00:00Z からの秒 */
export const numericDate = (iso: string): number => Date.parse(iso) / 1000

/** ヘッダーとクレームの base64url。署名の部分は計算しない */
export function jwtSegments(header: object, claims: object): string {
  return `${base64url(utf8(JSON.stringify(header)))}.${base64url(utf8(JSON.stringify(claims)))}`
}

export interface IdTokenClaims {
  readonly iss: string
  readonly sub: string
  readonly aud: string
  readonly exp: number
  readonly iat: number
  readonly nonce?: string
}

export type ClaimRow = readonly [claim: string, value: string, check: string]

/** ID トークンの確かめの行。nonce を送っていなければ確かめられない（not requested）。送っていないのに入っていたら拒む（OIDC Core §2） */
export function validateIdToken(input: {
  readonly claims: IdTokenClaims
  readonly issuer: string
  readonly clientId: string
  readonly nonce: string | null
  readonly now: number
}): { readonly ok: boolean; readonly rows: readonly ClaimRow[] } {
  const { claims, issuer, clientId, nonce, now } = input
  const rows: ClaimRow[] = [
    ['iss', claims.iss, claims.iss === issuer ? 'OK' : 'mismatch'],
    ['aud', claims.aud, claims.aud === clientId ? 'OK' : 'not this client'],
    ['exp', String(claims.exp), claims.exp > now ? 'OK' : 'expired'],
    ['iat', String(claims.iat), claims.iat <= now ? 'OK' : 'in the future'],
    [
      'nonce',
      claims.nonce ?? '-',
      nonce === null
        ? claims.nonce === undefined
          ? 'not requested'
          : 'unexpected'
        : claims.nonce === nonce
          ? 'OK'
          : 'mismatch',
    ],
  ]
  return { ok: rows.every(([, , check]) => check === 'OK' || check === 'not requested'), rows }
}

export interface AccessTokenClaims {
  readonly iss: string
  readonly sub: string
  readonly aud: string
  readonly client_id: string
  readonly exp: number
  readonly iat: number
  readonly jti: string
  readonly scope: string
}

export type CheckRow = readonly [check: string, result: string]

/** リソースサーバーでの確かめの行（RFC 9068 §4） */
export function validateAccessToken(input: {
  readonly typ: string
  readonly claims: AccessTokenClaims
  readonly issuer: string
  readonly audience: string
  readonly requiredScope: string
  readonly now: number
}): { readonly ok: boolean; readonly rows: readonly CheckRow[] } {
  const { typ, claims, issuer, audience, requiredScope, now } = input
  const rows: CheckRow[] = [
    ['typ', typ === 'at+jwt' ? 'at+jwt: OK' : `${typ}: not an access token`],
    ['iss', claims.iss === issuer ? 'OK' : 'mismatch'],
    ['aud', claims.aud === audience ? 'OK' : 'not this API'],
    ['exp', claims.exp > now ? 'OK' : `expired (${String(claims.exp)})`],
    [
      'scope',
      claims.scope.split(' ').includes(requiredScope)
        ? `${requiredScope}: OK`
        : `no ${requiredScope}`,
    ],
  ]
  return { ok: rows.every(([, result]) => result.endsWith('OK')), rows }
}
