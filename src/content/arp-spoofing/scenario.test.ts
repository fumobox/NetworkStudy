// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { groupFieldsByLayer } from '@/engine/layers'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, StateValue, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { en } from '@/lib/i18n/messages/en'
import { ja } from '@/lib/i18n/messages/ja'
import type { ArpPacket } from './arpCache'
import { ADDRESSES, arpSpoofingScenario, FORGED_REPLY, type ArpSpoofingOptions } from './scenario'

const handle = toScenarioHandle(arpSpoofingScenario)
const SITUATIONS = ['poison', 'dai', 'arpAcl', 'staticEntry'] as const

const build = (situation: ArpSpoofingOptions['situation'] = 'poison') =>
  arpSpoofingScenario.buildSteps({ situation })
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
  expect(index, id).toBeGreaterThanOrEqual(0)
  return deriveState(arpSpoofingScenario.actors, steps, index).actorStates
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

/** Gratuitous ARP: SPA と TPA が同じ（RFC 5227 §2.3 の ARP Announcement もこの形） */
const isGratuitous = (packet: ArpPacket) => packet.spa !== '0.0.0.0' && packet.spa === packet.tpa

const { pc, gateway, attacker, server } = ADDRESSES
const FORGED_LABEL = `ARP ${gateway.ip} is-at ${attacker.mac}`

