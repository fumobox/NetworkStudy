// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, StateValue, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { en } from '@/lib/i18n/messages/en'
import { ja } from '@/lib/i18n/messages/ja'
import { ADDR, INDEX, wireguardScenario, type WireguardOptions } from './scenario'

const handle = toScenarioHandle(wireguardScenario)
const SITUATIONS = ['handshake', 'rejected', 'roaming', 'keepalive', 'rekey', 'underLoad'] as const

const build = (situation: WireguardOptions['situation'] = 'handshake') =>
  wireguardScenario.buildSteps({ situation })
function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}
const flow = (steps: readonly Step[]) =>
  messages(steps).map((m) => `${m.from}→${m.to} ${m.label} ${m.status}`)
const byId = (steps: readonly Step[], id: string) => messages(steps).find((m) => m.id === id)
const field = (message: Message | undefined, name: string) =>
  message?.fields.find((f) => f.name === name)?.value
function stateAt(steps: readonly Step[], id: string) {
  const index = steps.findIndex((step) => step.id === id)
  return deriveState(wireguardScenario.actors, steps, index).actorStates
}
function rows(value: StateValue | undefined): readonly (readonly string[])[] {
  return typeof value === 'object' ? value.rows : []
}
function dictionaryStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (typeof value === 'object' && value !== null)
    return Object.values(value).flatMap(dictionaryStrings)
  return []
}
const endpointOf = (steps: readonly Step[], id: string) =>
  rows(stateAt(steps, id).server?.values.peers)[0]?.[1]

