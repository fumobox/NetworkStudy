// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, StateValue, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { en } from '@/lib/i18n/messages/en'
import { ja } from '@/lib/i18n/messages/ja'
import { GROUP, HOST1_IP, HOST2_IP, MAC, vxlanScenario, type VxlanOptions } from './scenario'

const handle = toScenarioHandle(vxlanScenario)
const SITUATIONS = ['firstContact', 'multicast', 'controlPlane', 'tenants', 'mtu', 'ecmp'] as const

const build = (situation: VxlanOptions['situation'] = 'firstContact') =>
  vxlanScenario.buildSteps({ situation })

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
  return deriveState(vxlanScenario.actors, steps, index).actorStates
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
const encapsulated = (steps: readonly Step[]) =>
  messages(steps).filter((m) => m.label.startsWith('VXLAN '))

describe('vxlanScenario', () => {
  it('すべてのオプション（6 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ situation: 'mtu' }).options).toEqual({ situation: 'mtu' })
    expect(handle.resolve({ situation: 'geneve' }).options).toEqual({ situation: 'firstContact' })
  })

  it('ラベルは 40 文字以内で、ラベルと状態の値は画面の文言と重ならない', () => {
    const ui = new Set([...dictionaryStrings(en), ...dictionaryStrings(ja)])
    for (const situation of SITUATIONS) {
      const steps = build(situation)
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

  it('どの状況も、最初は矢印のない準備', () => {
    for (const situation of SITUATIONS) {
      const [setup] = build(situation)
      expect(setup?.id).toBe('setup')
      expect(setup?.events.every((event) => event.kind === 'stateChange')).toBe(true)
    }
  })

  it('包んだパケットはいつも、内側 + 50 バイト、宛先ポート 4789、チェックサム 0。外側の TTL はアンダーレイで 1 減る', () => {
    for (const situation of SITUATIONS) {
      for (const message of encapsulated(build(situation))) {
        const inner = Number(message.fields.find((f) => f.name === 'Inner Length')?.value ?? 28)
        expect(Number(field(message, 'Total Length')) - inner, message.id).toBe(50)
        expect(field(message, 'UDP Dst')).toBe('4789')
        expect(field(message, 'UDP Checksum')).toBe('0')
        expect(field(message, 'TTL')).toBe(message.from === 'underlay' ? '63' : '64')
      }
    }
  })

  describe('最初の通信', () => {
    const steps = build('firstContact')

    it('流れ', () => {
      expect(flow(steps)).toEqual([
        'containerA→vtep1 ARP who-has 10.0.0.2 delivered',
        'vtep1→underlay VXLAN 100 [ARP who-has 10.0.0.2] delivered',
        'underlay→vtep2 VXLAN 100 [ARP who-has 10.0.0.2] delivered',
        'vtep2→containerB ARP who-has 10.0.0.2 delivered',
        'containerB→vtep2 ARP is-at 00:00:5e:00:53:02 delivered',
        'vtep2→underlay VXLAN 100 [ARP is-at 00:00:5e:00:53:02] delivered',
        'underlay→vtep1 VXLAN 100 [ARP is-at 00:00:5e:00:53:02] delivered',
        'vtep1→containerA ARP is-at 00:00:5e:00:53:02 delivered',
        'containerA→vtep1 Echo Request 10.0.0.1 → 10.0.0.2 delivered',
        'vtep1→underlay VXLAN 100 [Echo Request] delivered',
        'underlay→vtep2 VXLAN 100 [Echo Request] delivered',
        'vtep2→containerB Echo Request 10.0.0.1 → 10.0.0.2 delivered',
        'containerB→vtep2 Echo Reply 10.0.0.2 → 10.0.0.1 delivered',
        'vtep2→underlay VXLAN 100 [Echo Reply] delivered',
        'underlay→vtep1 VXLAN 100 [Echo Reply] delivered',
        'vtep1→containerA Echo Reply 10.0.0.2 → 10.0.0.1 delivered',
      ])
    })

    it('VTEP 2 は内側の送信元の MAC アドレスを、外側の送信元の IP アドレスの先として学習する', () => {
      expect(rows(stateAt(steps, 'decap-learn').vtep2?.values.fdb)).toEqual([
        ['100', MAC.a, HOST1_IP, 'learned'],
      ])
      expect(field(byId(steps, 'arp-request-in'), 'Outer IP Src')).toBe(HOST1_IP)
      expect(rows(stateAt(steps, 'learn-back').vtep1?.values.fdb)).toEqual([
        ['100', MAC.a, 'vethA', 'local'],
        ['100', MAC.b, HOST2_IP, 'learned'],
      ])
    })

    it('VXLAN のヘッダーと、84 バイトの ping が 134 バイトになること', () => {
      expect(field(byId(steps, 'echo-out'), 'VXLAN')).toBe('08 00 00 00 00 00 64 00')
      expect(field(byId(steps, 'echo-out'), 'Total Length')).toBe('134')
      expect(field(byId(steps, 'arp-request-out'), 'Total Length')).toBe('78')
    })
  })

  it('マルチキャスト: グループに 1 つ送り、学習するのはユニキャストの送信元。応答はユニキャスト', () => {
    const steps = build('multicast')
    expect(field(byId(steps, 'arp-request-out'), 'Outer IP Dst')).toBe(GROUP)
    expect(field(byId(steps, 'arp-request-out'), 'Outer Eth Dst')).toBe('01:00:5e:7c:00:64')
    expect(rows(stateAt(steps, 'decap-learn').vtep2?.values.fdb)[0]?.[2]).toBe(HOST1_IP)
    expect(field(byId(steps, 'arp-reply-out'), 'Outer IP Dst')).toBe(HOST1_IP)
  })

  it('コントロールプレーン: ARP はアンダーレイを越えず、静的な行は変わらない', () => {
    const steps = build('controlPlane')
    const arpLines = flow(steps).filter((line) => line.includes('ARP'))
    expect(arpLines).toEqual([
      'containerA→vtep1 ARP who-has 10.0.0.2 delivered',
      'vtep1→containerA ARP is-at 00:00:5e:00:53:02 delivered',
    ])
    expect(rows(stateAt(steps, 'echo-reply').vtep2?.values.fdb)).toEqual([
      ['100', MAC.a, HOST1_IP, 'static'],
      ['100', MAC.b, 'vethB', 'local'],
    ])
  })

  it('テナント: 青の ARP は A に届かず、表には両方の VNI の行がある', () => {
    const steps = build('tenants')
    expect(flow(steps).slice(-2)).toEqual([
      'vtep2→underlay VXLAN 200 [ARP who-has 10.0.0.1] delivered',
      'underlay→vtep1 VXLAN 200 [ARP who-has 10.0.0.1] delivered',
    ])
    expect(field(byId(steps, 'blue-arp-out'), 'VNI')).toBe('200')
    const last = stateAt(steps, 'blue-decap')
    expect(last.vtep1?.values.decision).toBe('decap: VNI 200, flood: vethC')
    expect(rows(last.vtep1?.values.fdb).map((row) => row[0])).toEqual(['100', '100', '200'])
    expect(rows(last.containerA?.values.arp)).toEqual([['10.0.0.2', MAC.b]])
  })

  it('MTU: 1500 バイトのパケットは VTEP で捨てられ、再送も捨てられる。直したあとは 1500 にちょうど収まる', () => {
    const steps = build('mtu')
    expect(byId(steps, 'big')?.status).toBe('rejected')
    expect(byId(steps, 'retransmit')?.status).toBe('rejected')
    expect(stateAt(steps, 'big').vtep1?.values.decision).toBe('drop: 1550 > MTU 1500')
    expect(steps.find((step) => step.id === 'rto')?.events[0]).toMatchObject({
      kind: 'timer',
      name: 'RTO',
    })
    expect(field(byId(steps, 'fits-out'), 'Total Length')).toBe('1500')
  })

  it('ECMP: 流れごとに送信元ポートが決まり、2 つの流れは別の経路。同じ流れは同じポートと経路', () => {
    const steps = build('ecmp')
    const port = (id: string) => field(byId(steps, id), 'UDP Src')
    const path = (id: string) => field(byId(steps, id), 'Path')
    expect([port('flow1-out'), path('flow1-out')]).toEqual(['52221', 'spine 1'])
    expect([port('flow2-out'), path('flow2-out')]).toEqual(['62137', 'spine 2'])
    expect([port('flow1-again-out'), path('flow1-again-out')]).toEqual(['52221', 'spine 1'])
    expect(port('reply-out')).toBe('52731')
    expect(field(byId(steps, 'reply-out'), 'UDP Dst')).toBe('4789')
  })

  it('ECMP の表は、その時点までの行だけを持ち、同じ送信元ポートは 1 行', () => {
    const steps = build('ecmp')
    expect(rows(stateAt(steps, 'flow1').underlay?.values.paths)).toEqual([['52221', 'spine 1']])
    expect(rows(stateAt(steps, 'flow1-again').underlay?.values.paths)).toEqual([
      ['52221', 'spine 1'],
      ['62137', 'spine 2'],
    ])
  })

  it('ECMP の状況でなければ、経路のフィールドも表もない', () => {
    for (const situation of SITUATIONS.filter((s) => s !== 'ecmp')) {
      const steps = build(situation)
      expect(
        encapsulated(steps).some((m) => field(m, 'Path') !== undefined),
        situation,
      ).toBe(false)
      const last = deriveState(vxlanScenario.actors, steps, steps.length - 1).actorStates
      expect(rows(last.underlay?.values.paths), situation).toEqual([])
    }
  })

  it('ARP キャッシュも、その時点までの行だけ', () => {
    const steps = build('firstContact')
    expect(rows(stateAt(steps, 'arp-request').containerA?.values.arp)).toEqual([])
    expect(rows(stateAt(steps, 'learn-back').containerA?.values.arp)).toEqual([['10.0.0.2', MAC.b]])
  })
})
