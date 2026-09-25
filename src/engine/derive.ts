import type {
  Actor,
  ActorId,
  ActorStateSnapshot,
  DerivedMessage,
  DerivedState,
  DerivedTimer,
  MessageId,
  StateKey,
  StateValue,
  Step,
} from './types'

/** ステップ番号を [0, stepCount - 1] に丸める。小数は切り捨て、NaN は 0。ステップがなければ -1 */
export function clampStepIndex(stepCount: number, index: number): number {
  if (stepCount <= 0) {
    return -1
  }
  const truncated = Number.isNaN(index) ? 0 : Math.trunc(index)
  return Math.min(Math.max(truncated, 0), stepCount - 1)
}

/** 状態の値が等しいか。表は列と行の文字列で比較する */
export function isSameStateValue(a: StateValue, b: StateValue): boolean {
  if (typeof a === 'string' || typeof b === 'string') {
    return a === b
  }
  return JSON.stringify([a.columns, a.rows]) === JSON.stringify([b.columns, b.rows])
}

type MutableStates = Map<ActorId, Map<StateKey, StateValue>>

function snapshotValues(states: MutableStates): Map<ActorId, Map<StateKey, StateValue>> {
  return new Map([...states].map(([actorId, values]) => [actorId, new Map(values)]))
}

/**
 * steps[0..index] を適用した状態を導出する（index は丸める）。
 * 未宣言のキー・存在しないアクターへの stateChange は無視する（validateScenario で検出する）。
 */
export function deriveState(
  actors: readonly Actor[],
  steps: readonly Step[],
  index: number,
): DerivedState {
  const stepIndex = clampStepIndex(steps.length, index)
  const states: MutableStates = new Map(
    actors.map((actor) => [
      actor.id,
      new Map(actor.stateSlots.map((slot) => [slot.key, slot.initial])),
    ]),
  )
  const messages: DerivedMessage[] = []
  const timers: DerivedTimer[] = []
  let elapsedMs = 0
  let beforeLastStep = snapshotValues(states)

  steps.slice(0, stepIndex + 1).forEach((step, i) => {
    if (i === stepIndex) {
      beforeLastStep = snapshotValues(states)
    }
    for (const event of step.events) {
      switch (event.kind) {
        case 'message':
          messages.push({ ...event.message, stepIndex: i })
          break
        case 'timer':
          timers.push({ ...event, stepIndex: i })
          elapsedMs += event.durationMs
          break
        case 'stateChange': {
          const values = states.get(event.actorId)
          if (values?.has(event.key) === true) {
            values.set(event.key, event.value)
          }
          break
        }
      }
    }
  })

  const actorStates: Record<ActorId, ActorStateSnapshot> = {}
  for (const [actorId, values] of states) {
    const before = beforeLastStep.get(actorId)
    const changedKeys = [...values].flatMap(([key, value]) => {
      const previous = before?.get(key)
      return previous === undefined || isSameStateValue(previous, value) ? [] : [key]
    })
    actorStates[actorId] = { values: Object.fromEntries(values), changedKeys }
  }

  return { stepIndex, messages, timers, actorStates, elapsedMs }
}

/**
 * インスペクタに表示するメッセージを決める。
 * 選択中のメッセージが見つからない（ステップを戻って消えた）か未選択なら、
 * 現在ステップの最後のメッセージ、それもなければ全体の最後のメッセージを返す。
 */
export function resolveSelectedMessage(
  derived: DerivedState,
  messageId: MessageId | null,
): DerivedMessage | null {
  const selected =
    messageId === null ? undefined : derived.messages.find((message) => message.id === messageId)
  if (selected !== undefined) {
    return selected
  }
  const inCurrentStep = derived.messages.filter(
    (message) => message.stepIndex === derived.stepIndex,
  )
  return inCurrentStep.at(-1) ?? derived.messages.at(-1) ?? null
}
