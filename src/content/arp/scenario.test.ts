// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { arpScenario, type ArpOptions } from './scenario'

const handle = toScenarioHandle(arpScenario)
const defaults: ArpOptions = { destination: 'internet', cached: false, reply: 'ok' }

function build(overrides: Partial<ArpOptions> = {}): readonly Step[] {
  return arpScenario.buildSteps({ ...defaults, ...overrides })
}

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}

function fields(message: Message | undefined): Record<string, string> {
  return Object.fromEntries(message?.fields.map((field) => [field.name, field.value]) ?? [])
}

function finalState(steps: readonly Step[]) {
  const derived = deriveState(arpScenario.actors, steps, steps.length - 1)
  const rows = (actor: string) => {
    const value = derived.actorStates[actor]?.values.cache
    return typeof value === 'object' ? value.rows : []
  }
  return {
    nextHop: derived.actorStates.pc?.values.nextHop,
    pending: derived.actorStates.pc?.values.pending,
    pc: rows('pc'),
    router: rows('router'),
    pc2: rows('pc2'),
    elapsedMs: derived.elapsedMs,
  }
}

describe('arpScenario', () => {
  it('すべてのオプションの組み合わせで整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ destination: 'local', cached: '1', reply: 'none' }).options).toEqual({
      destination: 'local',
      cached: true,
      reply: 'none',
    })
    expect(handle.resolve({ destination: 'moon', reply: 'maybe' }).options).toEqual(defaults)
  })

  describe('インターネットの宛先（RFC 826、RFC 1122 §3.3.1）', () => {
    const steps = build()

    it('ゲートウェイに決め、ブロードキャストで尋ね、ユニキャストで答えを受け取って送る', () => {
      expect(steps.map((step) => step.id)).toEqual([
        'decide',
        'miss',
        'request',
        'reply',
        'cache',
        'send',
      ])
      expect(messages(steps).map((m) => [m.label, m.from, m.to, m.status])).toEqual([
        ['ARP who-has 192.168.1.1', 'pc', 'router', 'delivered'],
        ['ARP who-has 192.168.1.1', 'pc', 'pc2', 'rejected'],
        ['ARP is-at 00:00:5e:00:53:01', 'router', 'pc', 'delivered'],
        ['IP 192.168.1.10 → 192.0.2.10', 'pc', 'router', 'delivered'],
      ])
    })

    it('要求と応答のフィールド', () => {
      const [request, , reply] = messages(steps)
      expect(fields(request)).toEqual({
        'Eth Dst': 'ff:ff:ff:ff:ff:ff',
        'Eth Src': '00:00:5e:00:53:0a',
        EtherType: '0x0806',
        HTYPE: '1',
        PTYPE: '0x0800',
        HLEN: '6',
        PLEN: '4',
        OPER: '1 (request)',
        SHA: '00:00:5e:00:53:0a',
        SPA: '192.168.1.10',
        THA: '00:00:00:00:00:00',
        TPA: '192.168.1.1',
      })
      expect(fields(reply)).toEqual({
        'Eth Dst': '00:00:5e:00:53:0a',
        'Eth Src': '00:00:5e:00:53:01',
        EtherType: '0x0806',
        HTYPE: '1',
        PTYPE: '0x0800',
        HLEN: '6',
        PLEN: '4',
        OPER: '2 (reply)',
        SHA: '00:00:5e:00:53:01',
        SPA: '192.168.1.1',
        THA: '00:00:5e:00:53:0a',
        TPA: '192.168.1.10',
      })
    })

    it('IP パケットのフレームの宛先はルーターの MAC アドレス、IP の宛先はサーバーのまま', () => {
      const packet = messages(steps).at(-1)
      expect(fields(packet)).toMatchObject({
        'Eth Dst': '00:00:5e:00:53:01',
        EtherType: '0x0800',
        'IP Src': '192.168.1.10',
        'IP Dst': '192.0.2.10',
      })
    })

    it('対象のルーターは PC を覚え、対象でない PC 2 は覚えない', () => {
      expect(finalState(steps)).toEqual({
        nextHop: '192.168.1.1',
        pending: 'sent',
        pc: [['192.168.1.1', '00:00:5e:00:53:01']],
        router: [['192.168.1.10', '00:00:5e:00:53:0a']],
        pc2: [],
        elapsedMs: 0,
      })
    })
  })

  it('同じ LAN の宛先では、PC 2 に直接尋ねて直接送る', () => {
    const steps = build({ destination: 'local' })
    expect(messages(steps).map((m) => [m.label, m.from, m.to, m.status])).toEqual([
      ['ARP who-has 192.168.1.20', 'pc', 'pc2', 'delivered'],
      ['ARP who-has 192.168.1.20', 'pc', 'router', 'rejected'],
      ['ARP is-at 00:00:5e:00:53:14', 'pc2', 'pc', 'delivered'],
      ['IP 192.168.1.10 → 192.168.1.20', 'pc', 'pc2', 'delivered'],
    ])
    expect(fields(messages(steps).at(-1))['Eth Dst']).toBe('00:00:5e:00:53:14')
    expect(finalState(steps)).toMatchObject({
      nextHop: '192.168.1.20',
      router: [],
      pc2: [['192.168.1.10', '00:00:5e:00:53:0a']],
    })
  })

  it('キャッシュにあれば ARP を使わずに送る', () => {
    const steps = build({ cached: true })
    expect(steps.map((step) => step.id)).toEqual(['decide', 'hit', 'send'])
    expect(messages(steps).map((m) => m.label)).toEqual(['IP 192.168.1.10 → 192.0.2.10'])
    // 応答なしの What-if はキャッシュがあると影響しない
    expect(build({ cached: true, reply: 'none' })).toEqual(steps)
  })

  it('応答がなければ 1 秒おきに 3 回尋ね、3 回目の 1 秒後にあきらめてパケットを捨てる', () => {
    const steps = build({ reply: 'none' })
    expect(steps.map((step) => step.id)).toEqual([
      'decide',
      'miss',
      'request',
      'retry-1',
      'retry-2',
      'failed',
    ])
    const toTarget = messages(steps).filter((m) => m.to === 'router')
    expect(toTarget.map((m) => [m.id, m.status, m.retransmitOf])).toEqual([
      ['arp-req-target', 'lost', undefined],
      ['arp-req-target-1', 'lost', 'arp-req-target'],
      ['arp-req-target-2', 'lost', 'arp-req-target'],
    ])
    expect(messages(steps).some((m) => m.id === 'ip')).toBe(false)
    expect(finalState(steps)).toMatchObject({
      pending: 'dropped',
      pc: [['192.168.1.1', '(failed)']],
      router: [],
      elapsedMs: 3000,
    })
  })
})
