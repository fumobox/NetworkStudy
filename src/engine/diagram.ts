import { clampStepIndex } from './derive'
import type { Message, Step, TimerEvent } from './types'

export type DiagramRow =
  | {
      readonly kind: 'message'
      readonly message: Message
      readonly stepIndex: number
      /** この行の時点での経過時間（timer の累計） */
      readonly elapsedMs: number
    }
  | {
      readonly kind: 'timer'
      readonly timer: TimerEvent
      readonly stepIndex: number
      /** タイマーが発火した後の経過時間 */
      readonly elapsedMs: number
    }

/** steps[0..index] のメッセージとタイマーを、ステップ内の順序どおりに図の行として並べる */
export function diagramRows(steps: readonly Step[], index: number): DiagramRow[] {
  const last = clampStepIndex(steps.length, index)
  let elapsedMs = 0
  return steps.slice(0, last + 1).flatMap((step, stepIndex) =>
    step.events.flatMap((event): DiagramRow[] => {
      switch (event.kind) {
        case 'message':
          return [{ kind: 'message', message: event.message, stepIndex, elapsedMs }]
        case 'timer':
          elapsedMs += event.durationMs
          return [{ kind: 'timer', timer: event, stepIndex, elapsedMs }]
        case 'stateChange':
          return []
      }
    }),
  )
}

/** 1 アクター分のレーンの幅（px） */
export const LANE_WIDTH = 180
/** 経過時間の列の幅（px） */
export const TIME_COLUMN_WIDTH = 72

/** 通常の幅で描いたときのシーケンス図の幅（px） */
export function diagramWidth(actorCount: number, withTimers: boolean): number {
  return (withTimers ? TIME_COLUMN_WIDTH : 0) + actorCount * LANE_WIDTH
}

/** シナリオ全体にタイマーが 1 つでもあるか（経過時間の列を出すかどうか） */
export function hasTimers(steps: readonly Step[]): boolean {
  return steps.some((step) => step.events.some((event) => event.kind === 'timer'))
}
