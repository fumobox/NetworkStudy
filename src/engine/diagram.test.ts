// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  diagramRows,
  diagramWidth,
  estimateTextWidth,
  hasTimers,
  laneWidthFor,
  rowLayout,
  sectionStartLabels,
} from './diagram'
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

  it('範囲外の index は丸める', () => {
    expect(diagramRows(steps, 99)).toHaveLength(4)
    expect(diagramRows(steps, -1)).toEqual([])
    expect(diagramRows(steps, Number.NaN)).toEqual([])
  })

  it('タイマーより前のメッセージには、タイマー前の経過時間を付ける', () => {
    const custom = [
      step('s', [
        { kind: 'message', message: message('before') },
        { kind: 'timer', actorId: 'a', name: 'RTO', durationMs: 500 },
      ]),
    ]
    expect(diagramRows(custom, 0).map((row) => row.elapsedMs)).toEqual([0, 500])
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

describe('estimateTextWidth', () => {
  it('全角はフォントサイズ、半角は 0.6 倍で数える', () => {
    expect(estimateTextWidth('ab', 10)).toBe(12)
    expect(estimateTextWidth('クライアント', 14)).toBe(84)
  })
})

describe('sectionStartLabels', () => {
  const sectionA = { en: 'A', ja: 'A' }
  const sectionB = { en: 'B', ja: 'B' }
  const withSections: readonly Step[] = [
    { ...step('s0', [{ kind: 'message', message: message('m0') }]), section: sectionA },
    { ...step('s1', [{ kind: 'message', message: message('m1') }]), section: sectionA },
    {
      ...step('s2', [
        { kind: 'message', message: message('m2') },
        { kind: 'message', message: message('m3') },
      ]),
      section: sectionB,
    },
    step('s3', [{ kind: 'message', message: message('m4') }]),
  ]

  it('区間が切り替わる行にだけ名前を返す', () => {
    const rows = diagramRows(withSections, 3)
    expect(sectionStartLabels(withSections, rows)).toEqual([sectionA, null, sectionB, null, null])
  })

  it('区間のない行を挟んで同じ区間に戻ったら、もう一度名前を返す', () => {
    const back: readonly Step[] = [
      { ...step('a', [{ kind: 'message', message: message('m0') }]), section: sectionA },
      step('b', [{ kind: 'message', message: message('m1') }]),
      { ...step('c', [{ kind: 'message', message: message('m2') }]), section: sectionA },
    ]
    expect(sectionStartLabels(back, diagramRows(back, 2))).toEqual([sectionA, null, sectionA])
  })
})

describe('rowLayout', () => {
  it('区間の始まりの行の上に帯の高さを足す', () => {
    const section = { en: 'A', ja: 'A' }
    expect(
      rowLayout([section, null, section], { top: 48, rowHeight: 56, sectionHeight: 24 }),
    ).toEqual({
      rowTops: [72, 128, 208],
      bottom: 264,
    })
    expect(rowLayout([], { top: 48, rowHeight: 56, sectionHeight: 24 })).toEqual({
      rowTops: [],
      bottom: 48,
    })
  })
})

describe('laneWidthFor / diagramWidth', () => {
  it('5 アクターまでは 180px、6 アクター以上は 150px のレーンで描く', () => {
    expect([2, 5, 6].map(laneWidthFor)).toEqual([180, 180, 150])
    expect(diagramWidth(5, false)).toBe(900)
    expect(diagramWidth(6, false)).toBe(900)
    expect(diagramWidth(2, true)).toBe(72 + 360)
  })
})
