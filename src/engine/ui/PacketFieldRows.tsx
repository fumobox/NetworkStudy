import { useMessages, useText } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { PacketField } from '../types'

const HIGHLIGHT_MARK = '●'

/** フィールドの「名前と値」の一覧。説明の列が細くならないよう、表ではなく名前と値の下に説明を置く */
export function PacketFieldRows({ fields }: { fields: readonly PacketField[] }) {
  const m = useMessages()
  const t = useText()
  return (
    <dl className="text-sm">
      {fields.map((field, i) => (
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
            {field.highlight === true && <span className="sr-only">{m.inspector.highlighted}</span>}
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
  )
}
