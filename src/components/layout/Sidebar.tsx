import { useId } from 'react'
import { NavLink } from 'react-router'
import { groupByCategory, THEME_META } from '@/content/themeMeta'
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
  const baseId = useId()

  return (
    <nav aria-label={m.nav.themes} className="space-y-2">
      <h2 className="px-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {m.nav.themes}
      </h2>
      {groupByCategory(THEME_META).map((group) => {
        const headingId = `${baseId}-${group.category}`
        return (
          <div key={group.category} className="space-y-1 pt-2">
            <h3 id={headingId} className="px-2 text-xs font-medium text-muted-foreground">
              {m.categories[group.category].title}
            </h3>
            <ul aria-labelledby={headingId} className="space-y-1">
              {group.themes.map((theme) => (
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
          </div>
        )
      })}
    </nav>
  )
}
