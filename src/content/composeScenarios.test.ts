// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { composeScenarios } from '@/engine/compose'
import { validateScenario } from '@/engine/validate'
import { tcpHandshakeTheme } from './tcp-handshake'
import { tlsHandshakeTheme } from './tls-handshake'

// 既存のテーマのシナリオ（TCP + TLS）を合成しても、整合したシナリオになることを確かめる

const composed = composeScenarios({
  id: 'tcp-tls',
  title: { en: 'TCP and TLS', ja: 'TCP と TLS' },
  actors: [
    { id: 'client', kind: 'client', name: { en: 'Client', ja: 'クライアント' } },
    { id: 'server', kind: 'server', name: { en: 'Server', ja: 'サーバー' } },
  ],
  parts: [
    { prefix: 'tcp', handle: tcpHandshakeTheme.scenario, expose: ['synLoss'] },
    { prefix: 'tls', handle: tlsHandshakeTheme.scenario },
  ],
})

describe('既存のシナリオの合成（TCP + TLS）', () => {
  it('validateScenario を通る', () => {
    expect(validateScenario(composed)).toEqual([])
  })

  it('ステップとメッセージの id が衝突しない', () => {
    const { steps } = composed.resolve({ 'tcp.synLoss': 'twice' })
    const stepIds = steps.map((step) => step.id)
    const messageIds = steps
      .flatMap((step) => step.events)
      .flatMap((event) => (event.kind === 'message' ? [event.message.id] : []))
    expect(new Set(stepIds).size).toBe(stepIds.length)
    expect(new Set(messageIds).size).toBe(messageIds.length)
    expect(stepIds[0]).toMatch(/^tcp\./)
    expect(stepIds.at(-1)).toMatch(/^tls\./)
  })

  it('TCP と TLS の状態（どちらもキーは state）を別々に持つ', () => {
    const client = composed.actors.find((actor) => actor.id === 'client')
    const keys = client?.stateSlots.map((slot) => slot.key) ?? []
    expect(keys).toContain('tcp.state')
    expect(keys).toContain('tls.state')
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('出したオプション（tcp.synLoss）だけが TCP のパートに届く', () => {
    const lossy = composed.resolve({ 'tcp.synLoss': 'once' }).steps.length
    const normal = composed.resolve({}).steps.length
    expect(lossy).toBeGreaterThan(normal)
    expect(Object.keys(composed.optionDefs)).toEqual(['tcp.synLoss'])
    // 出していない TLS のオプションは URL にあっても無視する
    expect(composed.resolve({ 'tls.certProblem': 'expired' }).steps.length).toBe(normal)
  })
})