describe('wireguardScenario', () => {
  it('すべてのオプション（6 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ situation: 'rekey' }).options).toEqual({ situation: 'rekey' })
    expect(handle.resolve({ situation: 'ipsec' }).options).toEqual({ situation: 'handshake' })
  })

  it('ラベルは 40 文字以内で、ラベルと状態の値は画面の文言と重ならない。最初は矢印のない準備', () => {
    const ui = new Set([...dictionaryStrings(en), ...dictionaryStrings(ja)])
    for (const situation of SITUATIONS) {
      const steps = build(situation)
      expect(steps[0]?.id).toBe('setup')
      expect(steps[0]?.events.every((e) => e.kind === 'stateChange')).toBe(true)
      for (const message of messages(steps)) {
        expect(message.label.length, message.label).toBeLessThanOrEqual(40)
        expect(ui.has(message.label), message.label).toBe(false)
      }
      for (const event of steps.flatMap((step) => step.events)) {
        if (event.kind === 'stateChange' && typeof event.value === 'string') {
          expect(ui.has(event.value), event.value).toBe(false)
        }
      }
    }
  })

  it('メッセージの大きさ: 148、92、64 バイト、データは 16 + 詰めた中身 + 16', () => {
    for (const situation of SITUATIONS) {
      for (const message of messages(build(situation))) {
        const udp = Number(field(message, 'UDP Length'))
        if (message.label.startsWith('Handshake Initiation')) expect(udp).toBe(156)
        if (message.label === 'Handshake Response') expect(udp).toBe(100)
        if (message.label === 'Cookie Reply') expect(udp).toBe(72)
        if (message.label.startsWith('Data ')) {
          const inner = Number(field(message, 'Inner Length') ?? 0)
          const padding = Number(field(message, 'Padding'))
          expect(udp, message.id).toBe(8 + 16 + inner + padding + 16)
          expect((inner + padding) % 16).toBe(0)
          expect(message.encrypted).toBe(true)
        }
      }
    }
  })

  describe('最初のハンドシェイク', () => {
    const steps = build('handshake')

    it('流れ: 1 往復のハンドシェイクのあと、ノート PC が先にデータを送る', () => {
      expect(flow(steps)).toEqual([
        'laptop→nat Handshake Initiation delivered',
        'nat→server Handshake Initiation delivered',
        'server→nat Handshake Response delivered',
        'nat→laptop Handshake Response delivered',
        'laptop→nat Data #1 ctr 0 [Echo Request] delivered',
        'nat→server Data #1 ctr 0 [Echo Request] delivered',
        'server→internal Echo Request 10.8.0.2 → 10.10.0.20 delivered',
        'internal→server Echo Reply 10.10.0.20 → 10.8.0.2 delivered',
        'server→nat Data #1 ctr 0 [Echo Reply] delivered',
        'nat→laptop Data #1 ctr 0 [Echo Reply] delivered',
      ])
    })

    it('84 バイトの ping は 96 に詰め、IP パケットは 156 バイト', () => {
      expect(field(byId(steps, 'ping-wan'), 'IP Length')).toBe('156')
      expect(field(byId(steps, 'ping-wan'), 'Padding')).toBe('12')
      expect(field(byId(steps, 'initiation-wan'), 'IP Length')).toBe('176')
    })

    it('NAT が送信元を書き換え、サーバーは NAT のアドレスをエンドポイントにする', () => {
      expect(field(byId(steps, 'initiation-lan'), 'Outer Src')).toBe('192.168.1.10:47111')
      expect(field(byId(steps, 'initiation-wan'), 'Outer Src')).toBe('203.0.113.5:40001')
      expect(endpointOf(steps, 'initiation')).toBe('203.0.113.5:40001')
    })

    it('応じた側は鍵を確認するまで next に置き、最初のデータで current にする', () => {
      expect(rows(stateAt(steps, 'response').server?.values.keypairs)).toEqual([
        ['previous', '-'],
        ['current', '-'],
        ['next', '#1'],
      ])
      expect(rows(stateAt(steps, 'deliver').server?.values.keypairs)[1]).toEqual(['current', '#1'])
      expect(field(byId(steps, 'response-wan'), 'Receiver')).toBe(INDEX.laptop1)
      expect(field(byId(steps, 'ping-wan'), 'Receiver')).toBe(INDEX.server1)
    })
  })

  it('拒むもの: 送り直し、偽物、許されない内側の送信元、ピアのない宛先。エンドポイントは動かない', () => {
    const steps = build('rejected')
    expect(flow(steps).filter((line) => line.endsWith('rejected'))).toEqual([
      'attacker→server Handshake Initiation (replayed) rejected',
      'attacker→server Data #1 ctr 5 [Echo Request] (replayed) rejected',
      'attacker→server Data #1 ctr 9 [Echo Request] (forged) rejected',
      'internal→server Echo Request 10.10.0.20 → 10.8.0.9 rejected',
    ])
    expect(stateAt(steps, 'replayed-data').server?.values.decision).toBe(
      'drop: counter 5 already seen (duplicate)',
    )
    expect(stateAt(steps, 'wrong-source').server?.values.decision).toBe(
      'drop: src 10.8.0.3 is pub:phone, not pub:laptop (dropped)',
    )
    expect(endpointOf(steps, 'forged')).toBe('203.0.113.5:40001')
    expect(flow(steps).some((line) => line.startsWith('server→internal Echo Request'))).toBe(false)
  })

  it('ローミング: カフェからの認証できたパケットでエンドポイントが変わり、ハンドシェイクはない', () => {
    const steps = build('roaming')
    expect(endpointOf(steps, 'move')).toBe('203.0.113.5:40001')
    expect(field(byId(steps, 'cafe-ping-lan'), 'Outer Src')).toBe(`${ADDR.laptopCafe}:47111`)
    expect(endpointOf(steps, 'roam')).toBe('198.51.100.7:50001')
    expect(field(byId(steps, 'cafe-pong-lan'), 'Outer Dst')).toBe(`${ADDR.laptopCafe}:47111`)
    expect(flow(steps).some((line) => line.includes('Handshake'))).toBe(false)
  })

  it('キープアライブ: 対応が切れると外から届かず、PersistentKeepalive で新しいポートになって届く', () => {
    const steps = build('keepalive')
    expect(byId(steps, 'monitor-1-tunnel-wan')?.status).toBe('rejected')
    expect(field(byId(steps, 'passive-wan'), 'UDP Length')).toBe('40')
    expect(endpointOf(steps, 'persistent')).toBe('203.0.113.5:40002')
    expect(byId(steps, 'monitor-2-tunnel-lan')?.status).toBe('delivered')
    expect(rows(stateAt(steps, 'expire').nat?.values.nat)).toEqual([])
  })

  it('鍵の更新: 始めた側が送るときに始め、応じた側は確認まで #1 で送る', () => {
    const steps = build('rekey')
    expect(flow(steps).slice(3, 5)).toEqual([
      'laptop→nat Handshake Initiation delivered',
      'nat→server Handshake Initiation delivered',
    ])
    expect(byId(steps, 'pong-wan')?.label).toBe('Data #1 ctr 17 [Echo Reply]')
    expect(rows(stateAt(steps, 'response').server?.values.keypairs)).toEqual([
      ['previous', '-'],
      ['current', '#1'],
      ['next', '#2'],
    ])
    expect(rows(stateAt(steps, 'switch').server?.values.keypairs)).toEqual([
      ['previous', '#1'],
      ['current', '#2'],
      ['next', '-'],
    ])
    expect(endpointOf(steps, 'switch')).toBe('203.0.113.5:40001')
  })

  it('負荷が高いとき: cookie をもらい、5 秒後に新しいインデックスと mac2 で送り直す', () => {
    const steps = build('underLoad')
    expect(field(byId(steps, 'cookie-wan'), 'Receiver')).toBe(INDEX.laptop1)
    expect(field(byId(steps, 'retry-wan'), 'Sender')).toBe(INDEX.laptopRetry)
    expect(field(byId(steps, 'retry-wan'), 'mac2')).toBe('MAC(cookie, …)')
    expect(steps.find((step) => step.id === 'wait')?.events).toContainEqual({
      kind: 'timer',
      actorId: 'laptop',
      name: 'REKEY_TIMEOUT',
      durationMs: 5000,
    })
    expect(endpointOf(steps, 'initiation')).toBe('-')
  })

  it('サーバーは、ノート PC から最初のデータを受け取るまで、新しい鍵の組のデータを送らない', () => {
    for (const situation of SITUATIONS) {
      const steps = build(situation)
      const lines = flow(steps)
      const firstServerData = lines.findIndex((line) => line.startsWith('server→nat Data #1'))
      const firstLaptopData = lines.findIndex((line) => line.startsWith('nat→server Data #1'))
      if (situation === 'handshake' || situation === 'underLoad') {
        expect(firstLaptopData).toBeGreaterThanOrEqual(0)
        if (firstServerData >= 0) expect(firstServerData).toBeGreaterThan(firstLaptopData)
      }
    }
  })
})
