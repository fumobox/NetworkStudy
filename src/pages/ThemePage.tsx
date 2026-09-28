import { Suspense, useId, type ReactNode } from 'react'
import { useParams } from 'react-router'
import { OverviewSection } from '@/components/features/overview/OverviewSection'
import { QuizPanel } from '@/components/features/quiz/QuizPanel'
import { DifficultyBadge } from '@/components/features/theme-card/DifficultyBadge'
import { findTheme } from '@/content/registry'
import { CATEGORY_TONE } from '@/content/themeTone'
import type { CustomThemeModule, SequenceThemeModule, ThemeModule } from '@/content/types'
import { ScenarioPlayer } from '@/engine/ui/ScenarioPlayer'
import { useDocumentDescription } from '@/lib/hooks/useDocumentDescription'
import { useLocale, useMessages, useText } from '@/lib/i18n'
import { TONE_CLASSES } from '@/lib/tone'
import { cn } from '@/lib/utils'
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
        {/* タイトルの塊の下に、分類の色の線を引く */}
        <header
          className={cn(
            'space-y-2 border-b-2 pb-8',
            TONE_CLASSES[CATEGORY_TONE[theme.meta.category]].border,
          )}
        >
          <h1 className="font-heading text-3xl font-bold tracking-tight">{title}</h1>
          <p className="text-muted-foreground">{t(theme.meta.summary)}</p>
          <p className="flex items-center gap-3 text-xs text-muted-foreground">
            <DifficultyBadge difficulty={theme.meta.difficulty} />
            <span>{m.theme.minutes({ minutes: theme.meta.minutes })}</span>
          </p>
        </header>
        <ThemeSection title={m.theme.overview} divider={false}>
          <OverviewSection content={theme.overview[locale]} />
        </ThemeSection>
        {theme.kind === 'sequence' ? (
          <ThemeSection title={m.theme.player}>
            {/* 読む部分と操作する部分を分けるため、枠で囲む */}
            <div className="rounded-xl border p-4 sm:p-6">
              <SequenceBody theme={theme} />
            </div>
          </ThemeSection>
        ) : (
          // 独自の UI は自分の見出し（h2）を持つので、区切りだけを付ける
          <Divider>
            <CustomBody theme={theme} />
          </Divider>
        )}
        {/* 理解度クイズも自分の見出し（h2）を持つ */}
        <Divider>
          <QuizPanel quiz={theme.quiz} />
        </Divider>
      </article>
    </>
  )
}

const DIVIDER = 'border-t pt-10'

/** ページの塊（概要、ステップ実行）。見出し（h2）と上の区切り線を付ける */
function ThemeSection({
  title,
  divider = true,
  children,
}: {
  title: string
  divider?: boolean
  children: ReactNode
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className={cn('space-y-6', divider && DIVIDER)}>
      <h2 id={id} className="font-heading text-2xl font-bold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  )
}

/** 自分の見出しを持つ塊（独自の UI、理解度クイズ）の上に区切り線を付ける */
function Divider({ children }: { children: ReactNode }) {
  return <div className={DIVIDER}>{children}</div>
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
