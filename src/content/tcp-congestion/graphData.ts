import type { StateTable, StateValue } from '@/engine/types'
import type { CWND_HISTORY_COLUMNS } from './scenario'
import { EVENTS, type EventName } from './scenario'

export interface CwndRound {
  readonly round: number
  readonly cwnd: number
  readonly ssthresh: number
  readonly event: EventName
}

function isEventName(value: string): value is EventName {
  return Object.values(EVENTS).some((event) => event === value)
}

function isTable(value: StateValue | undefined): value is StateTable {
  return typeof value === 'object'
}

/** 状態の cwndHistory（表）を、ラウンドごとの数値にする。形が違う行は捨てる */
export function parseCwndHistory(value: StateValue | undefined): readonly CwndRound[] {
  if (!isTable(value)) {
    return []
  }
  const column = (name: (typeof CWND_HISTORY_COLUMNS)[number]) => value.columns.indexOf(name)
  return value.rows.flatMap((row) => {
    const round = Number(row[column('round')])
    const cwnd = Number(row[column('cwnd')])
    const ssthresh = Number(row[column('ssthresh')])
    const event = row[column('event')] ?? ''
    return Number.isFinite(round) &&
      Number.isFinite(cwnd) &&
      Number.isFinite(ssthresh) &&
      isEventName(event)
      ? [{ round, cwnd, ssthresh, event }]
      : []
  })
}

export interface GraphLayout {
  readonly width: number
  readonly height: number
  /** 描画領域の左上と右下（軸のラベルの余白を除く） */
  readonly plot: {
    readonly left: number
    readonly top: number
    readonly right: number
    readonly bottom: number
  }
  readonly maxRound: number
  readonly maxValue: number
}

/** 描画の大きさと軸の範囲。軸は、そのシナリオの最後までの値で決めて、ステップを進めても動かないようにする */
export function graphLayout(allRounds: readonly CwndRound[]): GraphLayout {
  const maxRound = Math.max(allRounds.length, 1)
  const maxValue = Math.max(...allRounds.flatMap((round) => [round.cwnd, round.ssthresh]), 1) + 1
  return {
    width: 560,
    height: 240,
    plot: { left: 40, top: 12, right: 548, bottom: 204 },
    maxRound,
    maxValue,
  }
}

export interface Point {
  readonly x: number
  readonly y: number
}

/** ラウンドと値を、描画領域の座標にする（ラウンド 1 が左端、値 0 が下端） */
export function toPoint(layout: GraphLayout, round: number, value: number): Point {
  const { plot, maxRound, maxValue } = layout
  const x =
    maxRound === 1
      ? (plot.left + plot.right) / 2
      : plot.left + ((round - 1) / (maxRound - 1)) * (plot.right - plot.left)
  const y = plot.bottom - (value / maxValue) * (plot.bottom - plot.top)
  return { x, y }
}

/** 折れ線の points 属性 */
export function polylinePoints(points: readonly Point[]): string {
  return points.map((point) => `${String(point.x)},${String(point.y)}`).join(' ')
}
