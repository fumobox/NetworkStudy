import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { useMessages } from '@/lib/i18n'
import { PLAYBACK_SPEEDS, type PlayerAction, type PlayerState } from '../player'

interface StepControlsProps {
  state: PlayerState
  dispatch: (action: PlayerAction) => void
}

export function StepControls({ state, dispatch }: StepControlsProps) {
  const m = useMessages()
  const { stepIndex, stepCount, isPlaying, speed } = state
  const atStart = stepIndex <= 0
  const atEnd = stepIndex >= stepCount - 1

  return (
    <div role="group" aria-label={m.stepper.controls} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label={m.stepper.reset}
          disabled={atStart}
          onClick={() => {
            dispatch({ type: 'jump', stepIndex: 0 })
          }}
        >
          <RotateCcw aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label={m.stepper.prev}
          disabled={atStart}
          onClick={() => {
            dispatch({ type: 'prev' })
          }}
        >
          <ChevronLeft aria-hidden />
        </Button>
        <Button
          size="icon"
          aria-label={isPlaying ? m.stepper.pause : m.stepper.play}
          disabled={stepCount <= 1}
          onClick={() => {
            dispatch({ type: 'togglePlay' })
          }}
        >
          {isPlaying ? <Pause aria-hidden /> : <Play aria-hidden />}
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label={m.stepper.next}
          disabled={atEnd}
          onClick={() => {
            dispatch({ type: 'next' })
          }}
        >
          <ChevronRight aria-hidden />
        </Button>

        <p className="ml-2 font-mono text-sm tabular-nums">
          {m.stepper.counter({ current: stepIndex + 1, total: stepCount })}
        </p>

        <div role="group" aria-label={m.stepper.speed} className="ml-auto flex gap-1">
          {PLAYBACK_SPEEDS.map((value) => (
            <Button
              key={value}
              variant={value === speed ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={value === speed}
              onClick={() => {
                dispatch({ type: 'setSpeed', speed: value })
              }}
            >
              {m.stepper.speedValue({ speed: value })}
            </Button>
          ))}
        </div>
      </div>

      {stepCount > 1 && (
        // 読み上げる値を画面のステップ番号（1 始まり）に合わせる
        <Slider
          aria-label={m.stepper.position}
          min={1}
          max={stepCount}
          step={1}
          value={[stepIndex + 1]}
          onValueChange={([value]) => {
            if (value !== undefined) {
              dispatch({ type: 'jump', stepIndex: value - 1 })
            }
          }}
        />
      )}
      <p className="text-xs text-muted-foreground">{m.stepper.keyboardHint}</p>
    </div>
  )
}
