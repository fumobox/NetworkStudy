import { Link, useLocation } from 'react-router'
import { Button } from '@/components/ui/button'
import {
  LOCALE_NAMES,
  LOCALES,
  replaceLocale,
  savePreferredLocale,
  useLocale,
  useMessages,
} from '@/lib/i18n'

/** 言語切替。パス先頭のロケールだけを差し替え、クエリとハッシュは保持する */
export function LanguageSwitcher() {
  const current = useLocale()
  const m = useMessages()
  const { pathname, search, hash } = useLocation()

  return (
    <nav aria-label={m.language.label}>
      <ul className="flex gap-1">
        {LOCALES.map((locale) => {
          const isCurrent = locale === current
          return (
            <li key={locale}>
              <Button asChild variant={isCurrent ? 'secondary' : 'ghost'} size="sm">
                <Link
                  to={{ pathname: replaceLocale(pathname, locale), search, hash }}
                  lang={locale}
                  hrefLang={locale}
                  aria-current={isCurrent ? 'page' : undefined}
                  onClick={() => {
                    savePreferredLocale(locale)
                  }}
                >
                  {LOCALE_NAMES[locale]}
                </Link>
              </Button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
