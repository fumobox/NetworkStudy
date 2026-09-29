import { ThemeCard } from '@/components/features/theme-card/ThemeCard'
import { readQuizAnswers, scoreQuiz } from '@/components/features/quiz/useQuizProgress'
import { THEME_QUIZZES } from '@/content/quizzes'
import { groupByCategory } from '@/content/themeMeta'
import { CATEGORY_TONE } from '@/content/themeTone'
import { useDocumentDescription } from '@/lib/hooks/useDocumentDescription'
import { useMessages } from '@/lib/i18n'
import { TONE_CLASSES } from '@/lib/tone'
import { cn } from '@/lib/utils'

export function HomePage() {
  const m = useMessages()
  useDocumentDescription(m.common.tagline)
  // 表示のたびに localStorage を読む（他のタブの回答は、ホームを開き直すまで反映しない）
  const scores = new Map(
    THEME_QUIZZES.map((theme) => [
      theme.meta.id,
      scoreQuiz(theme.quiz, readQuizAnswers(theme.quiz)),
    ]),
  )
  const all = [...scores.values()]
  const overall = {
    finished: all.filter((score) => score.answered === score.total).length,
    themes: all.length,
    correct: all.reduce((sum, score) => sum + score.correct, 0),
    questions: all.reduce((sum, score) => sum + score.total, 0),
  }

  return (
    <>
      <title>{m.common.siteName}</title>
      <div className="space-y-12">
        <section className="space-y-3">
          <h1 className="font-heading text-3xl font-bold tracking-tight">{m.common.siteName}</h1>
          <p className="text-lg text-muted-foreground">{m.common.tagline}</p>
        </section>

        {/* 初めての訪問では「0 / N」を出さない。1 問でも答えたら出す */}
        {all.some((score) => score.answered > 0) && (
          <section aria-labelledby="home-progress" className="space-y-1">
            <h2 id="home-progress" className="font-heading text-xl font-semibold">
              {m.home.overallTitle}
            </h2>
            <p className="text-sm text-muted-foreground">{m.home.overall(overall)}</p>
          </section>
        )}

        <section aria-labelledby="home-order" className="space-y-4">
          <div className="space-y-1">
            <h2 id="home-order" className="font-heading text-xl font-semibold">
              {m.home.orderTitle}
            </h2>
            <p className="text-sm text-muted-foreground">{m.home.orderLead}</p>
          </div>
          {groupByCategory(THEME_QUIZZES).map((group) => {
            const headingId = `home-category-${group.category}`
            const category = m.categories[group.category]
            return (
              <section key={group.category} aria-labelledby={headingId} className="space-y-3">
                <div
                  className={cn(
                    'space-y-1 border-l-4 pl-3',
                    TONE_CLASSES[CATEGORY_TONE[group.category]].border,
                  )}
                >
                  <h3 id={headingId} className="font-heading text-lg font-semibold">
                    {category.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">{category.lead}</p>
                </div>
                {/*
                  THEME_QUIZZES は推奨の学習順に並んでいる（番号は分類の中での順）。Tailwind の preflight で
                  list-style を消すと Safari（VoiceOver）はリストの意味を落とすので、role="list" で順序を伝える
                */}
                <ol role="list" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {group.themes.map((theme, i) => {
                    const score = scores.get(theme.meta.id)
                    return (
                      <li key={theme.meta.id}>
                        <ThemeCard
                          theme={theme.meta}
                          order={i + 1}
                          progress={score === undefined || score.answered === 0 ? null : score}
                        />
                      </li>
                    )
                  })}
                </ol>
              </section>
            )
          })}
        </section>

        <section aria-labelledby="home-how-to" className="space-y-3">
          <h2 id="home-how-to" className="font-heading text-xl font-semibold">
            {m.home.howToTitle}
          </h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {m.home.howTo.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ol>
        </section>
      </div>
    </>
  )
}
