// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { diagramRows, hasTimers } from './diagram'
import type { Message, Step, StepEvent } from './types'

const text = (en: string) => ({ en, ja: en })
const message = (id: string): Message => ({
  id,
  from: 'a',
  to: 'b',
  label: id,
  status: 'delivered',
  fields: [],
})
const step = (id: string, events: readonly StepEvent[]): Step => ({
  id,
  title: text(id),
  description: text(id),
  events,
})

const steps: readonly Step[] = [
  step('s0', [{ kind: 'stateChange', actorId: 'a', key: 'state', value: 'X' }]),
  step('s1', [{ kind: 'message', message: message('m1') }]),
  step('s2', [
    { kind: 'timer', actorId: 'a', name: 'RTO', durationMs: 1000 },
    { kind: 'message', message: message('m2') },
    { kind: 'message', message: message('m3') },
  ]),
]

describe('diagramRows', () => {
  it('メッセージとタイマーをステップ内の順序どおりに並べ、状態の変更は含めない', () => {
    expect(
      diagramRows(steps, 2).map((row) =>
        row.kind === 'message' ? row.message.id : row.timer.name,
      ),
    ).toEqual(['m1', 'RTO', 'm2', 'm3'])
  })

  it('指定したステップまでの行だけを返す', () => {
    expect(diagramRows(steps, 1)).toHaveLength(1)
    expect(diagramRows(steps, 0)).toEqual([])
    expect(diagramRows([], 0)).toEqual([])
  })

  it('各行に、その時点での経過時間とステップ番号を付ける', () => {
    expect(diagramRows(steps, 2).map((row) => [row.stepIndex, row.elapsedMs])).toEqual([
      [1, 0],
      [2, 1000],
      [2, 1000],
      [2, 1000],
    ])
  })
})

describe('hasTimers', () => {
  it('タイマーがあるか', () => {
    expect(hasTimers(steps)).toBe(true)
    expect(hasTimers(steps.slice(0, 2))).toBe(false)
  })
})
