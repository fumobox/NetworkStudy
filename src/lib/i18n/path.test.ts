// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { leadingLanguageTag, localePath, replaceLocale, stripLocaleSegment } from './path'

describe('localePath', () => {
  it.each([
    ['/', '/ja'],
    ['', '/ja'],
    ['/themes/tcp', '/ja/themes/tcp'],
    ['themes/tcp', '/ja/themes/tcp'],
  ])('%j → %j', (path, expected) => {
    expect(localePath('ja', path)).toBe(expected)
  })

  it('パスを省略するとロケールのトップになる', () => {
    expect(localePath('en')).toBe('/en')
  })
})

describe('stripLocaleSegment', () => {
  it.each([
    ['/', '/'],
    ['', '/'],
    ['/en', '/'],
    ['/fr/', '/'],
    ['/fr/themes/tcp', '/themes/tcp'],
    ['/ja-JP/themes/tcp', '/themes/tcp'],
    ['/zh-Hant/x', '/x'],
    ['/themes/tcp', '/themes/tcp'],
    ['/abc/x', '/abc/x'],
    ['//en', '/'],
    ['//fr//themes', '/themes'],
    ['/en//themes', '/themes'],
    // ロケールなしの 2 文字のパスは言語タグとみなす（正規の URL は必ずロケール付きなので許容する）
    ['/ip', '/'],
  ])('%j → %j', (pathname, expected) => {
    expect(stripLocaleSegment(pathname)).toBe(expected)
  })
})

describe('leadingLanguageTag', () => {
  it.each([
    ['/ja-JP/themes', 'ja-JP'],
    ['/fr', 'fr'],
    ['//en', 'en'],
    ['/themes/tcp', null],
    ['/', null],
  ])('%j → %j', (pathname, expected) => {
    expect(leadingLanguageTag(pathname)).toBe(expected)
  })
})

describe('replaceLocale', () => {
  it.each([
    ['/en/themes/tcp', 'ja', '/ja/themes/tcp'],
    ['/ja', 'en', '/en'],
    ['/fr/themes/tcp', 'en', '/en/themes/tcp'],
    ['/themes/tcp', 'en', '/en/themes/tcp'],
    ['/', 'ja', '/ja'],
  ] as const)('%j を %s にすると %j', (pathname, locale, expected) => {
    expect(replaceLocale(pathname, locale)).toBe(expected)
  })
})
