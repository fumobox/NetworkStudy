// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  publicSuffix,
  registrableDomain,
  sameOrigin,
  sameSite,
  serializeOrigin,
  type WebOrigin,
} from './site'

const https = (host: string, port: number | null = null): WebOrigin => ({
  scheme: 'https',
  host,
  port,
})

describe('public suffix と登録可能ドメイン（URL Standard）', () => {
  it('URL Standard の例と同じ結果になる', () => {
    expect(registrableDomain('www.example.com')).toBe('example.com')
    expect(registrableDomain('github.io')).toBeNull()
    expect(registrableDomain('com')).toBeNull()
    expect(publicSuffix('alice.github.io')).toBe('github.io')
    expect(registrableDomain('shop.example.co.jp')).toBe('example.co.jp')
    expect(registrableDomain('bank.example')).toBe('bank.example')
  })
})

describe('オリジンとサイト（RFC 6454、HTML Standard）', () => {
  it('オリジンを文字列にする', () => {
    expect(serializeOrigin(https('bank.example'))).toBe('https://bank.example')
    expect(serializeOrigin(https('bank.example', 8443))).toBe('https://bank.example:8443')
  })

  it('別の登録可能ドメインはサイトをまたぐ', () => {
    expect(sameSite(https('bank.example'), https('evil.example'))).toBe(false)
  })

  it('同じ登録可能ドメインのサブドメインは同じサイトだが、同じオリジンではない', () => {
    const www = https('www.bank.example')
    const forum = https('forum.bank.example')
    expect(sameSite(www, forum)).toBe(true)
    expect(sameOrigin(www, forum)).toBe(false)
  })

  it('スキームは比べ、ポートは比べない', () => {
    expect(
      sameSite({ scheme: 'http', host: 'bank.example', port: null }, https('bank.example')),
    ).toBe(false)
    expect(sameSite(https('bank.example', 8443), https('bank.example'))).toBe(true)
    expect(sameOrigin(https('bank.example', 8443), https('bank.example'))).toBe(false)
  })

  it('github.io は public suffix なので、利用者ごとのサイトは別のサイト', () => {
    expect(sameSite(https('alice.github.io'), https('bob.github.io'))).toBe(false)
  })
})
