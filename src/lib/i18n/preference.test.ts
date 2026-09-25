import { describe, expect, it } from 'vitest'
import { LOCALE_STORAGE_KEY, readPreferredLocale, savePreferredLocale } from './preference'

describe('preferred locale', () => {
  it('保存したロケールを読み出す', () => {
    savePreferredLocale('ja')
    expect(readPreferredLocale()).toBe('ja')
  })

  it('対応外の値が保存されていれば null', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, JSON.stringify('fr'))
    expect(readPreferredLocale()).toBeNull()
  })
})
