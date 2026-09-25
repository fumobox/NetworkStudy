// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { ScenarioOptionDefs, ScenarioOptions } from './types'
import { optionParamsKey, readOptionParams, readStepParam, writeScenarioParams } from './url'

const text = (en: string) => ({ en, ja: en })
const optionDefs: ScenarioOptionDefs<ScenarioOptions> = {
  lost: { kind: 'toggle', label: text('Lost'), defaultValue: false },
  port: {
    kind: 'select',
    label: text('Port'),
    choices: [
      { value: 'open', label: text('Open') },
      { value: 'closed', label: text('Closed') },
    ],
    defaultValue: 'open',
  },
}

describe('readStepParam', () => {
  it.each([
    ['step=3', 2],
    ['step=1', 0],
    ['step=0', 0],
    ['', null],
    ['step=abc', null],
    ['step=-1', null],
    ['step=1.5', null],
  ])('%j → %j', (query, expected) => {
    expect(readStepParam(new URLSearchParams(query))).toBe(expected)
  })
})

describe('readOptionParams', () => {
  it('opt. で始まるパラメータだけを集める', () => {
    expect(readOptionParams(new URLSearchParams('opt.lost=1&step=2&opt.port=closed&x=y'))).toEqual({
      lost: '1',
      port: 'closed',
    })
  })
})

describe('optionParamsKey', () => {
  it('オプション以外や順序の違いに影響されない', () => {
    expect(optionParamsKey(new URLSearchParams('step=2&opt.port=closed&opt.lost=1'))).toBe(
      optionParamsKey(new URLSearchParams('opt.lost=1&opt.port=closed&step=5')),
    )
    expect(optionParamsKey(new URLSearchParams('step=2'))).toBe('')
  })
})

describe('writeScenarioParams', () => {
  it('デフォルトと違うオプションとステップ（1 始まり）を書き、関係のないパラメータは残す', () => {
    const next = writeScenarioParams(new URLSearchParams('x=y&opt.old=1&step=9'), {
      optionDefs,
      options: { lost: true, port: 'closed' },
      stepIndex: 2,
    })
    expect(next.toString()).toBe('x=y&opt.lost=1&opt.port=closed&step=3')
  })

  it('デフォルト値のオプションと最初のステップは省く', () => {
    const next = writeScenarioParams(new URLSearchParams(), {
      optionDefs,
      options: { lost: false, port: 'open' },
      stepIndex: 0,
    })
    expect(next.toString()).toBe('')
  })

  it('toggle の false はデフォルトが true のときだけ 0 として書く', () => {
    const next = writeScenarioParams(new URLSearchParams(), {
      optionDefs: {
        ...optionDefs,
        lost: { kind: 'toggle', label: text('Lost'), defaultValue: true },
      },
      options: { lost: false, port: 'open' },
      stepIndex: 0,
    })
    expect(next.toString()).toBe('opt.lost=0')
  })
})
