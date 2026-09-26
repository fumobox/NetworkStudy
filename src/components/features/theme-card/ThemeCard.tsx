import { Link } from 'react-router'
import type { ThemeMeta } from '@/content/themeMeta'
import { localePath, useLocale, useMessages, useText } from '@/lib/i18n'

interface ThemeCardProps {
  theme: ThemeMeta
  /** 推奨の学習順での番号（1 始まり） */
  order?: number
  /** クイズの進捗。null なら未挑戦 */
  progress?: { readonly correct: number; readonly total: number } | null
}

export function ThemeCard({ theme, order, progress }: ThemeCardProps) {
  const m = useMessages()
  const t = useText()
  const locale = useLocale()

  return (
    <article className="relative flex h-full gap-4 rounded-lg border p-4 transition-colors hover:bg-muted/50">
      {order !== undefined && (
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-sm font-semibold text-primary-foreground"
        >
          {order}
        </span>
      )}
      <div className="min-w-0">
        {/* ホームでは分類の見出し（h3）の下に置く */}
        <h4 className="font-heading font-semibold">
          {/* カード全体をクリックできるようにする（リンクの名前はタイトルだけにする） */}
          <Link
            to={localePath(locale, `/themes/${theme.id}`)}
            className="after:absolute after:inset-0 after:content-['']"
          >
            {t(theme.title)}
          </Link>
        </h4>
        <p className="mt-1 text-sm text-muted-foreground">{t(theme.summary)}</p>
        <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{m.theme.difficulty[theme.difficulty]}</span>
          <span>{m.theme.minutes({ minutes: theme.minutes })}</span>
          {progress !== undefined && (
            <span>{progress === null ? m.home.notStarted : m.home.progress(progress)}</span>
          )}
        </p>
      </div>
    </article>
  )
}
