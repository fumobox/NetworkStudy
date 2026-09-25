import { NavLink } from 'react-router'
import { THEME_META } from '@/content/themeMeta'
import { localePath, useLocale, useMessages, useText } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface SidebarProps {
  /** リンクを押したときに呼ぶ（スマホのメニューを閉じるため） */
  onNavigate?: () => void
}

/** テーマの一覧（広い画面で左側、狭い画面ではメニューの中に表示する） */
export function Sidebar({ onNavigate }: SidebarProps) {
  const m = useMessages()
  const t = useText()
  const locale = useLocale()

  return (
    <nav aria-label={m.nav.themes} className="space-y-2">
      <h2 className="px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {m.nav.themes}
      </h2>
      <ul className="space-y-1">
        {THEME_META.map((theme) => (
          <li key={theme.id}>
            <NavLink
              to={localePath(locale, `/themes/${theme.id}`)}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'block rounded-md px-2 py-1.5 text-sm hover:bg-muted',
                  isActive && 'bg-accent font-medium',
                )
              }
            >
              {t(theme.title)}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
