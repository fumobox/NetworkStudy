import { Link } from 'react-router'
import type { ThemeMeta } from '@/content/themeMeta'
import { localePath, useLocale, useMessages, useText } from '@/lib/i18n'

interface ThemeCardProps {
  theme: ThemeMeta
}

export function ThemeCard({ theme }: ThemeCardProps) {
  const m = useMessages()
  const t = useText()
  const locale = useLocale()

  return (
    <article className="relative rounded-lg border p-4 transition-colors hover:bg-muted/50">
      <h3 className="font-heading font-semibold">
        {/* カード全体をクリックできるようにする（リンクの名前はタイトルだけにする） */}
        <Link
          to={localePath(locale, `/themes/${theme.id}`)}
          className="after:absolute after:inset-0 after:content-['']"
        >
          {t(theme.title)}
        </Link>
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{t(theme.summary)}</p>
      <p className="mt-3 flex gap-3 text-xs text-muted-foreground">
        <span>{m.theme.difficulty[theme.difficulty]}</span>
        <span>{m.theme.minutes({ minutes: theme.minutes })}</span>
      </p>
    </article>
  )
}
