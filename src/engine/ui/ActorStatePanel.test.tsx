import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '@/lib/i18n'
import { deriveState } from '../derive'
import type { Actor, Step, StateTable } from '../types'
import { ActorStatePanel } from './ActorStatePanel'

const text = (en: string, ja = en) => ({ en, ja })
const EMPTY: StateTable = { columns: ['NAME', 'TTL'], rows: [] }

const actors: readonly Actor[] = [
  {
    id: 'client',
    kind: 'client',
    name: text('Client', 'クライアント'),
    stateSlots: [
      { key: 'state', label: text('TCP state', 'TCP 状態'), initial: 'CLOSED' },
      { key: 'cache', label: text('Cache'), initial: EMPTY },
      { key: 'secret', label: text('Secret'), initial: '-' },
    ],
  },
  { id: 'server', kind: 'server', name: text('Server'), stateSlots: [] },
]

const steps: readonly Step[] = [
  {
    id: 'a',
    title: text('a'),
    description: text('a'),
    events: [
      { kind: 'stateChange', actorId: 'client', key: 'state', value: 'SYN_SENT' },
      {
        kind: 'stateChange',
        actorId: 'client',
        key: 'cache',
        value: { ...EMPTY, rows: [['example.com', '300']] },
      },
    ],
  },
  {
    id: 'b',
    title: text('b'),
    description: text('b'),
    events: [
      {
        kind: 'stateChange',
        actorId: 'client',
        key: 'cache',
        value: {
          ...EMPTY,
          rows: [
            ['example.com', '300'],
            ['www.example.com', '60'],
          ],
        },
      },
    ],
  },
]

function renderPanel(stepIndex: number, hiddenStateKeys: readonly string[] = ['secret']) {
  render(
    <LocaleProvider locale="en">
      <ActorStatePanel
        actors={actors}
        derived={deriveState(actors, steps, stepIndex)}
        previous={stepIndex === 0 ? null : deriveState(actors, steps, stepIndex - 1)}
        hiddenStateKeys={hiddenStateKeys}
      />
    </LocaleProvider>,
  )
}

describe('ActorStatePanel', () => {
  it('状態を持つアクターだけ、枠の順に表示する。隠すキーは出さない', () => {
    renderPanel(0)
    const section = screen.getByRole('region', { name: 'State of each participant' })
    expect(within(section).getByRole('heading', { level: 3, name: 'Client' })).toBeInTheDocument()
    expect(within(section).queryByRole('heading', { name: 'Server' })).toBeNull()
    expect(within(section).getByText('SYN_SENT')).toBeInTheDocument()
    expect(within(section).queryByText('Secret')).toBeNull()
  })

  it('このステップで変わった値を強調し、読み上げ用のテキストでも示す', () => {
    renderPanel(0)
    const state = screen.getByText('SYN_SENT').closest('[data-changed]')
    expect(state).toHaveAttribute('data-changed', 'true')
    expect(state).toHaveTextContent('Changed in this step')
  })

  it('最初のステップでは、初期値と比べて追加された行を強調する', () => {
    renderPanel(0)
    const rows = screen.getAllByRole('row').filter((row) => row.hasAttribute('data-added'))
    expect(rows.map((row) => row.getAttribute('data-added'))).toEqual(['true'])
  })

  it('次のステップでは、変わっていない値の強調を外し、表に追加された行だけを強調する', () => {
    renderPanel(1)
    expect(screen.getByText('SYN_SENT').closest('[data-changed]')).toHaveAttribute(
      'data-changed',
      'false',
    )
    const rows = screen.getAllByRole('row').filter((row) => row.hasAttribute('data-added'))
    expect(rows.map((row) => row.getAttribute('data-added'))).toEqual(['false', 'true'])
    expect(rows[1]).toHaveTextContent('Added in this step')
  })

  it('表のスロットには背景を付けず、追加された行だけを背景で強調する', () => {
    renderPanel(1)
    const slot = screen.getByText('www.example.com').closest('[data-changed]')
    expect(slot).toHaveAttribute('data-changed', 'true')
    expect(slot).not.toHaveClass('bg-accent')
    expect(screen.getByText('www.example.com').closest('tr')).toHaveClass('bg-accent')
  })

  it('前の状態として同じステップが渡されても、初期値と比べる', () => {
    const derived = deriveState(actors, steps, 0)
    render(
      <LocaleProvider locale="en">
        <ActorStatePanel actors={actors} derived={derived} previous={derived} />
      </LocaleProvider>,
    )
    expect(screen.getByText('example.com').closest('tr')).toHaveAttribute('data-added', 'true')
  })

  it('同じ内容の行があっても key が衝突しない', () => {
    const duplicated: Step[] = [
      {
        id: 'dup',
        title: text('dup'),
        description: text('dup'),
        events: [
          {
            kind: 'stateChange',
            actorId: 'client',
            key: 'cache',
            value: {
              ...EMPTY,
              rows: [
                ['a', '1'],
                ['a', '1'],
              ],
            },
          },
        ],
      },
    ]
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <LocaleProvider locale="en">
        <ActorStatePanel
          actors={actors}
          derived={deriveState(actors, duplicated, 0)}
          previous={null}
        />
      </LocaleProvider>,
    )
    expect(screen.getAllByText('a')).toHaveLength(2)
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('空の表は「Empty」と表示する', () => {
    render(
      <LocaleProvider locale="en">
        <ActorStatePanel actors={actors} derived={deriveState(actors, [], 0)} previous={null} />
      </LocaleProvider>,
    )
    expect(screen.getByText('Empty')).toBeInTheDocument()
    expect(screen.getByText('CLOSED')).toBeInTheDocument()
  })
})
