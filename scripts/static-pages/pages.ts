import { LEARNING_PATHS } from '@/content/learningPaths'
import { THEME_META, type ThemeMeta } from '@/content/themeMeta'
import { DEFAULT_LOCALE, LOCALES, type Locale, type LocalizedText } from '@/lib/i18n/locale'
import { MESSAGES } from '@/lib/i18n/messages'
import { outputPath, type PageMeta } from './lib'

export interface PlannedPage {
  file: string
  locale: Locale | null
  route: string
  meta: PageMeta
}

/** URL とファイルパスに使うため、テーマと道筋の ID は英小文字・数字・ハイフンに限る */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

type PageTheme = Pick<ThemeMeta, 'id' | 'title' | 'summary'>
/** 道筋のページに要るもの（テストでは任意の ID で作れるよう、ID を string にする） */
interface PagePath {
  readonly id: string
  readonly title: LocalizedText
  readonly summary: LocalizedText
}

/** ルートと、そのページの種類 */
interface PlannedRoute {
  route: string
  page:
    | { readonly kind: 'home' }
    | { readonly kind: 'theme'; readonly theme: PageTheme }
    | { readonly kind: 'path'; readonly path: PagePath }
}

function metaFor(locale: Locale, page: PlannedRoute['page']): PageMeta {
  const m = MESSAGES[locale]
  const site = m.common.siteName
  switch (page.kind) {
    case 'home':
      return { lang: locale, title: site, description: m.common.tagline }
    case 'theme':
      return {
        lang: locale,
        title: m.common.pageTitle({ page: page.theme.title[locale], site }),
        description: page.theme.summary[locale],
      }
    case 'path':
      return {
        lang: locale,
        title: m.common.pageTitle({
          page: m.paths.pageTitle({ path: page.path.title[locale] }),
          site,
        }),
        description: page.path.summary[locale],
      }
  }
}

function assertSlugs(label: string, ids: readonly string[]): void {
  const invalid = ids.filter((id) => !SLUG_PATTERN.test(id))
  if (invalid.length > 0) {
    throw new Error(`${label}の形式が不正です: ${invalid.join(', ')}`)
  }
}

interface PlannedPagesOptions {
  readonly themes?: readonly PageTheme[]
  readonly paths?: readonly PagePath[]
}

/**
 * 生成するページの一覧。
 * ロケールなしのページ（`/`、`/themes/<id>/`、`/paths/<id>/`）は、SPA がロケール付きの URL へリダイレクトする。
 * hreflang の x-default の参照先でもあるため、ルートごとに生成して 200 で返す。
 */
export function plannedPages({
  themes = THEME_META,
  paths = LEARNING_PATHS,
}: PlannedPagesOptions = {}): PlannedPage[] {
  assertSlugs(
    'テーマ ID ',
    themes.map((theme) => theme.id),
  )
  assertSlugs(
    '道筋 ID ',
    paths.map((path) => path.id),
  )
  const routes: PlannedRoute[] = [
    { route: '', page: { kind: 'home' } },
    ...themes.map((theme) => ({
      route: `themes/${theme.id}`,
      page: { kind: 'theme', theme } as const,
    })),
    ...paths.map((path) => ({ route: `paths/${path.id}`, page: { kind: 'path', path } as const })),
  ]
  return [
    ...routes.map(({ route, page }) => ({
      file: outputPath(null, route),
      locale: null,
      route,
      meta: metaFor(DEFAULT_LOCALE, page),
    })),
    ...LOCALES.flatMap((locale) =>
      routes.map(({ route, page }) => ({
        file: outputPath(locale, route),
        locale,
        route,
        meta: metaFor(locale, page),
      })),
    ),
  ]
}
