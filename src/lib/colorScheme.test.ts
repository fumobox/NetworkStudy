import { describe, expect, it } from 'vitest'
import {
  COLOR_SCHEME_STORAGE_KEY,
  isDark,
  nextColorScheme,
  readColorScheme,
  saveColorScheme,
} from './colorScheme'

describe('colorScheme', () => {
  it('保存がなければ system、保存した値を読み出す。不正な値は system', () => {
    expect(readColorScheme()).toBe('system')
    saveColorScheme('dark')
    expect(readColorScheme()).toBe('dark')
    window.localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, JSON.stringify('purple'))
    expect(readColorScheme()).toBe('system')
  })

  it('isDark は設定と OS の設定から決まる', () => {
    expect(isDark('dark', false)).toBe(true)
    expect(isDark('light', true)).toBe(false)
    expect(isDark('system', true)).toBe(true)
    expect(isDark('system', false)).toBe(false)
  })

  it('system → light → dark → system の順に切り替える', () => {
    expect(nextColorScheme('system')).toBe('light')
    expect(nextColorScheme('light')).toBe('dark')
    expect(nextColorScheme('dark')).toBe('system')
  })
})
