import { useMessages } from '@/lib/i18n'
import type { FieldLayer } from '../layers'
import type { MessageId } from '../types'
import { PacketFieldRows } from './PacketFieldRows'

const HIGHLIGHT_MARK = '●'

interface PacketLayerTreeProps {
  messageId: MessageId
  layers: readonly FieldLayer[]
}

/**
 * Wireshark の詳細のように、層ごとに折りたたんでフィールドを表示する。
 * ← → はステップの移動に使うので、矢印キーで動く tree のウィジェットにはせず、ネイティブの details を使う。
 * 注目するフィールドを含む層と、いちばん内側の層を開いておく（ほかの層も要約の 1 行は見える）
 */
export function PacketLayerTree({ messageId, layers }: PacketLayerTreeProps) {
  const m = useMessages()
  return (
    <div role="group" aria-label={m.inspector.layers} className="space-y-1">
      {layers.map((layer, i) => (
        <details
          // メッセージを選び直したら、開き方を元に戻す
          key={`${messageId}:${String(i)}:${layer.layer}`}
          open={layer.hasHighlight || i === layers.length - 1}
          className="rounded-md border"
        >
          <summary className="cursor-pointer px-2 py-1.5 text-sm">
            {layer.hasHighlight && (
              <span aria-hidden className="mr-1 text-primary">
                {HIGHLIGHT_MARK}
              </span>
            )}
            <span className="font-semibold">{layer.name}</span>
            {layer.summary !== null && (
              <span className="ml-2 font-mono text-xs break-words text-muted-foreground">
                {layer.summary}
              </span>
            )}
            {layer.hasHighlight && <span className="sr-only">{m.inspector.layerHighlighted}</span>}
          </summary>
          <div className="px-1 pb-1">
            <PacketFieldRows fields={layer.fields} />
          </div>
        </details>
      ))}
    </div>
  )
}
