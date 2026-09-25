import { Navigate, useLocation } from 'react-router'
import { detectLocale, leadingLanguageTag, readPreferredLocale, replaceLocale } from '@/lib/i18n'

/**
 * ロケールのない（または対応外のロケールの）パスを、ロケール付きのパスへリダイレクトする。
 * ロケールは URL の言語タグ（`/ja-JP/...` など）→ 保存済みの設定 → ブラウザーの言語 → デフォルトの順で決め、
 * クエリとハッシュは保持する。
 */
export function LocaleRedirect() {
  const { pathname, search, hash } = useLocation()
  const locale = detectLocale({
    pathTag: leadingLanguageTag(pathname),
    stored: readPreferredLocale(),
    languages: navigator.languages,
  })

  return <Navigate to={{ pathname: replaceLocale(pathname, locale), search, hash }} replace />
}
