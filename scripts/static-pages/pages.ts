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

/** URL とファイルパスに使うため、テーマ ID は英小文字・数字・ハイフンに限る */
const THEME_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function metaFor(locale: Locale): PageMeta {
  const m = MESSAGES[locale]
  // テーマページのタイトルは、Phase 1 で registry からテーマ名を取れるようになったら差し替える
  return { lang: locale, title: m.common.siteName, description: m.common.tagline }
}

/**
 * 生成するページの一覧。
 * ロケールなしのページ（`/`、`/themes/<id>/`）は、SPA がロケール付きの URL へリダイレクトする。
 * hreflang の x-default の参照先でもあるため、ルートごとに生成して 200 で返す。
 */
export function plannedPages(themeIds: readonly string[] = THEME_IDS): PlannedPage[] {
  const invalid = themeIds.filter((id) => !THEME_ID_PATTERN.test(id))
  if (invalid.length > 0) {
    throw new Error(`テーマ ID の形式が不正です: ${invalid.join(', ')}`)
  }
  const routes = routesFor(themeIds)
  return [
    ...routes.map((route) => ({
      file: outputPath(null, route),
      locale: null,
      route,
      meta: metaFor(DEFAULT_LOCALE),
    })),
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
