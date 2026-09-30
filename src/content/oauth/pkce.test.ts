// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { codeChallengeS256, isValidCodeVerifier, verifyCodeVerifier } from './pkce'

/** RFC 7636 付録 B */
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

describe('PKCE（RFC 7636）', () => {
  it('付録 B のテストベクター', () => {
    expect(codeChallengeS256(VERIFIER)).toBe(CHALLENGE)
  })

  it('code_verifier は 43〜128 文字の unreserved の文字だけ', () => {
    expect(isValidCodeVerifier(VERIFIER)).toBe(true)
    expect(isValidCodeVerifier(VERIFIER.slice(1))).toBe(false)
    expect(isValidCodeVerifier('a'.repeat(128))).toBe(true)
    expect(isValidCodeVerifier('a'.repeat(129))).toBe(false)
    expect(isValidCodeVerifier(`${VERIFIER.slice(1)}+`)).toBe(false)
  })

  it('トークンエンドポイントでの照合', () => {
    expect(verifyCodeVerifier(CHALLENGE, VERIFIER)).toBe('match')
    expect(verifyCodeVerifier(CHALLENGE, 'x'.repeat(43))).toBe('mismatch')
    expect(verifyCodeVerifier(CHALLENGE, null)).toBe('mismatch')
    expect(verifyCodeVerifier(null, null)).toBe('noChallenge')
  })
})
