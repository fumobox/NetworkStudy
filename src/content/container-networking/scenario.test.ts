// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, StateValue, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { en } from '@/lib/i18n/messages/en'
import { ja } from '@/lib/i18n/messages/ja'
import {
  containerNetworkingScenario,
  DEFAULT_NETWORK,
  HOST_IP,
  MAC,
  USER_NETWORK,
  type ContainerNetworkingOptions,
} from './scenario'

const handle = toScenarioHandle(containerNetworkingScenario)
const SITUATIONS = [
  'outbound',
  'published',
  'sameBridge',
  'userNetwork',
  'twoContainers',
  'unpublished',
] as const

const build = (situation: ContainerNetworkingOptions['situation'] = 'outbound') =>
  containerNetworkingScenario.buildSteps({ situation })

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
  return deriveState(containerNetworkingScenario.actors, steps, index).actorStates
}
function rows(value: StateValue | undefined): readonly (readonly string[])[] {
  return typeof value === 'object' ? value.rows : []
}

/** 辞書の文字列をすべて集める（関数は除く） */
function dictionaryStrings(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value]
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(dictionaryStrings)
  }
  return []
}

const OUTBOUND = [
  'containerA→bridge ARP who-has 172.17.0.1 delivered',
  'bridge→host ARP who-has 172.17.0.1 delivered',
  'bridge→containerB ARP who-has 172.17.0.1 delivered',
  'host→bridge ARP is-at 00:00:5e:00:53:01 delivered',
  'bridge→containerA ARP is-at 00:00:5e:00:53:01 delivered',
  'containerA→bridge SYN 172.17.0.2 → 203.0.113.80 delivered',
  'bridge→host SYN 172.17.0.2 → 203.0.113.80 delivered',
  'host→external SYN 198.51.100.10 → 203.0.113.80 delivered',
  'external→host SYN, ACK 203.0.113.80 → 198.51.100.10 delivered',
  'host→bridge SYN, ACK 203.0.113.80 → 172.17.0.2 delivered',
  'bridge→containerA SYN, ACK 203.0.113.80 → 172.17.0.2 delivered',
  'containerA→bridge ACK 172.17.0.2 → 203.0.113.80 delivered',
  'bridge→host ACK 172.17.0.2 → 203.0.113.80 delivered',
  'host→external ACK 198.51.100.10 → 203.0.113.80 delivered',
]

