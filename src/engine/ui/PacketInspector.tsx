import { Lock, RotateCw } from 'lucide-react'
import { useId } from 'react'
import { useMessages, useText } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { resolveSelectedMessage } from '../derive'
import type { Actor, ActorId, DerivedState, MessageId } from '../types'

const HIGHLIGHT_MARK = '●'

interface PacketInspectorProps {
  actors: readonly Actor[]
  derived: DerivedState
  /** null なら現在のステップの最新メッセージを表示する */
  selectedMessageId: MessageId | null
}

/** 選択中のメッセージのフィールドを表で表示する */
export function PacketInspector({ actors, derived, selectedMessageId }: PacketInspectorProps) {
  const m = useMessages()
  const t = useText()
  const titleId = useId()
  const message = resolveSelectedMessage(derived, selectedMessageId)
  const actorName = (actorId: ActorId): string => {
    const actor = actors.find((candidate) => candidate.id === actorId)
    return actor === undefined ? actorId : t(actor.name)
  }
  const original =
    message?.retransmitOf === undefined
      ? undefined
      : derived.messages.find((candidate) => candidate.id === message.retransmitOf)

  return (
    <section aria-labelledby={titleId} className="space-y-3">
      <h2 id={titleId} className="font-heading text-base font-semibold">
        {m.inspector.title}
      </h2>
      {message === null ? (
        <p className="text-sm text-muted-foreground">{m.inspector.empty}</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="font-mono text-lg font-bold">{message.label}</h3>
            <span className="text-sm text-muted-foreground">
              {m.inspector.route({ from: actorName(message.from), to: actorName(message.to) })}
            </span>
            <span
              className={cn(
                'rounded-md border px-1.5 py-0.5 text-xs',
                message.status === 'delivered'
                  ? 'text-muted-foreground'
                  : 'border-destructive text-destructive',
              )}
            >
              {m.diagram.status[message.status]}
            </span>
          </div>
          {message.description !== undefined && <p className="text-sm">{t(message.description)}</p>}
          {message.retransmitOf !== undefined && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <RotateCw className="size-4" aria-hidden />
              {m.inspector.retransmitOf({ label: original?.label ?? message.retransmitOf })}
            </p>
          )}
          {message.encrypted === true && (
            <p className="flex items-start gap-1.5 rounded-md bg-muted p-2 text-sm">
              <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
              {m.inspector.encrypted}
            </p>
          )}
          {message.fields.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      {m.inspector.field}
                    </th>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      {m.inspector.value}
                    </th>
                    <th scope="col" className="py-1 font-medium">
                      {m.inspector.description}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {message.fields.map((field) => (
                    <tr
                      key={field.name}
                      data-highlight={field.highlight === true}
                      className={cn(
                        'border-t',
                        field.highlight === true && 'bg-accent font-semibold',
                      )}
                    >
                      <th scope="row" className="py-1.5 pr-3 align-top font-mono font-medium">
                        {field.highlight === true && (
                          <>
                            <span aria-hidden className="mr-1 text-primary">
                              {HIGHLIGHT_MARK}
                            </span>
                            <span className="sr-only">{m.inspector.highlighted}</span>
                          </>
                        )}
                        {field.name}
                      </th>
                      <td className="py-1.5 pr-3 align-top font-mono break-all">{field.value}</td>
                      <td className="py-1.5 align-top text-muted-foreground">
                        {field.description === undefined ? null : t(field.description)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