describe('arpSpoofingScenario', () => {
  it('すべてのオプション（4 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ situation: 'dai' }).options).toEqual({ situation: 'dai' })
    expect(handle.resolve({ situation: 'flood' }).options).toEqual({ situation: 'poison' })
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

  it('偽の応答は、どの状況でも同じフィールド。ユニキャストの応答で、Gratuitous ARP ではない', () => {
    const forged = SITUATIONS.map((situation) => byId(build(situation), 'forge-attacker'))
    for (const message of forged) {
      expect(message?.label).toBe(FORGED_LABEL)
      expect(message?.fields).toEqual(forged[0]?.fields)
    }
    const fields = Object.fromEntries((forged[0]?.fields ?? []).map((f) => [f.name, f.value]))
    expect(fields).toEqual({
      'Eth Dst': pc.mac,
      'Eth Src': attacker.mac,
      EtherType: '0x0806',
      HTYPE: '1',
      PTYPE: '0x0800',
      HLEN: '6',
      PLEN: '4',
      OPER: '2 (reply)',
      SHA: attacker.mac,
      SPA: gateway.ip,
      THA: pc.mac,
      TPA: pc.ip,
    })
    expect(isGratuitous(FORGED_REPLY.packet)).toBe(false)
  })

  it('層: ARP は Ethernet II と ARP、IP は Ethernet II と IPv4、DHCPACK は層なし', () => {
    const layersOf = (message: Message | undefined) =>
      groupFieldsByLayer(message?.fields ?? [])?.map((layer) => layer.layer) ?? null
    const dai = build('dai')
    expect(layersOf(byId(dai, 'forge-attacker'))).toEqual(['eth', 'arp'])
    expect(layersOf(byId(dai, 'intact-pc'))).toEqual(['eth', 'ipv4'])
    expect(layersOf(byId(dai, 'ack-gw'))).toBeNull()
  })

  describe('攻撃', () => {
    const steps = build('poison')

    it('ステップとメッセージの順', () => {
      expect(steps.map((s) => s.id)).toEqual([
        'setup',
        'normal',
        'forge',
        'poisoned',
        'hijacked',
        'relay',
        'reply',
      ])
      const toServer = `IP ${pc.ip} → ${server.ip}`
      const fromServer = `IP ${server.ip} → ${pc.ip}`
      expect(flow(steps)).toEqual([
        `pc→switch ${toServer} delivered`,
        `switch→gateway ${toServer} delivered`,
        `attacker→switch ${FORGED_LABEL} delivered`,
        `switch→pc ${FORGED_LABEL} delivered`,
        `pc→switch ${toServer} delivered`,
        `switch→attacker ${toServer} delivered`,
        `attacker→switch ${toServer} delivered`,
        `switch→gateway ${toServer} delivered`,
        `gateway→switch ${fromServer} delivered`,
        `switch→pc ${fromServer} delivered`,
      ])
    })

    it('PC A のキャッシュだけが書き換わり、ゲートウェイのキャッシュは正しいまま', () => {
      expect(rows(stateAt(steps, 'forge').pc?.values.cache)).toEqual([
        [gateway.ip, gateway.mac, 'dynamic'],
      ])
      const after = stateAt(steps, 'poisoned')
      expect(rows(after.pc?.values.cache)).toEqual([[gateway.ip, attacker.mac, 'dynamic']])
      expect(after.pc?.values.decision).toBe(`updated: ${gateway.ip} → ${attacker.mac}`)
      expect(after.pc?.values.nextHop).toBe(`${attacker.mac} (attacker)`)
      expect(rows(stateAt(steps, 'reply').gateway?.values.cache)).toEqual([
        [pc.ip, pc.mac, 'dynamic'],
      ])
    })

    it('スイッチの MAC アドレステーブルは正しいまま（偽の応答も送信元の MAC アドレスは本物）', () => {
      expect(stateAt(steps, 'reply').switch?.values.macTable).toEqual(
        stateAt(steps, 'setup').switch?.values.macTable,
      )
    })

    it('奪われたパケットは宛先の MAC アドレスだけが変わり、攻撃者がゲートウェイへ渡す', () => {
      expect(field(byId(steps, 'normal-pc'), 'Eth Dst')).toBe(gateway.mac)
      const hijacked = byId(steps, 'hijacked-pc')
      expect(field(hijacked, 'Eth Dst')).toBe(attacker.mac)
      expect(field(hijacked, 'IP Dst')).toBe(server.ip)
      const relayed = byId(steps, 'relay-attacker')
      expect(field(relayed, 'Eth Src')).toBe(attacker.mac)
      expect(field(relayed, 'Eth Dst')).toBe(gateway.mac)
      expect(field(relayed, 'IP Src')).toBe(pc.ip)
      expect(field(byId(steps, 'reply-pc'), 'Eth Src')).toBe(gateway.mac)
      expect(rows(stateAt(steps, 'relay').attacker?.values.captured)).toEqual([
        [`IP ${pc.ip} → ${server.ip}`, `gateway (${gateway.mac})`],
      ])
    })
  })

  describe('DAI と DHCP スヌーピング', () => {
    const steps = build('dai')

    it('DHCPACK で束縛を記録し、PC A の要求は通り、偽の応答は捨てる', () => {
      expect(steps.map((s) => s.id)).toEqual([
        'setup',
        'dhcp-ack',
        'arp-request',
        'arp-reply',
        'forge',
        'intact',
      ])
      expect(rows(stateAt(steps, 'setup').switch?.values.bindings)).toEqual([
        [attacker.ip, attacker.mac, '3', '3600 s'],
      ])
      expect(rows(stateAt(steps, 'dhcp-ack').switch?.values.bindings)).toEqual([
        [attacker.ip, attacker.mac, '3', '3600 s'],
        [pc.ip, pc.mac, '1', '3600 s'],
      ])
      expect(stateAt(steps, 'arp-request').switch?.values.dai).toBe(
        `permit: bound ${pc.ip} ↔ ${pc.mac} (port 1)`,
      )
      expect(stateAt(steps, 'arp-reply').switch?.values.dai).toBe('bypass: trusted port 2')
      expect(stateAt(steps, 'forge').switch?.values.dai).toBe(
        `drop: no binding for ${gateway.ip} ↔ ${attacker.mac} (port 3)`,
      )
      expect(flow(steps).filter((f) => f.includes(FORGED_LABEL))).toEqual([
        `attacker→switch ${FORGED_LABEL} rejected`,
      ])
      expect(field(byId(steps, 'ack-gw'), 'yiaddr')).toBe(pc.ip)
      expect(field(byId(steps, 'ack-gw'), 'chaddr')).toBe(pc.mac)
    })

    it('要求はゲートウェイに届き、攻撃者は対象ではない。PC A のキャッシュは本物のまま', () => {
      expect(byId(steps, 'req-gw')?.status).toBe('delivered')
      expect(byId(steps, 'req-attacker')?.status).toBe('rejected')
      const end = stateAt(steps, 'intact')
      expect(rows(end.pc?.values.cache)).toEqual([[gateway.ip, gateway.mac, 'dynamic']])
      expect(rows(end.gateway?.values.cache)).toEqual([[pc.ip, pc.mac, 'dynamic']])
      expect(end.pc?.values.decision).toBe(`added: ${gateway.ip} → ${gateway.mac}`)
    })
  })

  describe('静的な IP アドレスと ARP ACL', () => {
    const steps = build('arpAcl')

    it('束縛がないと PC A 自身の要求が捨てられ、ACL を足すと通る。偽の応答は捨てる', () => {
      expect(steps.map((s) => s.id)).toEqual([
        'setup',
        'arp-dropped',
        'acl',
        'arp-request',
        'arp-reply',
        'forge',
      ])
      expect(byId(steps, 'dropped-pc')?.status).toBe('rejected')
      expect(stateAt(steps, 'arp-dropped').switch?.values.dai).toBe(
        `drop: no binding for ${pc.ip} ↔ ${pc.mac} (port 1)`,
      )
      expect(rows(stateAt(steps, 'arp-dropped').pc?.values.cache)).toEqual([])
      expect(stateAt(steps, 'arp-request').switch?.values.dai).toBe(
        `permit: ARP ACL ${pc.ip} ↔ ${pc.mac} (port 1)`,
      )
      expect(byId(steps, 'forge-attacker')?.status).toBe('rejected')
      expect(rows(stateAt(steps, 'forge').pc?.values.cache)).toEqual([
        [gateway.ip, gateway.mac, 'dynamic'],
      ])
    })
  })

  describe('静的な ARP エントリー', () => {
    const steps = build('staticEntry')

    it('偽の応答は届くが、静的なエントリーは書き換わらない', () => {
      expect(steps.map((s) => s.id)).toEqual(['setup', 'forge', 'ignored', 'intact'])
      expect(byId(steps, 'forge-pc')?.status).toBe('delivered')
      const after = stateAt(steps, 'ignored')
      expect(rows(after.pc?.values.cache)).toEqual([[gateway.ip, gateway.mac, 'static']])
      expect(after.pc?.values.decision).toBe('ignored: static entry')
      expect(field(byId(steps, 'intact-pc'), 'Eth Dst')).toBe(gateway.mac)
    })
  })
})
