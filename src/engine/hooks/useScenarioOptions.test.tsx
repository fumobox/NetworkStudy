import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { toScenarioHandle } from '../scenario'
import type { Scenario, Step } from '../types'
import { useScenarioOptions } from './useScenarioOptions'

const text = (en: string) => ({ en, ja: en })
const schema = z.object({
  lost: z.stringbool().catch(false),
  port: z.enum(['open', 'closed']).catch('open'),
})
type Options = z.infer<typeof schema>

const step = (id: string): Step => ({ id, title: text(id), description: text(id), events: [] })

const scenario: Scenario<Options> = {
  id: 'fixture',
  title: text('Fixture'),
  actors: [],
  optionDefs: {
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
  },
  parseOptions: (raw) => schema.parse(raw),
  buildSteps: (options) => [step('a'), step('b'), ...(options.lost ? [step('rtx')] : [])],
}
const handle = toScenarioHandle(scenario)

function setup(initialEntry: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>
  )
  return renderHook(
    () => {
      const session = useScenarioOptions(handle)
      const location = useLocation()
      return { session, search: location.search }
    },
    { wrapper },
  )
}

describe('useScenarioOptions', () => {
  it('URL からオプションと初期ステップを読む。不正な値はデフォルトに戻す', () => {
    const { result } = setup('/?opt.lost=1&opt.port=weird&step=3')
    expect(result.current.session.options).toEqual({ lost: true, port: 'open' })
    expect(result.current.session.steps.map((s) => s.id)).toEqual(['a', 'b', 'rtx'])
    expect(result.current.session.initialStepIndex).toBe(2)
  })

  it('オプションを変えると URL を更新し、ステップを最初に戻し、optionsKey が変わる', () => {
    const { result } = setup('/?step=2&tab=x')
    const before = result.current.session.optionsKey
    act(() => {
      result.current.session.setOption('port', 'closed')
    })
    expect(result.current.search).toBe('?tab=x&opt.port=closed')
    expect(result.current.session.options.port).toBe('closed')
    expect(result.current.session.initialStepIndex).toBe(0)
    expect(result.current.session.optionsKey).not.toBe(before)
  })

  it('デフォルト値に戻したオプションは URL から消える', () => {
    const { result } = setup('/?opt.lost=1')
    act(() => {
      result.current.session.setOption('lost', false)
    })
    expect(result.current.search).toBe('')
  })

  it('ステップを URL に書き戻す。同じ値なら何もしない', () => {
    const { result } = setup('/?opt.lost=1')
    act(() => {
      result.current.session.syncStep(2)
    })
    expect(result.current.search).toBe('?opt.lost=1&step=3')
    const syncStep = result.current.session.syncStep
    act(() => {
      syncStep(2)
    })
    expect(result.current.search).toBe('?opt.lost=1&step=3')
    act(() => {
      result.current.session.syncStep(0)
    })
    expect(result.current.search).toBe('?opt.lost=1')
  })

  it('同じオプションなら、ステップが変わっても steps は同じ参照', () => {
    const { result } = setup('/?opt.lost=1')
    const steps = result.current.session.steps
    act(() => {
      result.current.session.syncStep(1)
    })
    expect(result.current.session.steps).toBe(steps)
  })
})
