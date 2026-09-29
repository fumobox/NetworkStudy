import { Lock, RotateCw } from 'lucide-react'
import { useId } from 'react'
import { useMessages, useText } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { resolveSelectedMessage } from '../derive'
import { groupFieldsByLayer } from '../layers'
import type { Actor, DerivedState, MessageId } from '../types'
import { PacketFieldRows } from './PacketFieldRows'
import { PacketLayerTree } from './PacketLayerTree'
import { useActorName } from './useActorName'

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
  const actorName = useActorName(actors)
  const original =
    message?.retransmitOf === undefined
      ? undefined
      : derived.messages.find((candidate) => candidate.id === message.retransmitOf)
  const layers = message === null ? null : groupFieldsByLayer(message.fields)

  return (
    <section aria-labelledby={titleId} className="space-y-3">
      <h3 id={titleId} className="font-heading text-base font-semibold">
        {m.inspector.title}
      </h3>
      {message === null ? (
        <p className="text-sm text-muted-foreground">{m.inspector.empty}</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h4 className="font-mono text-lg font-bold">{message.label}</h4>
            <span className="text-sm text-muted-foreground">
              {m.inspector.route({ from: actorName(message.from), to: actorName(message.to) })}
            </span>
            <span
              className={cn(
                'rounded-md border px-1.5 py-0.5 text-xs',
                message.status === 'delivered'
                  ? 'border-success/60 text-success'
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
          {message.fields.length > 0 &&
            (layers === null ? (
              <PacketFieldRows fields={message.fields} />
            ) : (
              <PacketLayerTree messageId={message.id} layers={layers} />
            ))}
        </div>
      )}
    </section>
  )
}
