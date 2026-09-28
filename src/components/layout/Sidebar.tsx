import { useId } from 'react'
import { NavLink } from 'react-router'
import { groupByCategory, THEME_META } from '@/content/themeMeta'
import { CATEGORY_TONE } from '@/content/themeTone'
import { localePath, useLocale, useMessages, useText } from '@/lib/i18n'
import { TONE_CLASSES } from '@/lib/tone'
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
      {groupByCategory(THEME_META).map((group, index) => {
        const headingId = `${baseId}-${group.category}`
        return (
          // 分類の間に区切り線を引く（最初の分類の上には引かない）
          <div
            key={group.category}
            className={cn('space-y-1', index === 0 ? 'pt-2' : 'mt-3 border-t pt-4')}
          >
            <h3
              id={headingId}
              className="flex items-center gap-2 px-2 text-xs font-semibold text-foreground"
            >
              <span
                aria-hidden
                className={cn(
                  'size-2 rounded-full',
                  TONE_CLASSES[CATEGORY_TONE[group.category]].bg,
                )}
              />
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
                        isActive && 'bg-accent font-medium text-primary',
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
