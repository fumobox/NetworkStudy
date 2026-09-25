import { useEffect } from 'react'
import { useParams } from 'react-router'
import { AppLayout } from '@/components/layout/AppLayout'
import { isLocale, LocaleProvider, type Locale } from '@/lib/i18n'
import { LocaleRedirect } from './LocaleRedirect'

/** `/:locale` 配下の共通レイアウト。ロケールを検証し、LocaleProvider と <html lang> を設定する */
export function LocaleLayout() {
  const { locale } = useParams()
  if (!isLocale(locale)) {
    return <LocaleRedirect />
  }

  return (
    <LocaleProvider locale={locale}>
      <DocumentLang locale={locale} />
      <AppLayout />
    </LocaleProvider>
  )
}

function DocumentLang({ locale }: { locale: Locale }) {
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  return null
}