describe('containerNetworkingScenario', () => {
  it('すべてのオプション（6 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ situation: 'published' }).options).toEqual({ situation: 'published' })
    expect(handle.resolve({ situation: 'hairpin' }).options).toEqual({ situation: 'outbound' })
  })

  it('ラベルは 40 文字以内', () => {
    for (const situation of SITUATIONS) {
      expect(
        Math.max(...messages(build(situation)).map((m) => m.label.length)),
      ).toBeLessThanOrEqual(40)
    }
  })

  it('ラベルと状態の値は、画面の文言と重ならない（e2e がボタンなどを名前で探すため）', () => {
    const ui = new Set([...dictionaryStrings(en), ...dictionaryStrings(ja)])
    for (const situation of SITUATIONS) {
      const steps = build(situation)
      for (const message of messages(steps)) {
        expect(ui.has(message.label), message.label).toBe(false)
      }
      for (const step of steps) {
        for (const event of step.events) {
          if (event.kind === 'stateChange' && typeof event.value === 'string') {
            expect(ui.has(event.value), event.value).toBe(false)
          }
        }
      }
    }
  })

  it('どの状況も、最初のステップは準備で、矢印がない', () => {
    for (const situation of SITUATIONS) {
      const [setup] = build(situation)
      expect(setup?.id).toBe('setup')
      expect(setup?.events.every((event) => event.kind === 'stateChange')).toBe(true)
    }
  })

  describe('外へ（MASQUERADE）', () => {
    const steps = build('outbound')

    it('流れ', () => {
      expect(flow(steps)).toEqual(OUTBOUND)
    })

    it('ARP のブロードキャストは、B とブリッジ自身のインターフェース（ホスト）に流れる', () => {
      expect(stateAt(steps, 'arp-request').bridge?.values.decision).toBe('flood: docker0, vethB')
      expect(rows(stateAt(steps, 'arp-request').bridge?.values.fdb)).toEqual([
        [MAC.bridge, 'docker0', 'local'],
        [MAC.a, 'vethA', 'learned'],
      ])
    })

    it('宛先の MAC アドレスはブリッジ自身なので、ホストに上がる', () => {
      expect(field(byId(steps, 'syn-bridge'), 'Eth Dst')).toBe(MAC.bridge)
      expect(stateAt(steps, 'syn').bridge?.values.decision).toBe('local: up to the host (docker0)')
    })

    it('送信元が 172.17.0.2:40000 から 198.51.100.10:40000 に変わり、TTL が 1 減る', () => {
      expect(field(byId(steps, 'syn-host'), 'Src')).toBe('172.17.0.2:40000')
      expect(field(byId(steps, 'syn-host'), 'TTL')).toBe('64')
      expect(field(byId(steps, 'syn-out'), 'Src')).toBe(`${HOST_IP}:40000`)
      expect(field(byId(steps, 'syn-out'), 'TTL')).toBe('63')
      expect(rows(stateAt(steps, 'masquerade').host?.values.conntrack)).toEqual([
        [
          'TCP',
          '172.17.0.2:40000 → 203.0.113.80:443',
          '203.0.113.80:443 → 198.51.100.10:40000',
          'SYN_SENT',
        ],
      ])
    })

    it('返事は接続の追跡で A に戻り、ARP はもう要らない', () => {
      expect(field(byId(steps, 'synack-containerA'), 'Dst')).toBe('172.17.0.2:40000')
      expect(rows(stateAt(steps, 'reply').host?.values.conntrack)[0]?.[3]).toBe('SYN_RECV')
      expect(rows(stateAt(steps, 'ack').host?.values.conntrack)[0]?.[3]).toBe('ESTABLISHED')
      const afterSyn = flow(steps).slice(5)
      expect(afterSyn.some((line) => line.includes('ARP'))).toBe(false)
    })
  })

  describe('ポートの公開（DNAT）', () => {
    const steps = build('published')

    it('流れ: 外から来た SYN のあと、ホストが A を ARP で引く', () => {
      expect(flow(steps)).toEqual([
        'external→host SYN 203.0.113.80 → 198.51.100.10 delivered',
        'host→bridge ARP who-has 172.17.0.2 delivered',
        'bridge→containerA ARP who-has 172.17.0.2 delivered',
        'bridge→containerB ARP who-has 172.17.0.2 delivered',
        'containerA→bridge ARP is-at 00:00:5e:00:53:02 delivered',
        'bridge→host ARP is-at 00:00:5e:00:53:02 delivered',
        'host→bridge SYN 203.0.113.80 → 172.17.0.2 delivered',
        'bridge→containerA SYN 203.0.113.80 → 172.17.0.2 delivered',
        'containerA→bridge SYN, ACK 172.17.0.2 → 203.0.113.80 delivered',
        'bridge→host SYN, ACK 172.17.0.2 → 203.0.113.80 delivered',
        'host→external SYN, ACK 198.51.100.10 → 203.0.113.80 delivered',
        'external→host ACK 203.0.113.80 → 198.51.100.10 delivered',
        'host→bridge ACK 203.0.113.80 → 172.17.0.2 delivered',
        'bridge→containerA ACK 203.0.113.80 → 172.17.0.2 delivered',
      ])
    })

    it('宛先だけが変わり、コンテナーには本当のクライアントが見える', () => {
      expect(field(byId(steps, 'syn-in'), 'Dst')).toBe(`${HOST_IP}:8080`)
      expect(field(byId(steps, 'syn-containerA'), 'Src')).toBe('203.0.113.80:50000')
      expect(field(byId(steps, 'syn-containerA'), 'Dst')).toBe('172.17.0.2:80')
      expect(field(byId(steps, 'synack-out'), 'Src')).toBe(`${HOST_IP}:8080`)
      expect(rows(stateAt(steps, 'syn-in').host?.values.conntrack)).toEqual([
        [
          'TCP',
          '203.0.113.80:50000 → 198.51.100.10:8080',
          '172.17.0.2:80 → 203.0.113.80:50000',
          'SYN_SENT',
        ],
      ])
    })
  })

  describe('同じブリッジのコンテナー同士', () => {
    const steps = build('sameBridge')

    it('流れ: ホストに届くのは流された ARP の要求だけ', () => {
      expect(flow(steps).filter((line) => line.includes('host'))).toEqual([
        'bridge→host ARP who-has 172.17.0.3 delivered',
      ])
      expect(flow(steps).filter((line) => !line.includes('ARP'))).toEqual([
        'containerA→bridge SYN 172.17.0.2 → 172.17.0.3 delivered',
        'bridge→containerB SYN 172.17.0.2 → 172.17.0.3 delivered',
        'containerB→bridge SYN, ACK 172.17.0.3 → 172.17.0.2 delivered',
        'bridge→containerA SYN, ACK 172.17.0.3 → 172.17.0.2 delivered',
        'containerA→bridge ACK 172.17.0.2 → 172.17.0.3 delivered',
        'bridge→containerB ACK 172.17.0.2 → 172.17.0.3 delivered',
      ])
    })

    it('B に届いても TTL は 64 のままで、NAT の記録はない', () => {
      expect(field(byId(steps, 'syn-containerB'), 'TTL')).toBe('64')
      expect(stateAt(steps, 'syn').bridge?.values.decision).toBe('forward: vethA → vethB')
      expect(rows(stateAt(steps, 'ack').host?.values.conntrack)).toEqual([])
    })
  })

  describe('ユーザー定義のネットワーク', () => {
    const steps = build('userNetwork')

    it('名前解決は veth を通らず、最初の矢印は ARP', () => {
      expect(stateAt(steps, 'dns').containerA?.values.dns).toBe(
        `db → ${USER_NETWORK.b} (via 127.0.0.11)`,
      )
      expect(flow(steps)[0]).toBe(`containerA→bridge ARP who-has ${USER_NETWORK.b} delivered`)
    })

    it('ブリッジは br- で始まり、ホストの経路表には両方のブリッジがある', () => {
      expect(stateAt(steps, 'setup').bridge?.values.iface).toBe(
        `${USER_NETWORK.bridge} 172.18.0.1/16`,
      )
      expect(rows(stateAt(steps, 'setup').host?.values.routes).map((row) => row[2])).toEqual([
        DEFAULT_NETWORK.bridge,
        USER_NETWORK.bridge,
        'eth0',
      ])
      expect(field(byId(steps, 'syn-containerB'), 'Dst')).toBe('172.18.0.3:5432')
    })
  })

  describe('2 つのコンテナーが同じ送信元ポートを使う', () => {
    const steps = build('twoContainers')

    it('B の外側のポートは別の番号になり、返事はそれぞれに戻る', () => {
      expect(field(byId(steps, 'a-syn-out'), 'Src')).toBe(`${HOST_IP}:40000`)
      expect(field(byId(steps, 'b-syn-out'), 'Src')).toBe(`${HOST_IP}:40001`)
      expect(field(byId(steps, 'a-synack-containerA'), 'Dst')).toBe('172.17.0.2:40000')
      expect(field(byId(steps, 'b-synack-containerB'), 'Dst')).toBe('172.17.0.3:40000')
      expect(rows(stateAt(steps, 'b-synack').host?.values.conntrack).map((row) => row[2])).toEqual([
        '203.0.113.80:443 → 198.51.100.10:40000',
        '203.0.113.80:443 → 198.51.100.10:40001',
      ])
    })

    it('表は埋まっているので ARP はない', () => {
      expect(flow(steps).some((line) => line.includes('ARP'))).toBe(false)
    })
  })

  describe('ポートを公開していない', () => {
    const steps = build('unpublished')

    it('ホストが RST で断り、記録は変換しない', () => {
      expect(flow(steps)).toEqual([
        'external→host SYN 203.0.113.80 → 198.51.100.10 rejected',
        'host→external RST, ACK 198.51.100.10 → 203.0.113.80 delivered',
      ])
      expect(rows(stateAt(steps, 'rst').host?.values.conntrack)).toEqual([
        [
          'TCP',
          '203.0.113.80:50000 → 198.51.100.10:80',
          '198.51.100.10:80 → 203.0.113.80:50000',
          'CLOSE',
        ],
      ])
    })
  })
})
