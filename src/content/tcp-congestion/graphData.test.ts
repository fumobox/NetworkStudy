// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { graphLayout, parseCwndHistory, polylinePoints, toPoint } from './graphData'
import { CWND_HISTORY_COLUMNS } from './scenario'

const table = (rows: readonly (readonly string[])[]) => ({ columns: CWND_HISTORY_COLUMNS, rows })

describe('parseCwndHistory', () => {
  it('表の行を数値にし、形が違う行は捨てる', () => {
    expect(
      parseCwndHistory(
        table([
          ['1', '1', '8', 'slow start'],
          ['2', '2', '8', 'slow start'],
          ['x', '4', '8', 'slow start'],
          ['4', '8', '8', 'unknown event'],
        ]),
      ),
    ).toEqual([
      { round: 1, cwnd: 1, ssthresh: 8, event: 'slow start' },
      { round: 2, cwnd: 2, ssthresh: 8, event: 'slow start' },
    ])
  })

  it('表でなければ空', () => {
    expect(parseCwndHistory('-')).toEqual([])
    expect(parseCwndHistory(undefined)).toEqual([])
  })
})

describe('graphLayout / toPoint', () => {
  const rounds = parseCwndHistory(
    table([
      ['1', '1', '8', 'slow start'],
      ['2', '2', '8', 'slow start'],
      ['3', '4', '8', 'slow start'],
      ['4', '8', '8', 'RTO'],
      ['5', '1', '4', 'slow start'],
    ]),
  )
  const layout = graphLayout(rounds)

  it('軸の範囲は、ラウンドの数と値の最大 + 1', () => {
    expect([layout.maxRound, layout.maxValue]).toEqual([5, 9])
  })

  it('ラウンド 1 が左端、最後のラウンドが右端、値 0 が下端', () => {
    expect(toPoint(layout, 1, 0)).toEqual({ x: layout.plot.left, y: layout.plot.bottom })
    expect(toPoint(layout, 5, 9)).toEqual({ x: layout.plot.right, y: layout.plot.top })
    const middle = toPoint(layout, 3, 4.5)
    expect(middle.x).toBe((layout.plot.left + layout.plot.right) / 2)
    expect(middle.y).toBe((layout.plot.top + layout.plot.bottom) / 2)
  })

  it('ラウンドが 1 つなら中央に置く', () => {
    const single = graphLayout(rounds.slice(0, 1))
    expect(toPoint(single, 1, 0).x).toBe((single.plot.left + single.plot.right) / 2)
  })

  it('折れ線の points 属性', () => {
    expect(
      polylinePoints([
        { x: 1, y: 2 },
        { x: 3.5, y: 4 },
      ]),
    ).toBe('1,2 3.5,4')
  })
})
