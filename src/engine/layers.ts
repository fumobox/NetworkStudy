import { PACKET_LAYERS, type PacketField, type PacketLayer, type ProtocolTerm } from './types'

// パケットのフィールドを、Wireshark の詳細のように層ごとにまとめる（#242）。
// 値はフィールドにだけ書き、層の木と要約はそこから作るので、2 か所の値が食い違うことはない

export interface FieldLayer {
  readonly layer: PacketLayer
  /** Wireshark の表示名（翻訳しない） */
  readonly name: ProtocolTerm
  /** inLayerSummary のフィールドを `名前: 値` で並べた 1 行。なければ null */
  readonly summary: ProtocolTerm | null
  readonly fields: readonly PacketField[]
  readonly hasHighlight: boolean
}

/** 同じ層の連続したフィールドを 1 つにまとめる。どのフィールドも層を持たなければ null（平らな一覧で表示する） */
export function groupFieldsByLayer(fields: readonly PacketField[]): readonly FieldLayer[] | null {
  if (!fields.some((field) => field.layer !== undefined)) {
    return null
  }
  const runs: { layer: PacketLayer; fields: PacketField[] }[] = []
  for (const field of fields) {
    const layer = field.layer
    if (layer === undefined) {
      continue
    }
    const last = runs[runs.length - 1]
    if (last?.layer === layer) {
      last.fields.push(field)
    } else {
      runs.push({ layer, fields: [field] })
    }
  }
  return runs.map(({ layer, fields: layerFields }) => {
    const parts = layerFields
      .filter((field) => field.inLayerSummary === true)
      .map((field) => `${field.name}: ${field.value}`)
    return {
      layer,
      name: PACKET_LAYERS[layer].name,
      summary: parts.length === 0 ? null : parts.join(', '),
      fields: layerFields,
      hasHighlight: layerFields.some((field) => field.highlight === true),
    }
  })
}

/** フィールドに層を付ける（シナリオで使う） */
export function inLayer(layer: PacketLayer, fields: readonly PacketField[]): PacketField[] {
  return fields.map((field) => ({ ...field, layer }))
}
