// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCALE, isLocale, LOCALES, pickText } from './locale'

describe('isLocale', () => {
  it.each(LOCALES)('対応ロケール %s を受け付ける', (locale) => {
    expect(isLocale(locale)).toBe(true)
  })

  it.each([['fr'], ['EN'], [''], [null], [undefined], [1], [{}]])(
    '対応外の値 %j を拒否する',
    (value) => {
      expect(isLocale(value)).toBe(false)
    },
  )
})

describe('DEFAULT_LOCALE', () => {
  it('対応ロケールに含まれる', () => {
    expect(LOCALES).toContain(DEFAULT_LOCALE)
  })
})

describe('pickText', () => {
  it('指定ロケールの訳を返す', () => {
    const text = { en: 'Hello', ja: 'こんにちは' }
    expect(pickText(text, 'en')).toBe('Hello')
    expect(pickText(text, 'ja')).toBe('こんにちは')
  })
})
