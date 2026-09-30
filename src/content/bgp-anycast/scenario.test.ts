// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, StateValue, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { en } from '@/lib/i18n/messages/en'
import { ja } from '@/lib/i18n/messages/ja'
import { ADDR, ANYCAST_PREFIX, AS, bgpAnycastScenario, type BgpAnycastOptions } from './scenario'

const handle = toScenarioHandle(bgpAnycastScenario)
const SITUATIONS = ['propagate', 'withdraw', 'holdTimer', 'routeChange'] as const

const build = (situation: BgpAnycastOptions['situation'] = 'propagate') =>
  bgpAnycastScenario.buildSteps({ situation })
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
  return deriveState(bgpAnycastScenario.actors, steps, index)
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
const anycastNextHop = (steps: readonly Step[], id: string) =>
  rows(stateAt(steps, id).actorStates.isp?.values.fib).find((row) => row[0] === ANYCAST_PREFIX)?.[1]

describe('bgpAnycastScenario', () => {
  it('すべてのオプション（4 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ situation: 'holdTimer' }).options).toEqual({ situation: 'holdTimer' })
    expect(handle.resolve({ situation: 'hijack' }).options).toEqual({ situation: 'propagate' })
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

  it('BGP のメッセージの長さと Marker（RFC 4271 §4）', () => {
    const lengths = new Map<string, string>()
    for (const situation of SITUATIONS) {
      for (const message of messages(build(situation))) {
        const type = field(message, 'Type')
        if (type === undefined) continue
        expect(field(message, 'Marker')).toBe(Array.from({ length: 16 }, () => 'ff').join(' '))
        lengths.set(message.label, field(message, 'Length') ?? '')
      }
    }
    expect(Object.fromEntries(lengths)).toEqual({
      OPEN: '37',
      KEEPALIVE: '19',
      'UPDATE AS_PATH 64511': '47',
      'UPDATE AS_PATH 64500 64511': '51',
      'UPDATE AS_PATH 64511 64511 64511': '55',
      'UPDATE withdraw 203.0.113.0/24': '27',
      NOTIFICATION: '21',
    })
  })

  describe('セッション、経路、短い AS_PATH', () => {
    const steps = build('propagate')

    it('ステップとメッセージの順', () => {
      expect(steps.map((s) => s.id)).toEqual([
        'setup',
        'tcp',
        'open-isp',
        'open-a',
        'keepalive',
        'update-a',
        'update-transit',
        'loop',
        'query',
        'answer',
        'keepalive-30',
      ])
      expect(flow(steps)).toEqual([
        'isp→siteA TCP connection to port 179 delivered',
        'isp→siteA OPEN delivered',
        'siteA→isp OPEN delivered',
        'isp→siteA KEEPALIVE delivered',
        'siteA→isp KEEPALIVE delivered',
        'siteA→isp UPDATE AS_PATH 64511 delivered',
        'transit→isp UPDATE AS_PATH 64500 64511 delivered',
        'transit→siteB UPDATE AS_PATH 64500 64511 rejected',
        'pc→isp DNS query A example.com delivered',
        'isp→siteA DNS query A example.com delivered',
        'siteA→isp DNS answer A 198.51.100.80 delivered',
        'isp→pc DNS answer A 198.51.100.80 delivered',
        'isp→siteA KEEPALIVE delivered',
        'siteA→isp KEEPALIVE delivered',
      ])
    })

    it('Hold Time は小さい方の 90 秒、セッションは Established になる', () => {
      expect(field(byId(steps, 'open-isp'), 'Hold Time')).toBe('90 s')
      expect(field(byId(steps, 'open-a'), 'Hold Time')).toBe('180 s')
      const after = stateAt(steps, 'keepalive').actorStates
      expect(after.isp?.values.session).toBe('Established')
      expect(after.isp?.values.hold).toBe('90 s')
      expect(stateAt(steps, 'keepalive-30').elapsedMs).toBe(30_000)
    })

    it('NEXT_HOP は相手のリンクのアドレス。AS_PATH の短い拠点 A を選ぶ', () => {
      expect(field(byId(steps, 'update-a'), 'NEXT_HOP')).toBe(ADDR.siteA)
      expect(field(byId(steps, 'update-t'), 'NEXT_HOP')).toBe(ADDR.transitToIsp)
      const isp = stateAt(steps, 'update-transit').actorStates.isp
      expect(rows(isp?.values.rib)).toEqual([
        [ANYCAST_PREFIX, 'Site A', '64511', ADDR.siteA, '✓'],
        [ANYCAST_PREFIX, 'Transit', '64500 64511', ADDR.transitToIsp, '-'],
      ])
      expect(isp?.values.decision).toBe('best: via Site A (AS_PATH length 1 is shorter)')
      expect(anycastNextHop(steps, 'update-transit')).toBe(ADDR.siteA)
      expect(stateAt(steps, 'loop').actorStates.siteB?.values.decision).toBe(
        `drop: own AS ${String(AS.anycast)} in AS_PATH`,
      )
    })
  })

  describe('取り下げ', () => {
    const steps = build('withdraw')

    it('取り下げで経路が消え、再送は拠点 B に届く', () => {
      expect(steps.map((s) => s.id)).toEqual([
        'setup',
        'fail',
        'query-dropped',
        'withdraw',
        'retry',
      ])
      expect(byId(steps, 'dropped-2')?.status).toBe('lost')
      expect(anycastNextHop(steps, 'query-dropped')).toBe(ADDR.siteA)
      expect(anycastNextHop(steps, 'withdraw')).toBe(ADDR.transitToIsp)
      expect(field(byId(steps, 'withdraw'), 'Withdrawn Routes')).toBe(ANYCAST_PREFIX)
      expect(
        flow(steps)
          .filter((f) => f.includes('DNS query'))
          .slice(-3),
      ).toEqual([
        'pc→isp DNS query A example.com delivered',
        'isp→transit DNS query A example.com delivered',
        'transit→siteB DNS query A example.com delivered',
      ])
      expect(stateAt(steps, 'retry').actorStates.pc?.values.answer).toContain('from Site B')
      expect(stateAt(steps, 'retry').elapsedMs).toBe(2000)
    })
  })

  describe('Hold Timer', () => {
    const steps = build('holdTimer')

    it('90 秒で NOTIFICATION（4）を送り、経路を消す', () => {
      expect(steps.map((s) => s.id)).toEqual([
        'setup',
        'power',
        'ka-30',
        'blackhole',
        'ka-60',
        'expire',
        'retry',
      ])
      expect(byId(steps, 'ka-lost-1')?.status).toBe('lost')
      expect(byId(steps, 'lost-2')?.status).toBe('lost')
      expect(stateAt(steps, 'ka-60').actorStates.isp?.values.hold).toBe('30 s left')
      const expire = stateAt(steps, 'expire')
      expect(expire.elapsedMs).toBe(90_000)
      expect(field(byId(steps, 'notification'), 'Error Code')).toBe('4 (Hold Timer Expired)')
      expect(expire.actorStates.isp?.values.session).toBe('Idle')
      expect(rows(expire.actorStates.isp?.values.rib).map((row) => row[1])).toEqual(['Transit'])
      expect(anycastNextHop(steps, 'expire')).toBe(ADDR.transitToIsp)
    })
  })

  describe('経路が変わる', () => {
    const steps = build('routeChange')

    it('プリペンドで経路が変わり、拠点 B は RST で答える', () => {
      expect(steps.map((s) => s.id)).toEqual([
        'setup',
        'tcp-ok',
        'prepend',
        'tcp-moved',
        'rst',
        'udp',
      ])
      expect(anycastNextHop(steps, 'tcp-ok')).toBe(ADDR.siteA)
      expect(stateAt(steps, 'prepend').actorStates.isp?.values.decision).toBe(
        'best: via Transit (AS_PATH length 2 is shorter)',
      )
      const moved = byId(steps, 'tcp-moved-3')
      expect(moved?.to).toBe('siteB')
      expect(field(moved, 'Seq')).toBe('1032')
      expect(field(moved, 'Ack')).toBe('5048')
      const rst = byId(steps, 'rst-1')
      expect(rst?.from).toBe('siteB')
      expect(field(rst, 'Flags')).toBe('RST')
      // RFC 9293 §3.10.7.1: <SEQ=SEG.ACK><CTL=RST>
      expect(field(rst, 'Seq')).toBe(field(moved, 'Ack'))
      expect(stateAt(steps, 'rst').actorStates.pc?.values.tcp).toBe('CLOSED (connection reset)')
      expect(stateAt(steps, 'udp').actorStates.pc?.values.answer).toContain('from Site B')
    })
  })
})
