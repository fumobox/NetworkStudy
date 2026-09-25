// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatNumber, formatSeconds, toBcp47 } from './format'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('formatNumber', () => {
  it('ロケールに対応する言語タグとオプションを Intl.NumberFormat に渡す', () => {
    const spy = vi.spyOn(Intl, 'NumberFormat')
    formatNumber('ja', 1234, { style: 'percent' })
    expect(spy).toHaveBeenCalledWith('ja-JP', { style: 'percent' })
  })

  it('桁区切りした文字列を返す', () => {
    expect(formatNumber('en', 1234567)).toBe('1,234,567')
    expect(formatNumber('en', 0.5, { style: 'percent' })).toBe('50%')
  })
})

describe('formatSeconds', () => {
  it('ミリ秒を秒として整形する', () => {
    expect(formatSeconds('en', 1500)).toBe('1.5s')
    expect(formatSeconds('en', 3000)).toBe('3s')
    expect(formatSeconds('ja', 1000)).toBe('1 秒')
    expect(formatSeconds('ja', 1500)).toBe('1.5 秒')
    expect(formatSeconds('en', 250)).toBe('0.3s')
  })
})

describe('toBcp47', () => {
  it('BCP 47 の言語タグを返す', () => {
    expect(toBcp47('en')).toBe('en-US')
    expect(toBcp47('ja')).toBe('ja-JP')
  })

  it('実行環境の ICU が各ロケールに対応している', () => {
    for (const locale of ['en', 'ja'] as const) {
      const tag = toBcp47(locale)
      expect(new Intl.NumberFormat(tag).resolvedOptions().locale).toBe(tag)
    }
  })
})
