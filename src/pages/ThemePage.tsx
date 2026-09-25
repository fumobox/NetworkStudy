import { useParams } from 'react-router'
import { QuizPanel } from '@/components/features/quiz/QuizPanel'
import { findTheme } from '@/content/registry'
import type { ThemeModule } from '@/content/types'
import { ScenarioPlayer } from '@/engine/ui/ScenarioPlayer'
import { useMessages, useText } from '@/lib/i18n'
import { NotFoundPage } from './NotFoundPage'

export function ThemePage() {
  const { theme: themeId } = useParams()
  const theme = findTheme(themeId)
  if (theme === undefined) {
    return <NotFoundPage />
  }
  // テーマが変わったら、プレイヤーやクイズの状態を作り直す
  return <ThemeView key={theme.meta.id} theme={theme} />
}

function ThemeView({ theme }: { theme: ThemeModule }) {
  const m = useMessages()
  const t = useText()
  const title = t(theme.meta.title)

  return (
    <>
      <title>{m.common.pageTitle({ page: title, site: m.common.siteName })}</title>
      <meta name="description" content={t(theme.meta.summary)} />
      <article className="space-y-10">
        <header className="space-y-2">
          <h1 className="font-heading text-3xl font-bold tracking-tight">{title}</h1>
          <p className="text-muted-foreground">{t(theme.meta.summary)}</p>
          <p className="flex gap-3 text-xs text-muted-foreground">
            <span>{m.theme.difficulty[theme.meta.difficulty]}</span>
            <span>{m.theme.minutes({ minutes: theme.meta.minutes })}</span>
          </p>
        </header>
        <ScenarioPlayer scenario={theme.scenario} />
        <QuizPanel quiz={theme.quiz} />
      </article>
    </>
  )
}
