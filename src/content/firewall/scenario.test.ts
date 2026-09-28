// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, StateValue, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { firewallScenario, STRANGER_ISS, UDP_TIMEOUT_MS, type FirewallOptions } from './scenario'

const handle = toScenarioHandle(firewallScenario)
const defaults: FirewallOptions = { policy: 'drop', dnsReply: 'answer' }

function build(overrides: Partial<FirewallOptions> = {}): readonly Step[] {
  return firewallScenario.buildSteps({ ...defaults, ...overrides })
}

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}

/** 各メッセージの「from→to ラベル 状態」 */
function flow(steps: readonly Step[]) {
  return messages(steps).map((m) => `${m.from}→${m.to} ${m.label} ${m.status}`)
}

function field(message: Message | undefined, name: string): string | undefined {
  return message?.fields.find((candidate) => candidate.name === name)?.value
}

function stateAt(steps: readonly Step[], stepId: string) {
  const index = steps.findIndex((step) => step.id === stepId)
  const state = deriveState(firewallScenario.actors, steps, index).actorStates
  const rows = (value: StateValue | undefined) => (typeof value === 'object' ? value.rows : null)
  return {
    conntrack: rows(state.fw?.values.conntrack),
    decision: state.fw?.values.decision,
    pcDns: state.pc?.values.dns,
    stranger: state.stranger?.values.result,
  }
}

const elapsed = (steps: readonly Step[]) =>
  deriveState(firewallScenario.actors, steps, steps.length - 1).elapsedMs

const HANDSHAKE = [
  'pc→fw SYN → 192.0.2.10:443 delivered',
  'fw→server SYN → 192.0.2.10:443 delivered',
  'server→fw SYN, ACK → 203.0.113.10:49152 delivered',
  'fw→pc SYN, ACK → 203.0.113.10:49152 delivered',
  'pc→fw ACK → 192.0.2.10:443 delivered',
  'fw→server ACK → 192.0.2.10:443 delivered',
  'pc→fw Query A www.example.org delivered',
  'fw→resolver Query A www.example.org delivered',
]

