// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { formatNumber, toBcp47 } from './format'

describe('formatNumber', () => {
  it('ロケールに応じて桁区切りする', () => {
    expect(formatNumber('en', 1234567)).toBe('1,234,567')
    expect(formatNumber('ja', 1234567)).toBe('1,234,567')
  })

  it('Intl.NumberFormat のオプションを渡せる', () => {
    expect(formatNumber('en', 0.5, { style: 'percent' })).toBe('50%')
  })
})

describe('toBcp47', () => {
  it('BCP 47 の言語タグを返す', () => {
    expect(toBcp47('en')).toBe('en-US')
    expect(toBcp47('ja')).toBe('ja-JP')
  })
})
