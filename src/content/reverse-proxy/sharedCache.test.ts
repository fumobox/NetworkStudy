// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { freshnessLifetime, mayStore, parseCacheControl, remainingTtl } from './sharedCache'

describe('共有キャッシュ（RFC 9111）', () => {
  const api = parseCacheControl('max-age=0, s-maxage=60')
  const me = parseCacheControl('private, max-age=60')

  it('Cache-Control を読む', () => {
    expect(api).toEqual({ maxAge: 0, sMaxage: 60 })
    expect(me).toEqual({ maxAge: 60, private: true })
  })

  it('s-maxage は共有キャッシュだけが使う（§4.2.1）', () => {
    expect(freshnessLifetime(api, true)).toBe(60)
    expect(freshnessLifetime(api, false)).toBe(0)
  })

  it('共有キャッシュは private を保存しない（§3、§5.2.2.7）', () => {
    expect(mayStore({ shared: true, requestHasAuthorization: true, cc: me })).toBe(false)
    expect(mayStore({ shared: false, requestHasAuthorization: true, cc: me })).toBe(true)
  })

  it('Authorization 付きの要求への応答は、must-revalidate・public・s-maxage のどれかがあるときだけ（§3.5）', () => {
    const plain = parseCacheControl('max-age=60')
    expect(mayStore({ shared: true, requestHasAuthorization: true, cc: plain })).toBe(false)
    expect(mayStore({ shared: true, requestHasAuthorization: false, cc: plain })).toBe(true)
    for (const value of ['max-age=60, public', 'max-age=60, must-revalidate', 's-maxage=60']) {
      expect(
        mayStore({ shared: true, requestHasAuthorization: true, cc: parseCacheControl(value) }),
      ).toBe(true)
    }
    expect(
      mayStore({ shared: true, requestHasAuthorization: false, cc: parseCacheControl('no-store') }),
    ).toBe(false)
  })

  it('20 秒たった s-maxage=60 の応答の残りは 40 秒', () => {
    expect(remainingTtl(60, 20)).toBe(40)
  })
})