describe('firewallScenario', () => {
  it('すべてのオプションの組み合わせ（4 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ policy: 'reject', dnsReply: 'unreachable' }).options).toEqual({
      policy: 'reject',
      dnsReply: 'unreachable',
    })
    expect(handle.resolve({ policy: 'accept', dnsReply: '?' }).options).toEqual(defaults)
  })

  describe('接続の追跡', () => {
    it('外向きの SYN が NEW でエントリーを作り、返事の SYN, ACK は ESTABLISHED で通る', () => {
      const steps = build()
      expect(stateAt(steps, 'syn')).toMatchObject({
        conntrack: [['TCP', '203.0.113.10:49152', '192.0.2.10:443', 'SYN-SENT']],
        decision: 'NEW (out) → rule 2: accept',
      })
      expect(stateAt(steps, 'syn-ack')).toMatchObject({
        conntrack: [['TCP', '203.0.113.10:49152', '192.0.2.10:443', 'SYN-RECEIVED']],
        decision: 'ESTABLISHED (in) → rule 1: accept',
      })
      const synAck = messages(steps).find((m) => m.id === 'syn-ack-in')
      expect(field(synAck, 'State (conntrack)')).toBe('ESTABLISHED (in)')
      expect(stateAt(steps, 'ack').conntrack).toEqual([
        ['TCP', '203.0.113.10:49152', '192.0.2.10:443', 'ESTABLISHED'],
      ])
    })

    it('ルールには返事のためのルールがない（ESTABLISHED と外向きの NEW だけを通す）', () => {
      for (const policy of ['drop', 'reject'] as const) {
        const steps = build({ policy })
        const value = deriveState(firewallScenario.actors, steps, 0).actorStates.fw?.values.rules
        expect(typeof value === 'object' ? value.rows : null).toEqual([
          ['1', 'any', 'ESTABLISHED, RELATED', 'accept'],
          ['2', 'out', 'NEW', 'accept'],
          ['3', 'in', 'NEW', policy],
        ])
      }
    })
  })

  describe('UDP の擬似的な接続', () => {
    it('問い合わせでエントリーができ、応答で REPLIED、タイムアウトで消え、遅れた応答は NEW で捨てる', () => {
      const steps = build()
      expect(flow(steps)).toEqual([
        ...HANDSHAKE,
        'resolver→fw Answer: A 192.0.2.30 delivered',
        'fw→pc Answer: A 192.0.2.30 delivered',
        'resolver→fw Answer: A 192.0.2.30 rejected',
        'stranger→fw SYN → 203.0.113.10:22 rejected',
        'stranger→fw SYN → 203.0.113.10:22 rejected',
      ])
      expect(stateAt(steps, 'dns-query').conntrack?.[1]).toEqual([
        'UDP',
        '203.0.113.10:49153',
        '198.51.100.53:53',
        'UNREPLIED',
      ])
      expect(stateAt(steps, 'dns-reply').conntrack?.[1]?.[3]).toBe('REPLIED')
      expect(stateAt(steps, 'udp-timeout').conntrack).toHaveLength(1)
      expect(stateAt(steps, 'late-answer').decision).toBe('NEW (in) → rule 3: drop')
      const timers = steps.flatMap((step) =>
        step.events.flatMap((event) => (event.kind === 'timer' ? [event.durationMs] : [])),
      )
      expect(timers).toEqual([UDP_TIMEOUT_MS, 1000])
      expect(elapsed(steps)).toBe(31_000)
    })

    it('ICMP の Port Unreachable は、元の UDP のポートを含むので RELATED で通り、エントリーは残る', () => {
      const steps = build({ dnsReply: 'unreachable' })
      const icmp = messages(steps).find((m) => m.id === 'unreachable-in')
      expect([field(icmp, 'ICMP type / code'), field(icmp, 'Original datagram')]).toEqual([
        '3 / 3 (port unreachable)',
        'IP header + UDP 49153 → 53',
      ])
      expect(stateAt(steps, 'dns-unreachable')).toMatchObject({
        decision: 'RELATED (in) → rule 1: accept',
        pcDns: 'failed: port unreachable',
      })
      expect(stateAt(steps, 'dns-unreachable').conntrack?.[1]?.[3]).toBe('UNREPLIED')
      expect(steps.some((step) => step.id === 'late-answer')).toBe(false)
    })
  })

  describe('頼んでいない SYN', () => {
    it('drop: 何も返らず、RTO の後の再送もまた捨てる', () => {
      const steps = build()
      const retry = messages(steps).find((m) => m.id === 'stranger-syn-retry')
      expect(retry?.retransmitOf).toBe('stranger-syn')
      expect(messages(steps).some((m) => m.to === 'stranger')).toBe(false)
      expect(stateAt(steps, 'retry').stranger).toBe('no answer (filtered)')
    })

    it('reject: 閉じたポートと同じ RST, ACK（Seq 0、Ack は SYN の Seq + 1、送信元は PC）で答える', () => {
      const steps = build({ policy: 'reject' })
      const rst = messages(steps).find((m) => m.id === 'rst')
      expect([
        rst?.from,
        rst?.to,
        field(rst, 'Src'),
        field(rst, 'Flags'),
        field(rst, 'Seq'),
        field(rst, 'Ack'),
      ]).toEqual(['fw', 'stranger', '203.0.113.10:22', 'RST, ACK', '0', String(STRANGER_ISS + 1)])
      expect(stateAt(steps, 'rst').stranger).toBe('RST (connection refused)')
      expect(elapsed(steps)).toBe(UDP_TIMEOUT_MS)
    })

    it('reject: 遅れた UDP の応答には ICMP の Port Unreachable で答える', () => {
      expect(flow(build({ policy: 'reject' })).slice(8)).toEqual([
        'resolver→fw Answer: A 192.0.2.30 delivered',
        'fw→pc Answer: A 192.0.2.30 delivered',
        'resolver→fw Answer: A 192.0.2.30 rejected',
        'fw→resolver Port Unreachable (3/3) delivered',
        'stranger→fw SYN → 203.0.113.10:22 rejected',
        'fw→stranger RST, ACK → 192.0.2.66:40000 delivered',
      ])
    })

    it('reject と Port Unreachable: 遅れた応答はなく、頼んでいない SYN には RST で答える', () => {
      expect(flow(build({ policy: 'reject', dnsReply: 'unreachable' })).slice(8)).toEqual([
        'resolver→fw Port Unreachable (3/3) delivered',
        'fw→pc Port Unreachable (3/3) delivered',
        'stranger→fw SYN → 203.0.113.10:22 rejected',
        'fw→stranger RST, ACK → 192.0.2.66:40000 delivered',
      ])
    })

    it('頼んでいないパケットは PC まで届かない', () => {
      for (const policy of ['drop', 'reject'] as const) {
        for (const dnsReply of ['answer', 'unreachable'] as const) {
          const toPc = messages(build({ policy, dnsReply })).filter((m) => m.to === 'pc')
          expect(toPc.map((m) => m.id)).toEqual([
            'syn-ack-fwd',
            dnsReply === 'answer' ? 'answer-fwd' : 'unreachable-fwd',
          ])
        }
      }
    })
  })

  it('ラベルは短い', () => {
    for (const policy of ['drop', 'reject'] as const) {
      for (const dnsReply of ['answer', 'unreachable'] as const) {
        expect(
          Math.max(...messages(build({ policy, dnsReply })).map((m) => m.label.length)),
        ).toBeLessThanOrEqual(40)
      }
    }
  })
})
