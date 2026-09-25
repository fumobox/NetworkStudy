import { clampStepIndex } from './derive'
import type { LocalizedText } from '@/lib/i18n/locale'
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
/** アクターが多い図（HTTPS の全体像の 6 アクターなど）のレーンの幅（px）。広い画面の本文の幅に収める */
export const NARROW_LANE_WIDTH = 150
/** この数を超えるアクターの図は、NARROW_LANE_WIDTH で描く */
const MAX_ACTORS_AT_FULL_WIDTH = 5
/** 経過時間の列の幅（px） */
export const TIME_COLUMN_WIDTH = 72

/** 通常の幅（スマホ向けの狭い表示でないとき）のレーンの幅 */
export function laneWidthFor(actorCount: number): number {
  return actorCount > MAX_ACTORS_AT_FULL_WIDTH ? NARROW_LANE_WIDTH : LANE_WIDTH
}

/** 通常の幅で描いたときのシーケンス図の幅（px） */
export function diagramWidth(actorCount: number, withTimers: boolean): number {
  return (withTimers ? TIME_COLUMN_WIDTH : 0) + actorCount * laneWidthFor(actorCount)
}

/**
 * 文字列を描いたときの幅のおおよその見積もり（px）。
 * CJK などの全角文字は 1 文字がフォントサイズ、それ以外は 0.6 倍として数える
 */
export function estimateTextWidth(text: string, fontSize = 14): number {
  let width = 0
  for (const char of text) {
    width += (char.codePointAt(0) ?? 0) >= 0x2e80 ? fontSize : fontSize * 0.6
  }
  return width
}

/**
 * 各行が区間（Step.section）の始まりなら、その区間の名前を返す（始まりでなければ null）。
 * 区間のないステップの行は null。直前の行と同じ区間なら null
 */
export function sectionStartLabels(
  steps: readonly Step[],
  rows: readonly DiagramRow[],
): (LocalizedText | null)[] {
  let previous: string | null = null
  return rows.map((row) => {
    const section = steps[row.stepIndex]?.section
    const key = section === undefined ? null : JSON.stringify(section)
    const isStart = key !== null && key !== previous
    previous = key
    return isStart ? (section ?? null) : null
  })
}

/**
 * 各行の上端の y 座標と、本体の下端を求める。区間の始まりの行の上には sectionHeight の帯を入れる
 */
export function rowLayout(
  sections: readonly (LocalizedText | null)[],
  options: { top: number; rowHeight: number; sectionHeight: number },
): { rowTops: number[]; bottom: number } {
  const rowTops: number[] = []
  let top = options.top
  for (const section of sections) {
    top += section === null ? 0 : options.sectionHeight
    rowTops.push(top)
    top += options.rowHeight
  }
  return { rowTops, bottom: top }
}

/** シナリオ全体にタイマーが 1 つでもあるか（経過時間の列を出すかどうか） */
export function hasTimers(steps: readonly Step[]): boolean {
  return steps.some((step) => step.events.some((event) => event.kind === 'timer'))
}
