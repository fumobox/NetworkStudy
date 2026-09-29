// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { isolationPolicy, originHeader, secFetchSite } from './requestHeaders'
import type { WebOrigin } from './site'

const https = (host: string): WebOrigin => ({ scheme: 'https', host, port: null })
const bank = https('bank.example')
const evil = https('evil.example')

describe('Origin ヘッダー（Fetch Standard）', () => {
  it('サイトをまたぐフォームの POST にも付く', () => {
    expect(originHeader({ method: 'POST', mode: 'navigate', initiator: evil, target: bank })).toBe(
      'https://evil.example',
    )
  })

  it('GET のナビゲーションには付かない', () => {
    expect(
      originHeader({ method: 'GET', mode: 'navigate', initiator: evil, target: bank }),
    ).toBeUndefined()
  })

  it('CORS の要求には GET でも付く', () => {
    expect(originHeader({ method: 'GET', mode: 'cors', initiator: evil, target: bank })).toBe(
      'https://evil.example',
    )
  })

  it('同じオリジンの CORS の GET には付かない（response tainting が basic）', () => {
    expect(
      originHeader({ method: 'GET', mode: 'cors', initiator: bank, target: bank }),
    ).toBeUndefined()
  })

  it('リファラーポリシーが no-referrer なら null', () => {
    expect(
      originHeader({
        method: 'POST',
        mode: 'navigate',
        initiator: evil,
        target: bank,
        referrerPolicy: 'no-referrer',
      }),
    ).toBe('null')
  })

  it('既定のポリシーでは、https のページから http への POST は null', () => {
    expect(
      originHeader({
        method: 'POST',
        mode: 'navigate',
        initiator: evil,
        target: { scheme: 'http', host: 'bank.example', port: null },
      }),
    ).toBe('null')
  })
})

describe('Sec-Fetch-Site（Fetch Metadata §2.3）', () => {
  it('利用者が直接始めたナビゲーションは none', () => {
    expect(secFetchSite('user', [bank])).toBe('none')
  })

  it('同じオリジン、同じサイト、サイトをまたぐ', () => {
    expect(secFetchSite(bank, [bank])).toBe('same-origin')
    expect(secFetchSite(https('forum.bank.example'), [https('www.bank.example')])).toBe('same-site')
    expect(secFetchSite(evil, [bank])).toBe('cross-site')
  })

  it('リダイレクトの途中でサイトをまたげば cross-site', () => {
    expect(secFetchSite(bank, [bank, evil, bank])).toBe('cross-site')
  })
})

describe('例の方針（標準ではない）', () => {
  const base = { allowedOrigin: 'https://bank.example' }

  it('サイトをまたぐ POST は拒み、リンクでの GET は通す', () => {
    expect(
      isolationPolicy({
        ...base,
        site: 'cross-site',
        mode: 'navigate',
        method: 'POST',
        origin: 'https://evil.example',
      }),
    ).toBe('deny')
    expect(
      isolationPolicy({
        ...base,
        site: 'cross-site',
        mode: 'navigate',
        method: 'GET',
        origin: undefined,
      }),
    ).toBe('allow')
  })

  it('同じサイトのサブドメインからの POST も拒む', () => {
    expect(
      isolationPolicy({
        ...base,
        site: 'same-site',
        mode: 'navigate',
        method: 'POST',
        origin: 'https://forum.bank.example',
      }),
    ).toBe('deny')
  })

  it('Sec-Fetch-Site がなければ Origin で判断する', () => {
    expect(
      isolationPolicy({
        ...base,
        site: undefined,
        mode: 'navigate',
        method: 'POST',
        origin: 'https://bank.example',
      }),
    ).toBe('allow')
    expect(
      isolationPolicy({
        ...base,
        site: undefined,
        mode: 'navigate',
        method: 'POST',
        origin: 'https://evil.example',
      }),
    ).toBe('deny')
  })
})
