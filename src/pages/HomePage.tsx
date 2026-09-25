import { ThemeCard } from '@/components/features/theme-card/ThemeCard'
import { readQuizAnswers, scoreQuiz } from '@/components/features/quiz/useQuizProgress'
import { THEMES } from '@/content/registry'
import { useDocumentDescription } from '@/lib/hooks/useDocumentDescription'
import { useMessages } from '@/lib/i18n'

export function HomePage() {
  const m = useMessages()
  useDocumentDescription(m.common.tagline)

  return (
    <>
      <title>{m.common.siteName}</title>
      <div className="space-y-12">
        <section className="space-y-3">
          <h1 className="font-heading text-3xl font-bold tracking-tight">{m.common.siteName}</h1>
          <p className="text-lg text-muted-foreground">{m.common.tagline}</p>
        </section>

        <section aria-labelledby="home-order" className="space-y-4">
          <div className="space-y-1">
            <h2 id="home-order" className="font-heading text-xl font-semibold">
              {m.home.orderTitle}
            </h2>
            <p className="text-sm text-muted-foreground">{m.home.orderLead}</p>
          </div>
          {/* THEMES は推奨の学習順に並んでいる */}
          <ol className="grid gap-4 md:grid-cols-3">
            {THEMES.map((theme, i) => {
              const answers = readQuizAnswers(theme.quiz)
              const score = scoreQuiz(theme.quiz, answers)
              return (
                <li key={theme.meta.id}>
                  <ThemeCard
                    theme={theme.meta}
                    order={i + 1}
                    progress={score.answered === 0 ? null : score}
                  />
                </li>
              )
            })}
          </ol>
        </section>

        <section aria-labelledby="home-how-to" className="space-y-3">
          <h2 id="home-how-to" className="font-heading text-xl font-semibold">
            {m.home.howToTitle}
          </h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {m.home.howTo.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </section>
      </div>
    </>
  )
}
