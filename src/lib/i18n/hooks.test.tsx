import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { useLocale, useMessages, useText } from './hooks'
import type { Locale } from './locale'
import { LocaleProvider } from './LocaleProvider'

function wrapperFor(locale: Locale) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <LocaleProvider locale={locale}>{children}</LocaleProvider>
  }
}

describe('i18n hooks', () => {
  it('useLocale は Provider のロケールを返す', () => {
    const { result } = renderHook(() => useLocale(), { wrapper: wrapperFor('ja') })
    expect(result.current).toBe('ja')
  })

  it('useLocale は Provider の外で呼ぶと例外を投げる', () => {
    expect(() => renderHook(() => useLocale())).toThrow(/LocaleProvider/)
  })

  it('useMessages は現在のロケールの辞書を返す', () => {
    const { result } = renderHook(() => useMessages(), { wrapper: wrapperFor('ja') })
    expect(result.current.nav.home).toBe('ホーム')
  })

  it('useText は LocalizedText を現在のロケールで解決する', () => {
    const { result } = renderHook(() => useText(), { wrapper: wrapperFor('en') })
    expect(result.current({ en: 'Handshake', ja: 'ハンドシェイク' })).toBe('Handshake')
  })
})
