// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { groupFieldsByLayer, inLayer } from './layers'
import type { PacketField } from './types'

describe('groupFieldsByLayer', () => {
  it('どのフィールドも層を持たなければ null', () => {
    expect(groupFieldsByLayer([{ name: 'Seq', value: '1' }])).toBeNull()
    expect(groupFieldsByLayer([])).toBeNull()
  })

  it('連続した同じ層をまとめ、要約と注目を求める', () => {
    const fields: PacketField[] = [
      { name: 'IP Src', value: '192.0.2.1', layer: 'ipv4', inLayerSummary: true },
      { name: 'TTL', value: '64', layer: 'ipv4' },
      { name: 'Src Port', value: '49152', layer: 'tcp', inLayerSummary: true },
      { name: 'Seq', value: '1000', layer: 'tcp', inLayerSummary: true, highlight: true },
    ]
    expect(groupFieldsByLayer(fields)).toEqual([
      {
        layer: 'ipv4',
        name: 'Internet Protocol Version 4',
        summary: 'IP Src: 192.0.2.1',
        fields: fields.slice(0, 2),
        hasHighlight: false,
      },
      {
        layer: 'tcp',
        name: 'Transmission Control Protocol',
        summary: 'Src Port: 49152, Seq: 1000',
        fields: fields.slice(2),
        hasHighlight: true,
      },
    ])
  })

  it('要約のフィールドがなければ summary は null', () => {
    const [layer] = groupFieldsByLayer([{ name: 'TTL', value: '64', layer: 'ipv4' }]) ?? []
    expect(layer?.summary).toBeNull()
  })
})

describe('inLayer', () => {
  it('層を付けた新しい配列を返し、元は変えない', () => {
    const fields: readonly PacketField[] = [{ name: 'Seq', value: '1' }]
    const tagged = inLayer('tcp', fields)
    expect(tagged).toEqual([{ name: 'Seq', value: '1', layer: 'tcp' }])
    expect(fields[0]).toEqual({ name: 'Seq', value: '1' })
  })
})
