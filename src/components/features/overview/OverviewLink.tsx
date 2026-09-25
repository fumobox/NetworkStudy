import type { ComponentPropsWithoutRef } from 'react'
import { Link } from 'react-router'
import { localePath, useLocale } from '@/lib/i18n'

/**
 * 概要（MDX）のリンク。サイト内のリンクは `[DNS の名前解決](/themes/dns-resolution)` のようにロケールなしのパスで書き、
 * 表示中のロケールを付けてルーターの Link にする（ページを読み込み直さない。basename も付く）。
 * それ以外（http などの外部リンク、ページ内の #）は、そのまま a にする
 */
export function OverviewLink({ href, ...props }: ComponentPropsWithoutRef<'a'>) {
  const locale = useLocale()
  if (href?.startsWith('/') === true) {
    return <Link to={localePath(locale, href)} {...props} />
  }
  return <a href={href} {...props} />
}
