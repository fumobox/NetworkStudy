import { useState } from 'react'
import { useMessages } from '@/lib/i18n'
import type { FieldLayer } from '../layers'
import type { MessageId } from '../types'
import { HIGHLIGHT_MARK, PacketFieldRows } from './PacketFieldRows'

interface PacketLayerTreeProps {
  messageId: MessageId
  layers: readonly FieldLayer[]
}

/**
 * Wireshark の詳細のように、層ごとに折りたたんでフィールドを表示する。
 * ← → はステップの移動に使うので、矢印キーで動く tree のウィジェットにはせず、ネイティブの details を使う。
 * 注目するフィールドを含む層と、いちばん内側の層を開いておく（ほかの層も要約の 1 行は見える）。
 * Space や Enter で開閉しても、ステップは動かない（useStepKeyboard は body にフォーカスがあるときだけ Space を扱う）
 */
export function PacketLayerTree({ messageId, layers }: PacketLayerTreeProps) {
  const m = useMessages()
  const defaults = layers.map((layer, i) => layer.hasHighlight || i === layers.length - 1)
  // 開き方はメッセージごとに持つ。details を作り直すとフォーカスが失われる（← → でステップを移ったとき）ので、
  // key にメッセージを入れず、別のメッセージになったら既定の開き方に戻す
  const [state, setState] = useState({ messageId, open: defaults })
  const open = state.messageId === messageId ? state.open : defaults
  const toggle = (index: number, value: boolean) => {
    setState((previous) => {
      const base = previous.messageId === messageId ? previous.open : defaults
      return { messageId, open: base.map((current, i) => (i === index ? value : current)) }
    })
  }
  return (
    <div role="group" aria-label={m.inspector.layers} className="space-y-1">
      {layers.map((layer, i) => (
        <details
          key={`${String(i)}:${layer.layer}`}
          open={open[i] ?? false}
          onToggle={(event) => {
            toggle(i, event.currentTarget.open)
          }}
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
