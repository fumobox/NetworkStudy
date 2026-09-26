// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { icmpScenario, type IcmpOptions } from './scenario'

const handle = toScenarioHandle(icmpScenario)
const defaults: IcmpOptions = { tool: 'ping', outcome: 'reply', probe: 'icmp' }

function build(overrides: Partial<IcmpOptions> = {}): readonly Step[] {
  return icmpScenario.buildSteps({ ...defaults, ...overrides })
}

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}

function field(message: Message, name: string): string | undefined {
  return message.fields.find((candidate) => candidate.name === name)?.value
}

/** 各メッセージの [from, to, ラベル, TTL, type/code, 送信元 → 宛先, 状態] */
function hops(steps: readonly Step[]) {
  return messages(steps).map((m) => [
    m.from,
    m.to,
    m.label,
    field(m, 'TTL'),
    field(m, 'ICMP type / code') ?? field(m, 'UDP port'),
    field(m, 'IP Src → Dst'),
    m.status,
  ])
}

function final(steps: readonly Step[]) {
  const derived = deriveState(icmpScenario.actors, steps, steps.length - 1)
  const results = derived.actorStates.pc?.values.results
  return {
    results: typeof results === 'object' ? results.rows : [],
    elapsedMs: derived.elapsedMs,
  }
}

