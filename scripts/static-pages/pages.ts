import { THEME_IDS } from '@/content/themeIds'
import { DEFAULT_LOCALE, LOCALES, type Locale } from '@/lib/i18n/locale'
import { MESSAGES } from '@/lib/i18n/messages'
import { outputPath, routesFor, type PageMeta } from './lib'

export interface PlannedPage {
  file: string
  locale: Locale | null
  route: string
  meta: PageMeta
}

function metaFor(locale: Locale): PageMeta {
  const m = MESSAGES[locale]
  // テーマページのタイトルは、Phase 1 で registry からテーマ名を取れるようになったら差し替える
  return { lang: locale, title: m.common.siteName, description: m.common.tagline }
}

/** 生成するページの一覧（ルートのリダイレクト用 index.html を含む） */
export function plannedPages(): PlannedPage[] {
  const routes = routesFor(THEME_IDS)
  return [
    { file: 'index.html', locale: null, route: '', meta: metaFor(DEFAULT_LOCALE) },
    ...LOCALES.flatMap((locale) =>
      routes.map((route) => ({
        file: outputPath(locale, route),
        locale,
        route,
        meta: metaFor(locale),
      })),
    ),
  ]
}
