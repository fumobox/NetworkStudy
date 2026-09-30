// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { jwtSegments, numericDate, validateAccessToken, validateIdToken } from './jwt'

const NOW = numericDate('2026-10-01T09:00:00Z')
const ID_CLAIMS = {
  iss: 'https://as.example.net',
  sub: '24400320',
  aud: 's6BhdRkqt3',
  exp: NOW + 3600,
  iat: NOW,
  nonce: 'n-0S6_WzA2Mj',
}
const ACCESS_CLAIMS = {
  iss: 'https://as.example.net',
  sub: '24400320',
  aud: 'https://api.example.org',
  client_id: 's6BhdRkqt3',
  exp: NOW + 3600,
  iat: NOW,
  jti: '7f9b2c1e',
  scope: 'openid profile photos.read',
}

describe('jwt', () => {
  it('NumericDate は UTC の秒', () => {
    expect(NOW).toBe(1790845200)
  })

  it('ヘッダーとクレームを base64url にする（Buffer と一致する）', () => {
    const header = { alg: 'RS256', kid: '2026-09-k1' }
    const [h, p] = jwtSegments(header, ID_CLAIMS).split('.')
    expect(h).toBe('eyJhbGciOiJSUzI1NiIsImtpZCI6IjIwMjYtMDktazEifQ')
    // node:crypto の Buffer で計算した値
    expect(p).toBe(
      'eyJpc3MiOiJodHRwczovL2FzLmV4YW1wbGUubmV0Iiwic3ViIjoiMjQ0MDAzMjAiLCJhdWQiOiJzNkJoZFJrcXQzIiwiZXhwIjoxNzkwODQ4ODAwLCJpYXQiOjE3OTA4NDUyMDAsIm5vbmNlIjoibi0wUzZfV3pBMk1qIn0',
    )
  })

  it('ID トークン: すべて通る', () => {
    const result = validateIdToken({
      claims: ID_CLAIMS,
      issuer: 'https://as.example.net',
      clientId: 's6BhdRkqt3',
      nonce: 'n-0S6_WzA2Mj',
      now: NOW,
    })
    expect(result.ok).toBe(true)
    expect(result.rows.map(([claim, , check]) => `${claim} ${check}`)).toEqual([
      'iss OK',
      'aud OK',
      'exp OK',
      'iat OK',
      'nonce OK',
    ])
  })

  it('ID トークン: 別のクライアント宛て、期限切れ、nonce の不一致は拒む。nonce を送らなければ確かめられない', () => {
    const base = { issuer: 'https://as.example.net', clientId: 's6BhdRkqt3', now: NOW }
    expect(
      validateIdToken({ ...base, claims: { ...ID_CLAIMS, aud: 'other' }, nonce: null }).ok,
    ).toBe(false)
    expect(validateIdToken({ ...base, claims: ID_CLAIMS, nonce: 'other' }).ok).toBe(false)
    expect(validateIdToken({ ...base, claims: ID_CLAIMS, nonce: null, now: NOW + 3600 }).ok).toBe(
      false,
    )
    const withoutNonce = {
      iss: ID_CLAIMS.iss,
      sub: ID_CLAIMS.sub,
      aud: ID_CLAIMS.aud,
      exp: ID_CLAIMS.exp,
      iat: ID_CLAIMS.iat,
    }
    const unrequested = validateIdToken({ ...base, claims: withoutNonce, nonce: null })
    expect(unrequested.ok).toBe(true)
    expect(unrequested.rows[4]).toEqual(['nonce', '-', 'not requested'])
    const unexpected = validateIdToken({ ...base, claims: ID_CLAIMS, nonce: null })
    expect(unexpected.ok).toBe(false)
    expect(unexpected.rows[4]).toEqual(['nonce', 'n-0S6_WzA2Mj', 'unexpected'])
  })

  it('アクセストークン（RFC 9068 §4）', () => {
    const base = {
      typ: 'at+jwt',
      claims: ACCESS_CLAIMS,
      issuer: 'https://as.example.net',
      audience: 'https://api.example.org',
      requiredScope: 'photos.read',
      now: NOW,
    }
    expect(validateAccessToken(base).ok).toBe(true)
    const expired = validateAccessToken({ ...base, now: NOW + 3600 })
    expect(expired.ok).toBe(false)
    expect(expired.rows[3]).toEqual(['exp', 'expired (1790848800)'])
    expect(validateAccessToken({ ...base, typ: 'JWT' }).ok).toBe(false)
    expect(validateAccessToken({ ...base, requiredScope: 'photos.write' }).ok).toBe(false)
  })
})
