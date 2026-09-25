import { Suspense } from 'react'
import { useParams } from 'react-router'
import { OverviewSection } from '@/components/features/overview/OverviewSection'
import { QuizPanel } from '@/components/features/quiz/QuizPanel'
import { findTheme } from '@/content/registry'
import type { CustomThemeModule, SequenceThemeModule, ThemeModule } from '@/content/types'
import { ScenarioPlayer } from '@/engine/ui/ScenarioPlayer'
import { useDocumentDescription } from '@/lib/hooks/useDocumentDescription'
import { useLocale, useMessages, useText } from '@/lib/i18n'
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
  const locale = useLocale()
  const title = t(theme.meta.title)
  useDocumentDescription(t(theme.meta.summary))

  return (
    <>
      <title>{m.common.pageTitle({ page: title, site: m.common.siteName })}</title>
      <article className="space-y-10">
        <header className="space-y-2">
          <h1 className="font-heading text-3xl font-bold tracking-tight">{title}</h1>
          <p className="text-muted-foreground">{t(theme.meta.summary)}</p>
          <p className="flex gap-3 text-xs text-muted-foreground">
            <span>{m.theme.difficulty[theme.meta.difficulty]}</span>
            <span>{m.theme.minutes({ minutes: theme.meta.minutes })}</span>
          </p>
        </header>
        <OverviewSection content={theme.overview[locale]} />
        {theme.kind === 'sequence' ? <SequenceBody theme={theme} /> : <CustomBody theme={theme} />}
        <QuizPanel quiz={theme.quiz} />
      </article>
    </>
  )
}

function SequenceBody({ theme }: { theme: SequenceThemeModule }) {
  return (
    <ScenarioPlayer
      scenario={theme.scenario}
      {...(theme.panels === undefined
        ? {}
        : {
            renderPanels: theme.panels.render,
            hiddenStateKeys: theme.panels.hiddenStateKeys,
          })}
    />
  )
}

function CustomBody({ theme }: { theme: CustomThemeModule }) {
  const m = useMessages()
  const Body = theme.body
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">{m.theme.loading}</p>}>
      <Body />
    </Suspense>
  )
}
