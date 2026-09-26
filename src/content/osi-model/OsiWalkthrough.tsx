import { AnimatePresence, domAnimation, LazyMotion, m, useReducedMotionConfig } from 'motion/react'
import { useId } from 'react'
import { useScenarioPlayer } from '@/engine/hooks/useScenarioPlayer'
import { useStepKeyboard } from '@/engine/hooks/useStepKeyboard'
import { useStepParam } from '@/engine/hooks/useStepParam'
import { useStepUrlSync } from '@/engine/hooks/useStepUrlSync'
import { StepControls } from '@/engine/ui/StepControls'
import { StepDescription } from '@/engine/ui/StepDescription'
import { useText } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { OSI_LAYERS, osiLayer } from './layers'
import { layerLabel, OSI_TEXT as TEXT } from './osiText'
import { OSI_STEPS, PLAYER_STEPS, SIDES, UNIT_IDS, type OsiStep, type Side } from './steps'

/** 変化した層やヘッダーの印（色だけに頼らない） */
const CURRENT_MARK = '▶'
const ADDED_MARK = '+'
const REMOVED_MARK = '−'

/** ヘッダーが付く・外れるアニメーションの長さ（秒） */
const UNIT_DURATION_S = 0.35
/** 今の層の強調が現れるアニメーションの長さ（秒） */
const HIGHLIGHT_DURATION_S = 0.3

/** OSI 参照モデルのカプセル化を、1 層ずつステップ実行で見せる。?step= と同期する */
export function OsiWalkthrough() {
  const t = useText()
  const titleId = useId()
  const stepParam = useStepParam()
  const [state, dispatch] = useScenarioPlayer(OSI_STEPS.length, stepParam.urlStepIndex)
  useStepKeyboard(dispatch)
  useStepUrlSync({ stepCount: OSI_STEPS.length, state, dispatch, ...stepParam })
  const step = OSI_STEPS[state.stepIndex]
  // OS の「視差効果を減らす」設定と、MotionConfig の reducedMotion を尊重する
  const animate = useReducedMotionConfig() !== true

  // m コンポーネントとアニメーション機能（domAnimation）だけを使う。機能は同期的に渡す（ScenarioPlayer と同じ。#52）。
  // domAnimation にはレイアウトのアニメーション（layout / layoutId）が含まれないので使わない（domMax は約 45 kB 増える）
  return (
    <LazyMotion features={domAnimation} strict>
      <section aria-labelledby={titleId} className="space-y-6">
        <h2 id={titleId} className="font-heading text-xl font-semibold">
          {t(TEXT.title)}
        </h2>
        <StepControls state={state} dispatch={dispatch} />
        <StepDescription step={PLAYER_STEPS[state.stepIndex]} />
        {step !== undefined && (
          <>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
              {SIDES.map((side) => (
                <LayerStack key={side} side={side} step={step} animate={animate} />
              ))}
            </div>
            <CarriedData step={step} animate={animate} />
          </>
        )}
      </section>
    </LazyMotion>
  )
}

interface AnimatedProps {
  step: OsiStep
  /** false のときはアニメーションしない（視差効果を減らす設定） */
  animate: boolean
}

function LayerStack({ side, step, animate }: AnimatedProps & { side: Side }) {
  const t = useText()
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="space-y-2 rounded-lg border p-3">
      <h3 id={headingId} className="text-sm font-semibold">
        {t(TEXT.sides[side])}
      </h3>
      <ol className="isolate space-y-1 text-sm">
        {OSI_LAYERS.map((layer) => {
          const current = step.side === side && step.layers.includes(layer.number)
          return (
            <li
              key={layer.number}
              aria-current={current ? 'step' : undefined}
              className={cn(
                'relative grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-baseline gap-x-2 px-2 py-1',
                current && 'font-semibold',
              )}
            >
              {/* 今の層の強調（枠と背景）。層が変わると、新しい層にふわっと現れる */}
              {current && (
                <m.span
                  aria-hidden
                  {...(animate
                    ? {
                        initial: { opacity: 0 },
                        animate: { opacity: 1 },
                        transition: { duration: HIGHLIGHT_DURATION_S, ease: 'easeOut' },
                      }
                    : {})}
                  className="absolute inset-0 -z-10 rounded-md border border-primary bg-accent"
                />
              )}
              <span aria-hidden className="text-primary">
                {current ? CURRENT_MARK : ''}
              </span>
              <span>
                <span className="mr-1 text-xs text-muted-foreground">
                  {t(layerLabel(layer.number))}
                </span>
                {t(layer.name)}
                {current && <span className="sr-only">{t(TEXT.current)}</span>}
              </span>
              <span className="font-mono text-xs text-muted-foreground">{layer.example}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function CarriedData({ step, animate }: AnimatedProps) {
  const t = useText()
  const headingId = useId()
  const layer = osiLayer(step.layers[0] ?? 7)
  // 受信側では、外したものも取り消し線で残して見せる
  const shown = UNIT_IDS.filter(
    (unit) =>
      step.stack.includes(unit) || (step.side === 'receiver' && step.changed.includes(unit)),
  )
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3 id={headingId} className="text-base font-semibold">
        {t(TEXT.carried)}
        <span className="ml-2 font-normal text-muted-foreground">{t(layer.pdu)}</span>
      </h3>
      {step.onWire && <p className="font-mono text-sm">{t(TEXT.onWire)}</p>}
      <ol className="flex flex-wrap gap-1 text-sm">
        {/* 付いたヘッダーは外側（Ethernet は左、FCS は右）から入り、外したものは消えてから詰まる */}
        <AnimatePresence initial={false}>
          {shown.map((unit) => {
            const changed = step.changed.includes(unit)
            const removed = changed && !step.stack.includes(unit)
            const added = changed && step.side === 'sender'
            return (
              <m.li
                key={unit}
                {...(animate
                  ? {
                      initial: { opacity: 0, x: unit === 'fcs' ? 16 : -16 },
                      animate: { opacity: 1, x: 0 },
                      exit: { opacity: 0, y: -8 },
                      transition: { duration: UNIT_DURATION_S, ease: 'easeOut' },
                    }
                  : {})}
                data-unit={unit}
                data-change={removed ? 'removed' : added ? 'added' : undefined}
                className={cn(
                  'min-w-0 rounded-md border px-2 py-1',
                  unit === 'http' ? 'bg-muted' : 'bg-background',
                  added && 'border-2 border-primary',
                  removed && 'border-dashed text-muted-foreground line-through',
                )}
              >
                <span className="block font-medium">
                  {added && (
                    <span aria-hidden className="mr-1">
                      {ADDED_MARK}
                    </span>
                  )}
                  {removed && (
                    <span aria-hidden className="mr-1">
                      {REMOVED_MARK}
                    </span>
                  )}
                  {t(TEXT.units[unit])}
                  {added && <span className="sr-only">{t(TEXT.added)}</span>}
                  {removed && <span className="sr-only">{t(TEXT.removed)}</span>}
                </span>
                <span className="block font-mono text-xs text-muted-foreground">
                  {t(TEXT.unitDetails[unit])}
                </span>
              </m.li>
            )
          })}
        </AnimatePresence>
      </ol>
    </section>
  )
}
