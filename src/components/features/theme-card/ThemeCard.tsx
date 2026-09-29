import { Link } from 'react-router'
import type { LearningPathId } from '@/content/learningPaths'
import { themeSearch } from '@/content/learningPathNav'
import type { ThemeMeta } from '@/content/themeMeta'
import { CATEGORY_TONE } from '@/content/themeTone'
import { localePath, useLocale, useMessages, useText } from '@/lib/i18n'
import { TONE_CLASSES } from '@/lib/tone'
import { cn } from '@/lib/utils'
import { DifficultyBadge } from './DifficultyBadge'

interface ThemeCardProps {
  theme: ThemeMeta
  /** 推奨の学習順での番号（1 始まり） */
  order?: number
  /** クイズの進捗。null なら未挑戦 */
  progress?: { readonly correct: number; readonly total: number } | null
  /** 見出しの階層。ホームは分類の見出し（h3）の下なので h4、道筋のページは h2 の下なので h3 */
  headingLevel?: 3 | 4
  /** 道筋のページから開くとき、テーマのページで道筋の中の位置を示すため ?path= を付ける */
  pathId?: LearningPathId
}

export function ThemeCard({ theme, order, progress, headingLevel = 4, pathId }: ThemeCardProps) {
  const m = useMessages()
  const t = useText()
  const locale = useLocale()
  const tone = TONE_CLASSES[CATEGORY_TONE[theme.category]]
  const Heading = headingLevel === 3 ? 'h3' : 'h4'
  const pathname = localePath(locale, `/themes/${theme.id}`)

  return (
    <article
      className={cn(
        'relative flex h-full gap-4 rounded-lg border border-t-4 p-4 transition-colors hover:bg-muted/50',
        tone.border,
      )}
    >
      {order !== undefined && (
        <span
          aria-hidden
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full font-mono text-sm font-semibold text-background',
            tone.bg,
          )}
        >
          {order}
        </span>
      )}
      <div className="min-w-0">
        <Heading className="font-heading font-semibold">
          {/* カード全体をクリックできるようにする（リンクの名前はタイトルだけにする） */}
          <Link
            to={pathId === undefined ? pathname : { pathname, search: themeSearch(pathId) }}
            className="after:absolute after:inset-0 after:content-['']"
          >
            {t(theme.title)}
          </Link>
        </Heading>
        <p className="mt-1 text-sm text-muted-foreground">{t(theme.summary)}</p>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <DifficultyBadge difficulty={theme.difficulty} />
          <span>{m.theme.minutes({ minutes: theme.minutes })}</span>
          {progress !== undefined && (
            <span>{progress === null ? m.home.notStarted : m.home.progress(progress)}</span>
          )}
        </p>
      </div>
    </article>
  )
}
