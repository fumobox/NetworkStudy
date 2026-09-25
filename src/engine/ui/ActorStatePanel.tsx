import { useId } from 'react'
import { useMessages, useText } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { Actor, DerivedState, StateKey, StateTable, StateValue } from '../types'

const CHANGE_MARK = '●'

interface ActorStatePanelProps {
  actors: readonly Actor[]
  derived: DerivedState
  /** 1 つ前のステップの状態（表の新しい行を強調するため）。最初のステップでは null */
  previous: DerivedState | null
  /** テーマ固有のパネルで表示するため、ここでは出さないキー */
  hiddenStateKeys?: readonly StateKey[]
}

/** 各アクターの内部状態を表示し、このステップで変わった値を強調する */
export function ActorStatePanel({
  actors,
  derived,
  previous,
  hiddenStateKeys = [],
}: ActorStatePanelProps) {
  const m = useMessages()
  const t = useText()
  const titleId = useId()
  const visibleActors = actors
    .map((actor) => ({
      actor,
      slots: actor.stateSlots.filter((slot) => !hiddenStateKeys.includes(slot.key)),
    }))
    .filter(({ slots }) => slots.length > 0)

  return (
    <section aria-labelledby={titleId} className="space-y-3">
      <h2 id={titleId} className="font-heading text-base font-semibold">
        {m.actorState.title}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {visibleActors.map(({ actor, slots }) => {
          const snapshot = derived.actorStates[actor.id]
          const before = previous?.actorStates[actor.id]
          return (
            <div key={actor.id} className="rounded-lg border p-3">
              <h3 className="mb-2 text-sm font-semibold">{t(actor.name)}</h3>
              <dl className="space-y-2">
                {slots.map((slot) => {
                  const value = snapshot?.values[slot.key] ?? slot.initial
                  const changed = snapshot?.changedKeys.includes(slot.key) === true
                  return (
                    <div
                      key={slot.key}
                      data-changed={changed}
                      className={cn('rounded-md px-2 py-1', changed && 'bg-accent')}
                    >
                      <dt className="text-xs text-muted-foreground">
                        {changed && (
                          <>
                            <span aria-hidden className="mr-1 text-primary">
                              {CHANGE_MARK}
                            </span>
                            <span className="sr-only">{m.actorState.changed}</span>
                          </>
                        )}
                        {t(slot.label)}
                      </dt>
                      <dd>
                        <StateValueView
                          value={value}
                          // 最初のステップは、枠の初期値と比べる
                          previous={previous === null ? slot.initial : before?.values[slot.key]}
                        />
                      </dd>
                    </div>
                  )
                })}
              </dl>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function rowKey(row: readonly string[]): string {
  return row.join('\u0000')
}

function StateValueView({
  value,
  previous,
}: {
  value: StateValue
  previous: StateValue | undefined
}) {
  const m = useMessages()
  if (typeof value === 'string') {
    return <code className={cn('font-mono text-sm font-semibold')}>{value}</code>
  }
  if (value.rows.length === 0) {
    return <span className="text-sm text-muted-foreground">{m.actorState.emptyTable}</span>
  }
  const previousRows = new Set(
    previous === undefined || typeof previous === 'string' ? [] : previous.rows.map(rowKey),
  )
  return (
    <StateTableView
      table={value}
      isNew={(row) => previous !== undefined && !previousRows.has(rowKey(row))}
    />
  )
}

function StateTableView({
  table,
  isNew,
}: {
  table: StateTable
  isNew: (row: readonly string[]) => boolean
}) {
  const m = useMessages()
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left font-mono text-xs">
        <thead className="text-muted-foreground">
          <tr>
            {table.columns.map((column) => (
              <th key={column} scope="col" className="py-0.5 pr-2 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => {
            const added = isNew(row)
            return (
              <tr
                key={rowKey(row)}
                data-added={added}
                className={cn('border-t', added && 'bg-accent')}
              >
                {row.map((cell, i) => (
                  <td key={`${String(i)}:${cell}`} className="py-0.5 pr-2">
                    {i === 0 && added && (
                      <>
                        <span aria-hidden className="mr-1 text-primary">
                          {CHANGE_MARK}
                        </span>
                        <span className="sr-only">{m.actorState.added}</span>
                      </>
                    )}
                    {cell}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
