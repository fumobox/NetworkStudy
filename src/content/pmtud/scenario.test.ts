// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { pmtudScenario, type PmtudOptions } from './scenario'

const handle = toScenarioHandle(pmtudScenario)
const defaults: PmtudOptions = { df: 'set', icmp: 'delivered' }

function build(overrides: Partial<PmtudOptions> = {}): readonly Step[] {
  return pmtudScenario.buildSteps({ ...defaults, ...overrides })
}

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}

function field(message: Message | undefined, name: string): string | undefined {
  return message?.fields.find((candidate) => candidate.name === name)?.value
}

/** 各メッセージの「from→to ラベル 状態」 */
function flow(steps: readonly Step[]) {
  return messages(steps).map((m) => `${m.from}→${m.to} ${m.label} ${m.status}`)
}

describe('pmtudScenario', () => {
  it('すべてのオプションの組み合わせ（4 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ df: 'clear', icmp: 'filtered' }).options).toEqual({
      df: 'clear',
      icmp: 'filtered',
    })
    expect(handle.resolve({ df: 'maybe', icmp: 'none' }).options).toEqual(defaults)
  })

  describe('パス MTU 探索（RFC 1191、RFC 1812 §5.2.6）', () => {
    it('DF の立った 1500 バイトは捨てられ、ICMP 3/4 で 1492 を知り、1452 と 8 バイトで送り直す', () => {
      expect(flow(build())).toEqual([
        'pc→router DATA 1500 B DF seq=1001 rejected',
        'router→pc Frag Needed (3/4) MTU=1492 delivered',
        'pc→router DATA 1492 B DF seq=1001 delivered',
        'pc→router DATA 48 B DF seq=2453 delivered',
        'router→server DATA 1492 B DF seq=1001 delivered',
        'router→server DATA 48 B DF seq=2453 delivered',
        'server→pc ACK 2461 delivered',
      ])
    })

    it('ICMP には type 3 code 4 と Next-Hop MTU が入る', () => {
      const icmp = messages(build()).find((m) => m.id === 'frag-needed')
      expect([field(icmp, 'ICMP type / code'), field(icmp, 'Next-Hop MTU')]).toEqual([
        '3 / 4',
        '1492',
      ])
    })

    it('パス MTU の記録は 1500 / 1460 → 1492 / 1452（MSS = MTU − 40）', () => {
      const steps = build()
      const at = (id: string) => {
        const value = deriveState(
          pmtudScenario.actors,
          steps,
          steps.findIndex((s) => s.id === id),
        ).actorStates.pc?.values.pmtu
        return typeof value === 'object' ? value.rows : null
      }
      expect(at('start')).toEqual([['192.0.2.10', '1500', '1460']])
      expect(at('update')).toEqual([['192.0.2.10', '1492', '1452']])
    })

    it('ルーターは TTL を 1 減らして転送し、サーバーは 1460 バイトすべてを受け取る', () => {
      const steps = build()
      const forwarded = messages(steps).filter((m) => m.from === 'router' && m.to === 'server')
      expect(forwarded.map((m) => field(m, 'TTL'))).toEqual(['63', '63'])
      expect(
        deriveState(pmtudScenario.actors, steps, steps.length - 1).actorStates.server?.values
          .received,
      ).toBe('1001–2460')
    })

    it('送り直したパケットの TCP Len と Total length', () => {
      const [first, second] = messages(build()).filter((m) => m.id.startsWith('resend'))
      expect([field(first, 'TCP Len'), field(first, 'Total length')]).toEqual([
        '1452',
        '1492 bytes',
      ])
      expect([field(second, 'TCP Len'), field(second, 'Total length')]).toEqual(['8', '48 bytes'])
      expect(first?.retransmitOf).toBe('send-1500')
    })
  })

  describe('もしも', () => {
    it('ICMP が遮られると、同じ大きさで再送し続けて行き詰まる（ブラックホール）', () => {
      const steps = build({ icmp: 'filtered' })
      expect(flow(steps).filter((line) => line.includes('Frag Needed'))).toEqual([
        'router→pc Frag Needed (3/4) MTU=1492 lost',
        'router→pc Frag Needed (3/4) MTU=1492 lost',
        'router→pc Frag Needed (3/4) MTU=1492 lost',
      ])
      expect(messages(steps).some((m) => m.to === 'server')).toBe(false)
      expect(deriveState(pmtudScenario.actors, steps, steps.length - 1).elapsedMs).toBe(3000)
    })

    it('DF を立てなければ、ルーターが 1472 バイトと 8 バイトのフラグメントに分ける（オフセットは 8 バイト単位）', () => {
      const steps = build({ df: 'clear' })
      expect(flow(steps)).toEqual([
        'pc→router DATA 1500 B seq=1001 delivered',
        'router→server Frag 1/2 off=0 MF=1 1492 B delivered',
        'router→server Frag 2/2 off=1472 MF=0 28 B delivered',
        'server→pc ACK 2461 delivered',
      ])
      const second = messages(steps).find((m) => m.id === 'fragment-2')
      expect(field(second, 'Fragment offset')).toBe('184 (× 8 = 1472 bytes)')
      const ids = messages(steps)
        .filter((m) => m.id.startsWith('fragment'))
        .map((m) => field(m, 'Identification'))
      expect(new Set(ids).size).toBe(1)
      const first = messages(steps).find((m) => m.id === 'fragment-1')
      expect([field(first, 'Flags'), field(second, 'Flags')]).toEqual(['DF=0, MF=1', 'DF=0, MF=0'])
      const flagText = (m: Message | undefined) =>
        m?.fields.find((f) => f.name === 'Flags')?.description?.en
      expect(flagText(first)).not.toEqual(flagText(second))
      expect(second?.fields.find((f) => f.name === 'Total length')?.description?.en).toContain(
        'only in the first fragment',
      )
      // ICMP の設定は影響しない
      expect(build({ df: 'clear', icmp: 'filtered' })).toEqual(steps)
    })

    it('ラベルは短い', () => {
      for (const df of ['set', 'clear'] as const) {
        for (const icmp of ['delivered', 'filtered'] as const) {
          expect(
            Math.max(...messages(build({ df, icmp })).map((m) => m.label.length)),
          ).toBeLessThanOrEqual(40)
        }
      }
    })
  })
})
