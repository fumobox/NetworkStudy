import { THEME_META, type ThemeMeta } from '@/content/themeMeta'
import { DEFAULT_LOCALE, LOCALES, type Locale } from '@/lib/i18n/locale'
import { MESSAGES } from '@/lib/i18n/messages'
import { outputPath, type PageMeta } from './lib'

export interface PlannedPage {
  file: string
  locale: Locale | null
  route: string
  meta: PageMeta
}

/** URL とファイルパスに使うため、テーマ ID は英小文字・数字・ハイフンに限る */
const THEME_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** テーマの情報を持つかどうかで区別したルート。ホームは theme が null */
interface PlannedRoute {
  route: string
  theme: Pick<ThemeMeta, 'id' | 'title' | 'summary'> | null
}

function metaFor(locale: Locale, theme: PlannedRoute['theme']): PageMeta {
  const m = MESSAGES[locale]
  if (theme === null) {
    return { lang: locale, title: m.common.siteName, description: m.common.tagline }
  }
  return {
    lang: locale,
    title: m.common.pageTitle({ page: theme.title[locale], site: m.common.siteName }),
    description: theme.summary[locale],
  }
}

/**
 * 生成するページの一覧。
 * ロケールなしのページ（`/`、`/themes/<id>/`）は、SPA がロケール付きの URL へリダイレクトする。
 * hreflang の x-default の参照先でもあるため、ルートごとに生成して 200 で返す。
 */
export function plannedPages(
  themes: readonly Pick<ThemeMeta, 'id' | 'title' | 'summary'>[] = THEME_META,
): PlannedPage[] {
  const invalid = themes.map((theme) => theme.id).filter((id) => !THEME_ID_PATTERN.test(id))
  if (invalid.length > 0) {
    throw new Error(`テーマ ID の形式が不正です: ${invalid.join(', ')}`)
  }
  const routes: PlannedRoute[] = [
    { route: '', theme: null },
    ...themes.map((theme) => ({ route: `themes/${theme.id}`, theme })),
  ]
  return [
    ...routes.map(({ route, theme }) => ({
      file: outputPath(null, route),
      locale: null,
      route,
      meta: metaFor(DEFAULT_LOCALE, theme),
    })),
    ...LOCALES.flatMap((locale) =>
      routes.map(({ route, theme }) => ({
        file: outputPath(locale, route),
        locale,
        route,
        meta: metaFor(locale, theme),
      })),
    ),
  ]
}
