// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  acceptsSetCookie,
  attachDecision,
  formatSetCookie,
  isSafeMethod,
  sameSiteFlag,
  type SameSiteFlag,
} from './cookies'

describe('SameSite の値（draft-ietf-httpbis-rfc6265bis-22 §5.6.7、§5.7）', () => {
  it('大文字小文字を区別せず、それ以外や未指定は Default', () => {
    expect(['strict', 'LAX', 'None', 'foo', undefined].map(sameSiteFlag)).toEqual([
      'Strict',
      'Lax',
      'None',
      'Default',
      'Default',
    ])
  })

  it('None は Secure がなければ保存されない', () => {
    expect(acceptsSetCookie('None', false)).toBe(false)
    expect(acceptsSetCookie('None', true)).toBe(true)
    expect(acceptsSetCookie('Lax', false)).toBe(true)
  })

  it('Set-Cookie を作る', () => {
    expect(
      formatSetCookie({
        name: 'sid',
        value: '3f9a1c',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      }),
    ).toBe('sid=3f9a1c; Path=/; Secure; HttpOnly; SameSite=Lax')
  })

  it('安全なメソッドは GET、HEAD、OPTIONS、TRACE（RFC 9110 §9.2.1）', () => {
    expect(['GET', 'head', 'OPTIONS', 'TRACE', 'POST', 'PUT', 'DELETE'].map(isSafeMethod)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
    ])
  })
})

describe('Cookie を付けるかどうか（§5.8.3 手順 3）', () => {
  const decide = (
    flag: SameSiteFlag,
    sameSiteRequest: boolean,
    method: string,
    topLevel: boolean,
  ) => attachDecision({ flag, sameSiteRequest, method, topLevel })

  it('同じサイトからの要求と None の Cookie には、いつも付ける', () => {
    for (const flag of ['Strict', 'Lax', 'None', 'Default'] as const) {
      expect(decide(flag, true, 'POST', false)).toBe('sent')
    }
    expect(decide('None', false, 'POST', false)).toBe('sent')
  })

  it('サイトをまたぐとき: Strict は付けない。Lax と Default はトップレベルの安全なメソッドだけ', () => {
    expect(decide('Strict', false, 'GET', true)).toBe('withheld')
    for (const flag of ['Lax', 'Default'] as const) {
      expect(decide(flag, false, 'GET', true)).toBe('sent')
      expect(decide(flag, false, 'POST', true)).toBe('withheld')
      expect(decide(flag, false, 'GET', false)).toBe('withheld')
    }
  })

  it('Lax-allowing-unsafe（§5.6.7.2）は Default の Cookie だけ、作られてから上限の時間まで', () => {
    const limit = { limitMs: 120_000 }
    const post = (flag: SameSiteFlag, ageMs: number) =>
      attachDecision({
        flag,
        sameSiteRequest: false,
        method: 'POST',
        topLevel: true,
        laxAllowingUnsafe: { ...limit, ageMs },
      })
    expect(post('Default', 60_000)).toBe('sent')
    expect(post('Default', 180_000)).toBe('withheld')
    expect(post('Lax', 60_000)).toBe('withheld')
  })
})
