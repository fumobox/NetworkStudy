// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { switchingScenario, type SwitchingOptions } from './scenario'

const handle = toScenarioHandle(switchingScenario)
const defaults: SwitchingOptions = { firstFrame: 'unicast', known: false, aging: false }

function build(overrides: Partial<SwitchingOptions> = {}): readonly Step[] {
  return switchingScenario.buildSteps({ ...defaults, ...overrides })
}

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}

/** 各メッセージの [from, to, ラベル, 状態] */
function frames(steps: readonly Step[]) {
  return messages(steps).map((m) => [m.from, m.to, m.label, m.status])
}

function switchAt(steps: readonly Step[], stepId: string) {
  const index = steps.findIndex((step) => step.id === stepId)
  const values = deriveState(switchingScenario.actors, steps, index).actorStates.switch?.values
  const table = values?.macTable
  return { table: typeof table === 'object' ? table.rows : null, decision: values?.decision }
}

const PC = '00:00:5e:00:53:0a'
const ROUTER = '00:00:5e:00:53:01'

describe('switchingScenario', () => {
  it('すべてのオプションの組み合わせ（8 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(
      handle.resolve({ firstFrame: 'broadcast', known: 'true', aging: 'true' }).options,
    ).toEqual({ firstFrame: 'broadcast', known: true, aging: true })
    expect(handle.resolve({ firstFrame: 'multicast', known: '?', aging: 'x' }).options).toEqual(
      defaults,
    )
  })

  describe('学習とフラッディング（IEEE 802.1Q clause 8.6、8.7）', () => {
    it('宛先が不明ならほかの全ポートに流し、応答で学習したあとは 1 つのポートにだけ送る', () => {
      expect(frames(build())).toEqual([
        ['pc', 'switch', `Echo Request → ${ROUTER}`, 'delivered'],
        ['switch', 'router', `Echo Request → ${ROUTER}`, 'delivered'],
        ['switch', 'pc2', `Echo Request → ${ROUTER}`, 'rejected'],
        ['router', 'switch', `Echo Reply → ${PC}`, 'delivered'],
        ['switch', 'pc', `Echo Reply → ${PC}`, 'delivered'],
        ['pc', 'switch', `Echo Request → ${ROUTER}`, 'delivered'],
        ['switch', 'router', `Echo Request → ${ROUTER}`, 'delivered'],
      ])
    })

    it('学習するのは送信元の MAC アドレスと入ってきたポートだけ（宛先からは学習しない）', () => {
      const steps = build()
      expect(switchAt(steps, 'frame1')).toEqual({ table: [[PC, '1']], decision: 'learn: port 1' })
      expect(switchAt(steps, 'flood')).toEqual({
        table: [[PC, '1']],
        decision: 'flood: ports 2, 3',
      })
      expect(switchAt(steps, 'reply')).toEqual({
        table: [
          [PC, '1'],
          [ROUTER, '2'],
        ],
        decision: 'learn: port 2',
      })
      expect(switchAt(steps, 'frame2').decision).toBe('forward: port 2')
    })

    it('流されたフレームは PC 2 が捨てる（自分の MAC アドレス宛てではない）', () => {
      const steps = build()
      const index = steps.findIndex((step) => step.id === 'flood')
      const state = deriveState(switchingScenario.actors, steps, index).actorStates
      expect(state.pc2?.values.lastFrame).toBe('dropped (not my MAC)')
      expect(state.router?.values.lastFrame).toBe('accepted')
    })

    it('フレームには入ったポートと出ていくポートを示す', () => {
      const all = messages(build())
      const port = (m: Message | undefined) =>
        m?.fields.find((f) => f.name === 'Ingress port' || f.name === 'Egress port')?.value
      expect(all.map(port)).toEqual(['1', '2', '3', '2', '1', '1', '2'])
    })
  })

  describe('もしも', () => {
    it('ブロードキャスト（ARP の要求）は、表に関係なく全ポートに流す', () => {
      const steps = build({ firstFrame: 'broadcast', known: true })
      expect(frames(steps).slice(0, 3)).toEqual([
        ['pc', 'switch', 'ARP who-has 192.168.1.1', 'delivered'],
        ['switch', 'router', 'ARP who-has 192.168.1.1', 'delivered'],
        ['switch', 'pc2', 'ARP who-has 192.168.1.1', 'rejected'],
      ])
      expect(switchAt(steps, 'flood').decision).toBe('flood: broadcast')
      const eth = messages(steps)[0]?.fields.find((f) => f.name === 'Eth Dst')?.value
      expect(eth).toBe('ff:ff:ff:ff:ff:ff')
    })

    it('学習済みなら、最初のフレームからポート 2 にだけ送り、PC 2 には何も届かない', () => {
      const steps = build({ known: true })
      expect(messages(steps).some((m) => m.to === 'pc2')).toBe(false)
      expect(switchAt(steps, 'forward-known').decision).toBe('forward: port 2')
      expect(switchAt(steps, 'reply').decision).toBe('refresh: port 2')
    })

    it('エージングタイム（300 秒）が過ぎると表が空になり、次のフレームはまた流される', () => {
      const steps = build({ aging: true })
      expect(switchAt(steps, 'ageing')).toEqual({ table: [], decision: 'aged out' })
      expect(frames(steps).slice(-3)).toEqual([
        ['pc', 'switch', `Echo Request → ${ROUTER}`, 'delivered'],
        ['switch', 'router', `Echo Request → ${ROUTER}`, 'delivered'],
        ['switch', 'pc2', `Echo Request → ${ROUTER}`, 'rejected'],
      ])
      expect(deriveState(switchingScenario.actors, steps, steps.length - 1).elapsedMs).toBe(300_000)
    })

    it('ラベルは短い（2 レーンの間に収まる）', () => {
      for (const firstFrame of ['unicast', 'broadcast'] as const) {
        expect(
          Math.max(...messages(build({ firstFrame })).map((m) => m.label.length)),
        ).toBeLessThanOrEqual(40)
      }
    })
  })
})
