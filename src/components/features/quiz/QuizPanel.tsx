import { Check, X } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { useMessages, useText } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { Quiz, QuizQuestion } from './types'
import { incorrectQuestionIds, useQuizProgress } from './useQuizProgress'

interface QuizPanelProps {
  quiz: Quiz
}

/** 単一選択のクイズ。選択肢を押すと回答が確定し、正誤と解説を表示する */
export function QuizPanel({ quiz }: QuizPanelProps) {
  // 別のクイズに切り替わったら、回答の状態と保存先を作り直す
  return <QuizBody key={quiz.id} quiz={quiz} />
}

function QuizBody({ quiz }: QuizPanelProps) {
  const m = useMessages()
  const titleId = useId()
  const baseId = useId()
  const { answers, score, answer, reset, retryIncorrect } = useQuizProgress(quiz)
  const incorrect = incorrectQuestionIds(quiz, answers)
  // 解き直すときは、最初に解き直す問題にフォーカスを移す（ボタンが消えてフォーカスを失わないように）
  const focusAfterRetry = useRef<string | null>(null)
  useEffect(() => {
    const id = focusAfterRetry.current
    if (id !== null) {
      focusAfterRetry.current = null
      document.getElementById(`${baseId}-${id}`)?.focus()
    }
  }, [answers, baseId])

  return (
    <section aria-labelledby={titleId} className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={titleId} className="font-heading text-2xl font-bold tracking-tight">
          {m.quiz.title}
        </h2>
        <p className="text-sm text-muted-foreground">
          {m.quiz.score({ correct: score.correct, total: score.total })}
        </p>
      </div>
      <ol className="space-y-6">
        {quiz.questions.map((question, i) => (
          <li key={question.id}>
            <QuestionView
              id={`${baseId}-${question.id}`}
              question={question}
              index={i}
              total={quiz.questions.length}
              selectedId={answers[question.id]}
              onAnswer={(choiceId) => {
                answer(question.id, choiceId)
              }}
            />
          </li>
        ))}
      </ol>
      {score.answered > 0 && (
        <div className="flex flex-wrap gap-2">
          {incorrect.length > 0 && (
            <Button
              onClick={() => {
                focusAfterRetry.current = incorrect[0] ?? null
                retryIncorrect()
              }}
            >
              {m.quiz.retryIncorrect({ count: incorrect.length })}
            </Button>
          )}
          <Button variant="outline" onClick={reset}>
            {m.quiz.reset}
          </Button>
        </div>
      )}
    </section>
  )
}

interface QuestionViewProps {
  id: string
  question: QuizQuestion
  index: number
  total: number
  selectedId: string | undefined
  onAnswer: (choiceId: string) => void
}

function QuestionView({ id, question, index, total, selectedId, onAnswer }: QuestionViewProps) {
  const m = useMessages()
  const t = useText()
  const promptId = useId()
  const answered = selectedId !== undefined
  const isCorrect = selectedId === question.answerId
  const correctChoice = question.choices.find((choice) => choice.id === question.answerId)

  return (
    // 長いアドレス（IPv6 など）が狭い画面ではみ出さないよう、どこでも折り返せるようにする
    <div
      id={id}
      role="group"
      aria-labelledby={promptId}
      // 解き直すときにフォーカスを受ける（Tab の順には入らない。問題の余白をクリックしてもフォーカスが移るが、枠は出ない）
      tabIndex={-1}
      className="space-y-3 rounded-lg border p-4 wrap-anywhere focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <div id={promptId}>
        <p className="text-xs text-muted-foreground">{m.quiz.question({ n: index + 1, total })}</p>
        <h3 className="font-medium">{t(question.prompt)}</h3>
      </div>
      <ul className="grid gap-2">
        {question.choices.map((choice) => {
          const selected = choice.id === selectedId
          const correct = choice.id === question.answerId
          const text = t(choice.text)
          // 回答後は「あなたの回答」「正解」も名前に含めて読み上げる
          const suffix =
            (answered && selected ? m.quiz.yourAnswer : '') +
            (answered && correct ? m.quiz.correctAnswer : '')
          return (
            <li key={choice.id}>
              <Button
                variant="outline"
                aria-pressed={selected}
                aria-disabled={answered}
                aria-label={suffix === '' ? undefined : `${text}${suffix}`}
                onClick={() => {
                  if (!answered) {
                    onAnswer(choice.id)
                  }
                }}
                className={cn(
                  'h-auto w-full justify-start py-2 text-left whitespace-normal',
                  answered && correct && 'border-success bg-success-soft',
                  answered && selected && !correct && 'border-destructive text-destructive',
                  // 回答後は押せないので、ホバーや押下の見た目も出さない
                  answered && 'pointer-events-none',
                )}
              >
                {answered && correct && <Check aria-hidden className="text-success" />}
                {answered && selected && !correct && <X aria-hidden />}
                <span>{text}</span>
              </Button>
            </li>
          )
        })}
      </ul>
      {/* 回答した直後に正誤を読み上げる */}
      <div role="status" className="space-y-1 text-sm">
        {answered && (
          <>
            <p className={cn('font-semibold', isCorrect ? 'text-success' : 'text-destructive')}>
              {isCorrect ? m.quiz.correct : m.quiz.incorrect}
              {!isCorrect && correctChoice !== undefined && (
                <span className="ml-1 font-normal text-foreground">
                  {m.quiz.answerIs({ answer: t(correctChoice.text) })}
                </span>
              )}
            </p>
            <p className="text-muted-foreground">{t(question.explanation)}</p>
          </>
        )}
      </div>
    </div>
  )
}
