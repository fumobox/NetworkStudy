// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { clampStepIndex, deriveState, isSameStateValue, resolveSelectedMessage } from './derive'
import type { Actor, Message, StateTable, Step, StepEvent } from './types'

const text = (en: string) => ({ en, ja: `${en}（ja）` })

const EMPTY_CACHE: StateTable = { columns: ['NAME', 'TTL'], rows: [] }

const actors: readonly Actor[] = [
  {
    id: 'client',
    kind: 'client',
    name: text('Client'),
    stateSlots: [
      { key: 'state', label: text('State'), initial: 'CLOSED' },
      { key: 'cache', label: text('Cache'), initial: EMPTY_CACHE },
    ],
  },
  {
    id: 'server',
    kind: 'server',
    name: text('Server'),
    stateSlots: [{ key: 'state', label: text('State'), initial: 'CLOSED' }],
  },
]

const message = (id: string, overrides: Partial<Message> = {}): Message => ({
  id,
  from: 'client',
  to: 'server',
  label: id.toUpperCase(),
  status: 'delivered',
  fields: [],
  ...overrides,
})

const step = (id: string, events: readonly StepEvent[]): Step => ({
  id,
  title: text(id),
  description: text(id),
  events,
})

const set = (actorId: string, key: string, value: string | StateTable): StepEvent => ({
  kind: 'stateChange',
  actorId,
  key,
  value,
})

const steps: readonly Step[] = [
  step('listen', [set('server', 'state', 'LISTEN')]),
  step('syn', [set('client', 'state', 'SYN_SENT'), { kind: 'message', message: message('syn') }]),
  step('rto', [
    { kind: 'timer', actorId: 'client', name: 'RTO', durationMs: 1000 },
    { kind: 'message', message: message('syn-rtx', { retransmitOf: 'syn' }) },
  ]),
  step('syn-ack', [
    set('server', 'state', 'SYN_RECEIVED'),
    { kind: 'message', message: message('syn-ack', { from: 'server', to: 'client' }) },
    { kind: 'timer', actorId: 'client', name: 'RTO', durationMs: 2000 },
  ]),
]

describe('clampStepIndex', () => {
  it.each([
    [4, 0, 0],
    [4, -5, 0],
    [4, 99, 3],
    [4, 1.7, 1],
    [4, Number.NaN, 0],
    [4, Number.POSITIVE_INFINITY, 3],
    [0, 0, -1],
  ])('stepCount=%d, index=%d → %d', (count, index, expected) => {
    expect(clampStepIndex(count, index)).toBe(expected)
  })
})

