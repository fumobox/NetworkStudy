// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { vlanScenario, type VlanOptions } from './scenario'

const handle = toScenarioHandle(vlanScenario)
const defaults: VlanOptions = { destination: 'other', vlans: true }

function build(overrides: Partial<VlanOptions> = {}): readonly Step[] {
  return vlanScenario.buildSteps({ ...defaults, ...overrides })
}

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}

/** 各フレームの「from→to ラベル 状態」 */
function frames(steps: readonly Step[]) {
  return messages(steps).map((m) => `${m.from}→${m.to} ${m.label} ${m.status}`)
}

function field(message: Message | undefined, name: string): string | undefined {
  return message?.fields.find((candidate) => candidate.name === name)?.value
}

function switchAt(steps: readonly Step[], stepId: string) {
  const index = steps.findIndex((step) => step.id === stepId)
  const values = deriveState(vlanScenario.actors, steps, index).actorStates.switch?.values
  const table = values?.macTable
  return { table: typeof table === 'object' ? table.rows : null, decision: values?.decision }
}

describe('vlanScenario', () => {
  it('すべてのオプションの組み合わせ（4 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ destination: 'same', vlans: 'false' }).options).toEqual({
      destination: 'same',
      vlans: false,
    })
    expect(handle.resolve({ destination: 'router', vlans: 'x' }).options).toEqual(defaults)
  })

  describe('VLAN 間の通信（IEEE 802.1Q clause 8.6、9、RFC 1812 §5.2）', () => {
    it('ブロードキャストは VLAN 10 の中だけ、VLAN 20 へはルーターを通り、トランクではタグが付く', () => {
      expect(frames(build())).toEqual([
        'pcA→switch ARP who-has 192.168.10.1 delivered',
        'switch→pcB ARP who-has 192.168.10.1 rejected',
        'switch→router ARP who-has 192.168.10.1 [tag 10] delivered',
        'router→switch ARP is-at 00:00:5e:00:53:01 [tag 10] delivered',
        'switch→pcA ARP is-at 00:00:5e:00:53:01 delivered',
        'pcA→switch IP → 192.168.20.30 delivered',
        'switch→router IP → 192.168.20.30 [tag 10] delivered',
        'router→switch IP → 192.168.20.30 [tag 20] delivered',
        'switch→pcC IP → 192.168.20.30 delivered',
      ])
    })

    it('PC C（VLAN 20）には ARP のブロードキャストが届かない', () => {
      const steps = build()
      const flood = steps.find((step) => step.id === 'flood')
      const targets = (flood?.events ?? []).flatMap((e) =>
        e.kind === 'message' ? [e.message.to] : [],
      )
      expect(targets).toEqual(['pcB', 'router'])
      expect(switchAt(steps, 'flood').decision).toBe('flood: ports 2, 4 (VLAN 10)')
    })

    it('タグは TPID 0x8100 と VID。アクセスポートのフレームにはタグがない', () => {
      const all = messages(build())
      const trunk = all.find((m) => m.id === 'flood-router')
      expect([field(trunk, 'TPID'), field(trunk, 'VID'), field(trunk, 'PCP / DEI')]).toEqual([
        '0x8100',
        '10',
        '0 / 0',
      ])
      expect(
        field(
          all.find((m) => m.id === 'route'),
          'VID',
        ),
      ).toBe('20')
      expect(
        field(
          all.find((m) => m.id === 'arp'),
          '802.1Q tag',
        ),
      ).toBe('(none)')
    })

    it('MAC アドレステーブルは VLAN ごと。ルーターは VLAN 10 と 20 の両方でポート 4 に学習される', () => {
      expect(switchAt(build(), 'route')).toEqual({
        table: [
          ['10', '00:00:5e:00:53:0a', '1'],
          ['10', '00:00:5e:00:53:01', '4'],
          ['20', '00:00:5e:00:53:01', '4'],
        ],
        decision: 'flood: port 3 (VLAN 20)',
      })
    })

    it('ルーターを通ると TTL が 1 減り、宛先の MAC アドレスが PC C になる', () => {
      const all = messages(build())
      const before = all.find((m) => m.id === 'send')
      const after = all.find((m) => m.id === 'route')
      expect([field(before, 'TTL'), field(before, 'Eth Dst')]).toEqual(['64', '00:00:5e:00:53:01'])
      expect([field(after, 'TTL'), field(after, 'Eth Dst')]).toEqual(['63', '00:00:5e:00:53:1e'])
    })
  })

  describe('もしも', () => {
    it('同じ VLAN の PC B 宛てなら、ルーターを通らない', () => {
      const steps = build({ destination: 'same' })
      expect(frames(steps).slice(-2)).toEqual([
        'pcA→switch IP → 192.168.10.20 delivered',
        'switch→pcB IP → 192.168.10.20 delivered',
      ])
      expect(
        messages(steps)
          .filter((m) => m.from === 'router')
          .map((m) => m.label),
      ).toEqual([])
    })

    it('VLAN がなければ、ブロードキャストは PC C にも届き、タグは付かない', () => {
      const steps = build({ vlans: false })
      expect(frames(steps).slice(1, 4)).toEqual([
        'switch→pcB ARP who-has 192.168.10.1 rejected',
        'switch→router ARP who-has 192.168.10.1 delivered',
        'switch→pcC ARP who-has 192.168.10.1 rejected',
      ])
      expect(switchAt(steps, 'flood').decision).toBe('flood: ports 2, 3, 4')
      expect(messages(steps).some((m) => m.label.includes('[tag'))).toBe(false)
    })

    it('VLAN がなくても、別のサブネットの PC C へはルーターを通る', () => {
      const labels = messages(build({ vlans: false })).map((m) => `${m.from}→${m.to}`)
      expect(labels).toContain('router→switch')
      expect(switchAt(build({ vlans: false }), 'route').decision).toBe('flood: ports 1, 2, 3')
    })

    it('ラベルは短い', () => {
      for (const destination of ['other', 'same'] as const) {
        for (const vlans of [true, false]) {
          expect(
            Math.max(...messages(build({ destination, vlans })).map((m) => m.label.length)),
          ).toBeLessThanOrEqual(40)
        }
      }
    })
  })
})
