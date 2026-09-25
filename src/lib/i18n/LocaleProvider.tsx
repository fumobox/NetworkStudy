import type { ReactNode } from 'react'
import { LocaleContext } from './context'
import type { Locale } from './locale'

interface LocaleProviderProps {
  locale: Locale
  children: ReactNode
}

export function LocaleProvider({ locale, children }: LocaleProviderProps) {
  return <LocaleContext value={locale}>{children}</LocaleContext>
}
