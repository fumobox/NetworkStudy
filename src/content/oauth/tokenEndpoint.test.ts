// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { codeChallengeS256 } from './pkce'
import { redeemCode, type CodeRecord, type CodeRequest } from './tokenEndpoint'

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const RECORD: CodeRecord = {
  code: 'SplxlOBeZQQYbYS6WxSbIA',
  clientId: 's6BhdRkqt3',
  redirectUri: 'https://client.example.com/cb',
  codeChallenge: codeChallengeS256(VERIFIER),
  user: 'alice',
  expiresAt: 1790845800,
  used: false,
}
const REQUEST: CodeRequest = {
  clientId: 's6BhdRkqt3',
  code: 'SplxlOBeZQQYbYS6WxSbIA',
  redirectUri: 'https://client.example.com/cb',
  codeVerifier: VERIFIER,
}
const NOW = 1790845260

describe('redeemCode', () => {
  it('正しい要求は通り、PKCE が一致する', () => {
    expect(redeemCode(RECORD, REQUEST, NOW)).toEqual({ ok: true, pkce: 'match' })
  })

  it('code_verifier が違えば invalid_grant', () => {
    expect(redeemCode(RECORD, { ...REQUEST, codeVerifier: 'x'.repeat(43) }, NOW)).toEqual({
      ok: false,
      error: 'invalid_grant',
      reason: 'code_verifier does not match code_challenge',
    })
  })

  it('code_challenge のないコードは、確かめるものがないまま通る', () => {
    const noPkce = { ...RECORD, codeChallenge: null }
    expect(redeemCode(noPkce, { ...REQUEST, codeVerifier: null }, NOW)).toEqual({
      ok: true,
      pkce: 'noChallenge',
    })
  })

  it('使用済み、期限切れ、別のクライアント、redirect_uri の違いは invalid_grant', () => {
    const reason = (record: CodeRecord, request: CodeRequest, now = NOW) => {
      const result = redeemCode(record, request, now)
      return result.ok ? null : result.reason
    }
    expect(reason({ ...RECORD, used: true }, REQUEST)).toBe('code already used')
    expect(reason(RECORD, REQUEST, RECORD.expiresAt)).toBe('code expired')
    expect(reason(RECORD, { ...REQUEST, clientId: 'other' })).toBe('issued to another client')
    expect(reason(RECORD, { ...REQUEST, redirectUri: 'https://client.example.com/cb2' })).toBe(
      'redirect_uri differs',
    )
    expect(reason(RECORD, { ...REQUEST, code: 'other' })).toBe('unknown code')
  })
})
