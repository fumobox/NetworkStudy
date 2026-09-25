import type { Locale } from './locale'

/** 言語タグらしい形（`en`, `fr`, `ja-JP`, `zh-Hant` など）の先頭セグメント */
const LANGUAGE_TAG_SEGMENT = /^[a-z]{2}(?:-[a-z0-9]{2,4})?$/i

/** ロケール付きのパスを作る。`localePath('ja', '/themes/tcp')` → `/ja/themes/tcp` */
export function localePath(locale: Locale, path = '/'): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return normalized === '/' ? `/${locale}` : `/${locale}${normalized}`
}

/**
 * パス先頭の言語タグらしいセグメントを取り除く。
 * `/fr/themes/tcp` → `/themes/tcp`、`/themes/tcp` → `/themes/tcp`（そのまま）
 */
export function stripLocaleSegment(pathname: string): string {
  const [, first = '', ...rest] = pathname.split('/')
  if (!LANGUAGE_TAG_SEGMENT.test(first)) {
    return pathname === '' ? '/' : pathname
  }
  return `/${rest.join('/')}`
}

/** パスのロケールを差し替える。先頭に言語タグがなければ付け足す */
export function replaceLocale(pathname: string, locale: Locale): string {
  return localePath(locale, stripLocaleSegment(pathname))
}
