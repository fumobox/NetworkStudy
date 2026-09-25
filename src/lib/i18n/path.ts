import type { Locale } from './locale'

/** 言語タグらしい形（`en`, `fr`, `ja-JP`, `zh-Hant` など）の先頭セグメント */
const LANGUAGE_TAG_SEGMENT = /^[a-z]{2}(?:-[a-z0-9]{2,4})?$/i

/** ロケール付きのパスを作る。`localePath('ja', '/themes/tcp')` → `/ja/themes/tcp` */
export function localePath(locale: Locale, path = '/'): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return normalized === '/' ? `/${locale}` : `/${locale}${normalized}`
}

/** 連続するスラッシュを 1 つにまとめ、先頭をスラッシュで始める */
function normalizeSlashes(pathname: string): string {
  const collapsed = pathname.replace(/\/{2,}/g, '/')
  return collapsed.startsWith('/') ? collapsed : `/${collapsed}`
}

/** パス先頭のセグメントが言語タグらしい形ならそれを返す。`/ja-JP/x` → `ja-JP`、`/themes/x` → null */
export function leadingLanguageTag(pathname: string): string | null {
  const [, first = ''] = normalizeSlashes(pathname).split('/')
  return LANGUAGE_TAG_SEGMENT.test(first) ? first : null
}

/**
 * パス先頭の言語タグらしいセグメントを取り除く。連続するスラッシュは 1 つにまとめる。
 * `/fr/themes/tcp` → `/themes/tcp`、`/themes/tcp` → `/themes/tcp`（そのまま）
 */
export function stripLocaleSegment(pathname: string): string {
  const normalized = normalizeSlashes(pathname)
  if (leadingLanguageTag(normalized) === null) {
    return normalized
  }
  const [, , ...rest] = normalized.split('/')
  return `/${rest.join('/')}`
}

/** パスのロケールを差し替える。先頭に言語タグがなければ付け足す */
export function replaceLocale(pathname: string, locale: Locale): string {
  return localePath(locale, stripLocaleSegment(pathname))
}
