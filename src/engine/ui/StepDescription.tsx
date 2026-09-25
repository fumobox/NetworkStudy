import { useText } from '@/lib/i18n'
import type { Step } from '../types'

interface StepDescriptionProps {
  step: Step | undefined
}

/** 現在のステップのタイトルと解説。ステップが変わったら読み上げる */
export function StepDescription({ step }: StepDescriptionProps) {
  const t = useText()

  return (
    <section aria-live="polite" aria-atomic className="space-y-1">
      {step !== undefined && (
        <>
          <h2 className="font-heading text-lg font-semibold">{t(step.title)}</h2>
          <p className="leading-relaxed text-muted-foreground">{t(step.description)}</p>
        </>
      )}
    </section>
  )
}