describe('icmpScenario', () => {
  it('すべてのオプションの組み合わせ（12 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(
      handle.resolve({ tool: 'traceroute', outcome: 'noReply', probe: 'udp' }).options,
    ).toEqual({ tool: 'traceroute', outcome: 'noReply', probe: 'udp' })
    expect(handle.resolve({ tool: 'mtr', outcome: 'lost', probe: 'tcp' }).options).toEqual(defaults)
  })

  describe('ping（RFC 792、RFC 1122 §3.2.2.6、RFC 1812 §5.3.1）', () => {
    it('Echo Request は各ホップで TTL が 1 ずつ減り、Echo Reply が戻る', () => {
      const steps = build()
      expect(hops(steps)).toEqual([
        [
          'pc',
          'router',
          'Echo Request seq=1',
          '64',
          '8 / 0',
          '192.168.1.10 → 192.0.2.10',
          'delivered',
        ],
        [
          'router',
          'isp',
          'Echo Request seq=1',
          '63',
          '8 / 0',
          '192.168.1.10 → 192.0.2.10',
          'delivered',
        ],
        [
          'isp',
          'server',
          'Echo Request seq=1',
          '62',
          '8 / 0',
          '192.168.1.10 → 192.0.2.10',
          'delivered',
        ],
        [
          'server',
          'isp',
          'Echo Reply seq=1',
          '64',
          '0 / 0',
          '192.0.2.10 → 192.168.1.10',
          'delivered',
        ],
        [
          'isp',
          'router',
          'Echo Reply seq=1',
          '63',
          '0 / 0',
          '192.0.2.10 → 192.168.1.10',
          'delivered',
        ],
        [
          'router',
          'pc',
          'Echo Reply seq=1',
          '62',
          '0 / 0',
          '192.0.2.10 → 192.168.1.10',
          'delivered',
        ],
      ])
      expect(final(steps)).toEqual({
        results: [['1', '192.0.2.10', 'Echo Reply ttl=62']],
        elapsedMs: 0,
      })
    })

    it('応答と要求の Identifier / Sequence は同じ', () => {
      const all = messages(build())
      expect(new Set(all.map((m) => field(m, 'Identifier / Sequence')))).toEqual(
        new Set(['0x1234 / 1']),
      )
    })

    it('届けられないと、ISP のルーターが自分のアドレスから Destination Unreachable（3/1）を返す', () => {
      const steps = build({ outcome: 'hostUnreachable' })
      expect(hops(steps).slice(2)).toEqual([
        [
          'isp',
          'router',
          'Destination Unreachable',
          '64',
          '3 / 1',
          '203.0.113.1 → 192.168.1.10',
          'delivered',
        ],
        [
          'router',
          'pc',
          'Destination Unreachable',
          '63',
          '3 / 1',
          '203.0.113.1 → 192.168.1.10',
          'delivered',
        ],
      ])
      expect(final(steps).results).toEqual([
        ['1', '203.0.113.1', 'Destination Host Unreachable (3/1)'],
      ])
    })

    it('応答が失われると、1 秒後に seq=2 を送る', () => {
      const steps = build({ outcome: 'noReply' })
      const reply = messages(steps).find((m) => m.id === 'reply-server')
      expect(reply?.status).toBe('lost')
      expect(messages(steps).filter((m) => m.label === 'Echo Request seq=2')).toHaveLength(3)
      expect(final(steps)).toEqual({
        results: [
          ['1', '-', '(no reply)'],
          ['2', '192.0.2.10', 'Echo Reply ttl=62'],
        ],
        elapsedMs: 1000,
      })
    })

    it('置き換えた説明（Destination Unreachable、Time Exceeded）が入っている', () => {
      const unreach = build({ outcome: 'hostUnreachable' }).find(
        (step) => step.id === 'unreach-isp',
      )
      expect(unreach?.description.en).toContain('code 1 (host unreachable)')
      const exceeded = build({ tool: 'traceroute' }).find((step) => step.id === 'exceeded1-router')
      expect(exceeded?.description.en).toContain('192.168.1.1')
    })

    it('プローブの種類は ping には影響しない', () => {
      expect(build({ probe: 'udp' })).toEqual(build())
    })
  })

  describe('traceroute（RFC 1812 §5.3.1、§4.3.2.4）', () => {
    it('ICMP: TTL 1 は家庭のルーター、TTL 2 は ISP のルーターが Time Exceeded を返し、TTL 3 はサーバーに届く', () => {
      const steps = build({ tool: 'traceroute' })
      expect(hops(steps)).toEqual([
        [
          'pc',
          'router',
          'Echo Request seq=1',
          '1',
          '8 / 0',
          '192.168.1.10 → 192.0.2.10',
          'delivered',
        ],
        [
          'router',
          'pc',
          'Time Exceeded',
          '64',
          '11 / 0',
          '192.168.1.1 → 192.168.1.10',
          'delivered',
        ],
        [
          'pc',
          'router',
          'Echo Request seq=2',
          '2',
          '8 / 0',
          '192.168.1.10 → 192.0.2.10',
          'delivered',
        ],
        [
          'router',
          'isp',
          'Echo Request seq=2',
          '1',
          '8 / 0',
          '192.168.1.10 → 192.0.2.10',
          'delivered',
        ],
        [
          'isp',
          'router',
          'Time Exceeded',
          '64',
          '11 / 0',
          '203.0.113.1 → 192.168.1.10',
          'delivered',
        ],
        [
          'router',
          'pc',
          'Time Exceeded',
          '63',
          '11 / 0',
          '203.0.113.1 → 192.168.1.10',
          'delivered',
        ],
        [
          'pc',
          'router',
          'Echo Request seq=3',
          '3',
          '8 / 0',
          '192.168.1.10 → 192.0.2.10',
          'delivered',
        ],
        [
          'router',
          'isp',
          'Echo Request seq=3',
          '2',
          '8 / 0',
          '192.168.1.10 → 192.0.2.10',
          'delivered',
        ],
        [
          'isp',
          'server',
          'Echo Request seq=3',
          '1',
          '8 / 0',
          '192.168.1.10 → 192.0.2.10',
          'delivered',
        ],
        [
          'server',
          'isp',
          'Echo Reply seq=3',
          '64',
          '0 / 0',
          '192.0.2.10 → 192.168.1.10',
          'delivered',
        ],
        [
          'isp',
          'router',
          'Echo Reply seq=3',
          '63',
          '0 / 0',
          '192.0.2.10 → 192.168.1.10',
          'delivered',
        ],
        [
          'router',
          'pc',
          'Echo Reply seq=3',
          '62',
          '0 / 0',
          '192.0.2.10 → 192.168.1.10',
          'delivered',
        ],
      ])
      expect(final(steps).results).toEqual([
        ['1', '192.168.1.1', 'Time Exceeded (11/0)'],
        ['2', '203.0.113.1', 'Time Exceeded (11/0)'],
        ['3', '192.0.2.10', 'Echo Reply'],
      ])
    })

    it('UDP: 宛先のポートを 33434 から 1 ずつ増やし、最後はサーバーの Port Unreachable（3/3）', () => {
      const steps = build({ tool: 'traceroute', probe: 'udp' })
      const probes = messages(steps).filter((m) => m.from === 'pc')
      expect(probes.map((m) => [field(m, 'UDP port'), field(m, 'Protocol')])).toEqual([
        ['49153 → 33434', '17 (UDP)'],
        ['49153 → 33435', '17 (UDP)'],
        ['49153 → 33436', '17 (UDP)'],
      ])
      const last = messages(steps).find((m) => m.id === 'unreach3-server')
      expect(last === undefined ? null : field(last, 'ICMP type / code')).toBe('3 / 3')
      expect(final(steps).results.at(-1)).toEqual(['3', '192.0.2.10', 'Port Unreachable (3/3)'])
    })

    it('2 ホップ目が答えなければ 5 秒待って * を表示し、3 ホップ目に進む', () => {
      const steps = build({ tool: 'traceroute', outcome: 'noReply' })
      expect(messages(steps).some((m) => m.from === 'isp' && m.label === 'Time Exceeded')).toBe(
        false,
      )
      expect(final(steps)).toEqual({
        results: [
          ['1', '192.168.1.1', 'Time Exceeded (11/0)'],
          ['2', '*', '(no reply)'],
          ['3', '192.0.2.10', 'Echo Reply'],
        ],
        elapsedMs: 5000,
      })
    })

    it('3 ホップ目で届けられなければ、ISP のルーターの Host Unreachable（3/1）で終わる', () => {
      const steps = build({ tool: 'traceroute', outcome: 'hostUnreachable' })
      expect(messages(steps).some((m) => m.to === 'server')).toBe(false)
      expect(final(steps).results.at(-1)).toEqual(['3', '203.0.113.1', 'Host Unreachable (3/1)'])
    })
  })
})