describe('deriveState', () => {
  it('ステップがなければ stepIndex -1 と初期状態を返す', () => {
    const derived = deriveState(actors, [], 0)
    expect(derived).toEqual({
      stepIndex: -1,
      messages: [],
      timers: [],
      elapsedMs: 0,
      actorStates: {
        client: { values: { state: 'CLOSED', cache: EMPTY_CACHE }, changedKeys: [] },
        server: { values: { state: 'CLOSED' }, changedKeys: [] },
      },
    })
  })

  it('範囲外の index は丸める', () => {
    expect(deriveState(actors, steps, -5)).toEqual(deriveState(actors, steps, 0))
    expect(deriveState(actors, steps, 99)).toEqual(deriveState(actors, steps, 3))
    expect(deriveState(actors, steps, 1.7).stepIndex).toBe(1)
  })

  it('メッセージを出現順に蓄積し、ステップ番号を付ける。後のステップのメッセージは含めない', () => {
    const derived = deriveState(actors, steps, 2)
    expect(derived.messages.map((m) => [m.id, m.stepIndex])).toEqual([
      ['syn', 1],
      ['syn-rtx', 2],
    ])
    expect(derived.messages[1]?.retransmitOf).toBe('syn')
  })

  it('状態は初期値から始まり、stateChange で上書きされる', () => {
    const derived = deriveState(actors, steps, 3)
    expect(derived.actorStates.client?.values.state).toBe('SYN_SENT')
    expect(derived.actorStates.server?.values.state).toBe('SYN_RECEIVED')
    expect(derived.actorStates.client?.values.cache).toEqual(EMPTY_CACHE)
  })

  it('changedKeys は表示中のステップで実際に値が変わったキーだけ', () => {
    expect(deriveState(actors, steps, 1).actorStates.client?.changedKeys).toEqual(['state'])
    expect(deriveState(actors, steps, 1).actorStates.server?.changedKeys).toEqual([])
    // ステップ 2 では状態が変わらない
    expect(deriveState(actors, steps, 2).actorStates.client?.changedKeys).toEqual([])
  })

  it('同じ値の再設定や、ステップ内で元に戻した値は変化に含めない', () => {
    const custom = [
      step('a', [set('client', 'state', 'SYN_SENT')]),
      step('b', [
        set('client', 'state', 'SYN_SENT'),
        set('server', 'state', 'X'),
        set('server', 'state', 'CLOSED'),
      ]),
    ]
    const derived = deriveState(actors, custom, 1)
    expect(derived.actorStates.client?.changedKeys).toEqual([])
    expect(derived.actorStates.server?.changedKeys).toEqual([])
  })

  it('表は内容で比較する（行が増えれば変化、同じ内容なら変化なし）', () => {
    const withRow: StateTable = { columns: ['NAME', 'TTL'], rows: [['example.com', '300']] }
    const custom = [
      step('add', [set('client', 'cache', withRow)]),
      step('same', [
        set('client', 'cache', { columns: ['NAME', 'TTL'], rows: [['example.com', '300']] }),
      ]),
    ]
    expect(deriveState(actors, custom, 0).actorStates.client?.changedKeys).toEqual(['cache'])
    expect(deriveState(actors, custom, 1).actorStates.client?.changedKeys).toEqual([])
  })

  it('タイマーを蓄積し、経過時間を合計する', () => {
    const derived = deriveState(actors, steps, 3)
    expect(derived.timers.map((t) => [t.durationMs, t.stepIndex])).toEqual([
      [1000, 2],
      [2000, 3],
    ])
    expect(derived.elapsedMs).toBe(3000)
    expect(deriveState(actors, steps, 1).elapsedMs).toBe(0)
  })

  it('未宣言のキーや存在しないアクターへの stateChange は無視する', () => {
    const custom = [step('bad', [set('client', 'unknown', 'x'), set('ghost', 'state', 'x')])]
    const derived = deriveState(actors, custom, 0)
    expect(derived.actorStates.client?.values).toEqual({ state: 'CLOSED', cache: EMPTY_CACHE })
    expect(derived.actorStates).not.toHaveProperty('ghost')
  })

  it('入力を変更しない純関数である', () => {
    const frozen = Object.freeze(steps.map((s) => Object.freeze({ ...s })))
    expect(() => deriveState(Object.freeze([...actors]), frozen, 3)).not.toThrow()
    expect(deriveState(actors, steps, 3)).toEqual(deriveState(actors, steps, 3))
  })
})

describe('isSameStateValue', () => {
  it('スカラーと表を区別する', () => {
    expect(isSameStateValue('A', 'A')).toBe(true)
    expect(isSameStateValue('A', 'B')).toBe(false)
    expect(isSameStateValue('A', EMPTY_CACHE)).toBe(false)
    expect(isSameStateValue(EMPTY_CACHE, { columns: ['NAME', 'TTL'], rows: [] })).toBe(true)
    expect(isSameStateValue(EMPTY_CACHE, { columns: ['NAME'], rows: [] })).toBe(false)
  })
})

describe('resolveSelectedMessage', () => {
  it('選択中のメッセージを返す', () => {
    expect(resolveSelectedMessage(deriveState(actors, steps, 3), 'syn')?.id).toBe('syn')
  })

  it('未選択なら現在ステップの最後のメッセージを返す', () => {
    expect(resolveSelectedMessage(deriveState(actors, steps, 2), null)?.id).toBe('syn-rtx')
  })

  it('選択中のメッセージが見つからなければ現在ステップの最後のメッセージを返す', () => {
    expect(resolveSelectedMessage(deriveState(actors, steps, 1), 'syn-ack')?.id).toBe('syn')
  })

  it('現在ステップにメッセージがなければ全体の最後のメッセージ、なければ null', () => {
    const custom = [...steps, step('idle', [])]
    expect(resolveSelectedMessage(deriveState(actors, custom, 4), null)?.id).toBe('syn-ack')
    expect(resolveSelectedMessage(deriveState(actors, steps, 0), null)).toBeNull()
  })
})
