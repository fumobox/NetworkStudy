import { Link, useParams } from 'react-router'
import { readQuizScores, summarizeQuizProgress } from '@/components/features/quiz/progress'
import { ThemeCard } from '@/components/features/theme-card/ThemeCard'
import { Button } from '@/components/ui/button'
import { pathMinutes, themeSearch } from '@/content/learningPathNav'
import { findLearningPath, type LearningPath } from '@/content/learningPaths'
import { THEME_QUIZZES } from '@/content/quizzes'
import { useDocumentDescription } from '@/lib/hooks/useDocumentDescription'
import { localePath, useLocale, useMessages, useText } from '@/lib/i18n'
import { NotFoundPage } from './NotFoundPage'

export function PathPage() {
  const { path: pathId } = useParams()
  const path = findLearningPath(pathId)
  if (path === undefined) {
    return <NotFoundPage />
  }
  return <PathView path={path} />
}

function PathView({ path }: { path: LearningPath }) {
  const m = useMessages()
  const t = useText()
  const locale = useLocale()
  const title = t(path.title)
  useDocumentDescription(t(path.summary))

  // 表示のたびに localStorage を読む（他のタブの回答は、開き直すまで反映しない）
  const scores = readQuizScores(THEME_QUIZZES)
  const summary = summarizeQuizProgress(path.themeIds, scores)
  const themes = path.themeIds.flatMap((id) => {
    const theme = THEME_QUIZZES.find((candidate) => candidate.meta.id === id)
    return theme === undefined ? [] : [theme]
  })
  const next = themes.find((theme) => theme.meta.id === summary.nextThemeId)

  return (
    <>
      <title>
        {m.common.pageTitle({ page: m.paths.pageTitle({ path: title }), site: m.common.siteName })}
      </title>
      <div className="space-y-10">
        <header className="space-y-2">
          <h1 className="font-heading text-3xl font-bold tracking-tight">{title}</h1>
          <p className="text-muted-foreground">{t(path.summary)}</p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{m.paths.themeCount({ count: path.themeIds.length })}</span>
            <span>{m.theme.minutes({ minutes: pathMinutes(path) })}</span>
          </p>
        </header>

        {/* 初めての訪問では「0 / N」を出さない。1 問でも答えたら出す */}
        {summary.started && (
          <section aria-labelledby="path-progress" className="space-y-1">
            <h2 id="path-progress" className="font-heading text-xl font-semibold">
              {m.paths.progressTitle}
            </h2>
            <p className="text-sm text-muted-foreground">{m.home.overall(summary)}</p>
          </section>
        )}

        {next !== undefined && (
          <Button asChild>
            <Link
              to={{
                pathname: localePath(locale, `/themes/${next.meta.id}`),
                search: themeSearch(path.id),
              }}
            >
              {summary.started ? m.paths.continue({ title: t(next.meta.title) }) : m.paths.start}
            </Link>
          </Button>
        )}

        <section aria-labelledby="path-themes" className="space-y-4">
          <h2 id="path-themes" className="font-heading text-xl font-semibold">
            {m.paths.themesTitle}
          </h2>
          {/* Tailwind の preflight で list-style を消すと Safari（VoiceOver）はリストの意味を落とすので、role="list" で順序を伝える */}
          <ol role="list" className="grid gap-4 md:grid-cols-2">
            {themes.map((theme, i) => {
              const score = scores.get(theme.meta.id)
              return (
                <li key={theme.meta.id}>
                  <ThemeCard
                    theme={theme.meta}
                    order={i + 1}
                    headingLevel={3}
                    pathId={path.id}
                    progress={score === undefined || score.answered === 0 ? null : score}
                  />
                </li>
              )
            })}
          </ol>
        </section>
      </div>
    </>
  )
}
