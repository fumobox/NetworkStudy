import { useCallback, useContext } from 'react'
import { LocaleContext } from './context'
import { pickText, type Locale, type LocalizedText } from './locale'
import { MESSAGES, type Messages } from './messages'

export function useLocale(): Locale {
  const locale = useContext(LocaleContext)
  if (locale === null) {
    throw new Error('useLocale must be used within <LocaleProvider>')
  }
  return locale
}

export function useMessages(): Messages {
  return MESSAGES[useLocale()]
}

/** `LocalizedText` を現在のロケールで解決する関数を返す */
export function useText(): (text: LocalizedText) => string {
  const locale = useLocale()
  return useCallback((text: LocalizedText) => pickText(text, locale), [locale])
}
