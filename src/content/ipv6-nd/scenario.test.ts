// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, StateValue, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { ipv6NdScenario, type Ipv6NdOptions } from './scenario'

const handle = toScenarioHandle(ipv6NdScenario)
const defaults: Ipv6NdOptions = { duplicate: false, router: 'present' }

function build(overrides: Partial<Ipv6NdOptions> = {}): readonly Step[] {
  return ipv6NdScenario.buildSteps({ ...defaults, ...overrides })
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

function pcAt(steps: readonly Step[], stepId: string) {
  const index = steps.findIndex((step) => step.id === stepId)
  const values = deriveState(ipv6NdScenario.actors, steps, index).actorStates.pc?.values
  const rows = (value: StateValue | undefined) => (typeof value === 'object' ? value.rows : null)
  return {
    addresses: rows(values?.addresses),
    neighbors: rows(values?.neighbors),
    defaultRouter: values?.defaultRouter,
    dns: values?.dns,
  }
}

const LL = 'fe80::200:5eff:fe00:530a'
const GLOBAL = '2001:db8:1:0:200:5eff:fe00:530a'
const PC2 = '2001:db8:1:0:200:5eff:fe00:5314'

describe('ipv6NdScenario', () => {
  it('すべてのオプションの組み合わせ（4 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ duplicate: 'true', router: 'none' }).options).toEqual({
      duplicate: true,
      router: 'none',
    })
    expect(handle.resolve({ duplicate: '?', router: 'dhcp' }).options).toEqual(defaults)
  })

  describe('SLAAC と近隣探索（RFC 4862、RFC 4861）', () => {
    it('DAD → RS → RA → DAD → NS → NA → 送信の順。マルチキャストはグループの機器だけが受け取る', () => {
      expect(flow(build())).toEqual([
        `pc→router NS (DAD) ${LL} rejected`,
        `pc→pc2 NS (DAD) ${LL} rejected`,
        'pc→router RS → ff02::2 delivered',
        'pc→pc2 RS → ff02::2 rejected',
        'router→pc RA 2001:db8:1::/64 delivered',
        'router→pc2 RA 2001:db8:1::/64 delivered',
        'pc→router NS (DAD, global address) rejected',
        'pc→pc2 NS (DAD, global address) rejected',
        'pc→router NS target …:fe00:5314 rejected',
        'pc→pc2 NS target …:fe00:5314 delivered',
        'pc2→pc NA is-at 00:00:5e:00:53:14 delivered',
        `pc→pc2 IPv6 → ${PC2} delivered`,
      ])
    })

    it('DAD の NS は送信元が :: で、宛先は要請ノードマルチキャスト、ホップリミットは 255', () => {
      const dad = messages(build())[0]
      expect(
        ['IPv6 Src', 'IPv6 Dst', 'Eth Dst', 'Hop Limit', 'ICMPv6 type', 'Target'].map((name) =>
          field(dad, name),
        ),
      ).toEqual([
        '::',
        'ff02::1:ff00:530a',
        '33:33:ff:00:53:0a',
        '255',
        '135 (Neighbor Solicitation)',
        LL,
      ])
    })

    it('アドレスは tentative → preferred。DAD はそれぞれ 1 秒（RetransTimer）待つ', () => {
      const steps = build()
      expect(pcAt(steps, 'link-local').addresses).toEqual([[LL, 'tentative']])
      expect(pcAt(steps, 'dad').addresses).toEqual([[LL, 'preferred']])
      expect(pcAt(steps, 'slaac').addresses).toEqual([
        [LL, 'preferred'],
        [GLOBAL, 'preferred'],
      ])
      expect(deriveState(ipv6NdScenario.actors, steps, steps.length - 1).elapsedMs).toBe(2000)
    })

    it('RA でデフォルトルーター（リンクローカル）、DNS、ルーターの MAC アドレスを知る', () => {
      const steps = build()
      expect(pcAt(steps, 'ra')).toMatchObject({
        defaultRouter: 'fe80::200:5eff:fe00:5301',
        dns: '2001:db8:1::53',
        neighbors: [['fe80::200:5eff:fe00:5301', '00:00:5e:00:53:01', 'STALE']],
      })
      const ra = messages(steps).find((m) => m.id === 'ra-pc')
      expect(field(ra, 'Prefix Information')).toBe(
        '2001:db8:1::/64, L 1, A 1, valid 2592000 s, preferred 604800 s',
      )
      expect(field(ra, 'Flags')).toBe('M 0, O 0')
    })

    it('アドレス解決: 近隣キャッシュは INCOMPLETE → REACHABLE', () => {
      const steps = build()
      expect(pcAt(steps, 'resolve').neighbors?.at(-1)).toEqual([PC2, '-', 'INCOMPLETE'])
      expect(pcAt(steps, 'na').neighbors?.at(-1)).toEqual([PC2, '00:00:5e:00:53:14', 'REACHABLE'])
      const na = messages(steps).find((m) => m.id === 'na')
      expect(field(na, 'Flags')).toBe('R 0, S 1, O 1')
    })
  })

  describe('もしも', () => {
    it('アドレスが重複していると、PC 2 がすべてのノードへ NA を返し、PC はアドレスを使わない', () => {
      const steps = build({ duplicate: true })
      expect(flow(steps)).toEqual([
        `pc→router NS (DAD) ${LL} rejected`,
        `pc→pc2 NS (DAD) ${LL} delivered`,
        `pc2→pc NA ${LL} delivered`,
        `pc2→router NA ${LL} rejected`,
      ])
      expect(field(messages(steps)[2], 'IPv6 Dst')).toBe('ff02::1')
      expect(pcAt(steps, 'duplicate-found').addresses).toEqual([[LL, 'duplicate']])
    })

    it('ルーターがなければ RS を 4 秒おきに 3 回送り、リンクローカルだけで終わる', () => {
      const steps = build({ router: 'none' })
      expect(flow(steps).filter((line) => line.includes('RS'))).toHaveLength(6)
      expect(messages(steps).every((m) => m.status === 'rejected')).toBe(true)
      expect(pcAt(steps, 'no-router')).toMatchObject({
        addresses: [[LL, 'preferred']],
        defaultRouter: 'none',
      })
      // DAD の 1 秒と、RS の間の 4 秒 × 2、最後の待ち 4 秒
      expect(deriveState(ipv6NdScenario.actors, steps, steps.length - 1).elapsedMs).toBe(13_000)
    })

    it('ラベルは短い', () => {
      for (const duplicate of [false, true]) {
        for (const router of ['present', 'none'] as const) {
          expect(
            Math.max(...messages(build({ duplicate, router })).map((m) => m.label.length)),
          ).toBeLessThanOrEqual(40)
        }
      }
    })
  })
})
