import { Route } from 'lucide-react'
import { Link } from 'react-router'
import type { QuizProgressSummary } from '@/components/features/quiz/progress'
import type { LearningPath } from '@/content/learningPaths'
import { pathMinutes } from '@/content/learningPathNav'
import { localePath, useLocale, useMessages, useText } from '@/lib/i18n'

interface PathCardProps {
  path: LearningPath
  progress: QuizProgressSummary
}

/** ホームの、道筋の入口のカード。道筋は色ではなく名前で見分ける */
export function PathCard({ path, progress }: PathCardProps) {
  const m = useMessages()
  const t = useText()
  const locale = useLocale()

  return (
    <article className="relative flex h-full gap-4 rounded-lg border p-4 transition-colors hover:bg-muted/50">
      <Route aria-hidden className="mt-0.5 size-6 shrink-0 text-primary" />
      <div className="min-w-0">
        <h3 className="font-heading font-semibold">
          {/* カード全体をクリックできるようにする（リンクの名前は道筋の名前だけにする） */}
          <Link
            to={localePath(locale, `/paths/${path.id}`)}
            className="after:absolute after:inset-0 after:content-['']"
          >
            {t(path.title)}
          </Link>
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{t(path.summary)}</p>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{m.paths.themeCount({ count: path.themeIds.length })}</span>
          <span>{m.theme.minutes({ minutes: pathMinutes(path) })}</span>
          {progress.started && <span>{m.paths.progress(progress)}</span>}
        </p>
      </div>
    </article>
  )
}
