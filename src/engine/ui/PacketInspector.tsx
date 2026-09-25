import { Lock, RotateCw } from 'lucide-react'
import { useId } from 'react'
import { useMessages, useText } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { resolveSelectedMessage } from '../derive'
import type { Actor, DerivedState, MessageId } from '../types'
import { useActorName } from './useActorName'

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
  const actorName = useActorName(actors)
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
            // 説明の列が細くならないよう、表ではなく「名前と値」の下に説明を置く
            <dl className="text-sm">
              {message.fields.map((field, i) => (
                <div
                  // 同じ名前のフィールドが並ぶこともある（DNS の複数の Answer など）
                  key={`${String(i)}:${field.name}`}
                  data-highlight={field.highlight === true}
                  className={cn(
                    'grid grid-cols-[minmax(5.5rem,auto)_minmax(0,1fr)] items-baseline gap-x-3 border-t px-1 py-2',
                    field.highlight === true && 'bg-accent',
                  )}
                >
                  <dt className="font-mono text-xs text-muted-foreground">
                    {field.highlight === true && (
                      <span aria-hidden className="mr-1 text-primary">
                        {HIGHLIGHT_MARK}
                      </span>
                    )}
                    {field.name}
                    {field.highlight === true && (
                      <span className="sr-only">{m.inspector.highlighted}</span>
                    )}
                  </dt>
                  <dd
                    className={cn(
                      'font-mono break-words whitespace-pre-line',
                      field.highlight === true && 'font-semibold',
                    )}
                  >
                    {field.value}
                  </dd>
                  {field.description !== undefined && (
                    <dd className="col-start-2 mt-0.5 text-xs text-muted-foreground">
                      {t(field.description)}
                    </dd>
                  )}
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </section>
  )
}
