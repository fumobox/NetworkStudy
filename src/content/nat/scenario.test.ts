// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { natScenario, type NatOptions } from './scenario'

const handle = toScenarioHandle(natScenario)
const defaults: NatOptions = { secondPc: true, inbound: false }

function build(overrides: Partial<NatOptions> = {}): readonly Step[] {
  return natScenario.buildSteps({ ...defaults, ...overrides })
}

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}

const field = (message: Message, name: string) =>
  message.fields.find((candidate) => candidate.name === name)?.value

/** [from, to, Src, Dst, 変換, 状態] */
function segments(steps: readonly Step[]) {
  return messages(steps).map((m) => [
    m.from,
    m.to,
    field(m, 'Src'),
    field(m, 'Dst'),
    field(m, 'Translation') ?? '-',
    m.status,
  ])
}

function natRowsAfter(steps: readonly Step[], stepId: string) {
  const index = steps.findIndex((step) => step.id === stepId)
  const table = deriveState(natScenario.actors, steps, index).actorStates.router?.values.nat
  return typeof table === 'object' ? table.rows : []
}

describe('natScenario', () => {
  it('すべてのオプションの組み合わせで整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ secondPc: '0', inbound: '1' }).options).toEqual({
      secondPc: false,
      inbound: true,
    })
    expect(handle.resolve({ secondPc: 'maybe' }).options).toEqual(defaults)
  })

  it('外へ出るときは送信元を、戻るときは宛先を変換する（RFC 3022 §3.1、§3.2）', () => {
    expect(segments(build({ secondPc: false }))).toEqual([
      ['pc', 'router', '192.168.1.10:49152', '192.0.2.10:443', '-', 'delivered'],
      [
        'router',
        'server',
        '203.0.113.5:40001',
        '192.0.2.10:443',
        'src 192.168.1.10:49152 → 203.0.113.5:40001',
        'delivered',
      ],
      ['server', 'router', '192.0.2.10:443', '203.0.113.5:40001', '-', 'delivered'],
      [
        'router',
        'pc',
        '192.0.2.10:443',
        '192.168.1.10:49152',
        'dst 203.0.113.5:40001 → 192.168.1.10:49152',
        'delivered',
      ],
      ['pc', 'router', '192.168.1.10:49152', '192.0.2.10:443', '-', 'delivered'],
      [
        'router',
        'server',
        '203.0.113.5:40001',
        '192.0.2.10:443',
        'src 192.168.1.10:49152 → 203.0.113.5:40001',
        'delivered',
      ],
    ])
  })

  it('変換したパケットではチェックサムを計算し直す', () => {
    for (const message of messages(build())) {
      expect(field(message, 'Checksums') !== undefined).toBe(
        field(message, 'Translation') !== undefined,
      )
    }
  })

  it('同じ送信元ポートの 2 台は、外側のポート（40001 / 40002）で見分ける', () => {
    const steps = build()
    expect(natRowsAfter(steps, 'map')).toEqual([
      ['TCP', '192.168.1.10:49152', '203.0.113.5:40001', '192.0.2.10:443'],
    ])
    expect(natRowsAfter(steps, 'pc2-map')).toEqual([
      ['TCP', '192.168.1.10:49152', '203.0.113.5:40001', '192.0.2.10:443'],
      ['TCP', '192.168.1.20:49152', '203.0.113.5:40002', '192.0.2.10:443'],
    ])
    expect(segments(steps).slice(6)).toEqual([
      ['pc2', 'router', '192.168.1.20:49152', '192.0.2.10:443', '-', 'delivered'],
      [
        'router',
        'server',
        '203.0.113.5:40002',
        '192.0.2.10:443',
        'src 192.168.1.20:49152 → 203.0.113.5:40002',
        'delivered',
      ],
      ['server', 'router', '192.0.2.10:443', '203.0.113.5:40002', '-', 'delivered'],
      [
        'router',
        'pc2',
        '192.0.2.10:443',
        '192.168.1.20:49152',
        'dst 203.0.113.5:40002 → 192.168.1.20:49152',
        'delivered',
      ],
    ])
    const derived = deriveState(natScenario.actors, steps, steps.length - 1)
    expect(derived.actorStates.server?.values.peer).toBe('203.0.113.5:40001, 203.0.113.5:40002')
    // PC から見た接続は、自分のプライベートアドレスのまま
    expect(derived.actorStates.pc?.values.socket).toBe('TCP 192.168.1.10:49152 → 192.0.2.10:443')
  })

  it('別の PC がなければ、PC 2 のメッセージはない', () => {
    expect(
      messages(build({ secondPc: false })).some((m) => m.from === 'pc2' || m.to === 'pc2'),
    ).toBe(false)
  })

  it('外からの SYN は対応がないので捨て、変換表は変わらない（RFC 5382 §4.3）', () => {
    const steps = build({ inbound: true })
    const inbound = messages(steps).at(-1)
    expect(inbound === undefined ? null : [inbound.status, field(inbound, 'Dst')]).toEqual([
      'rejected',
      '203.0.113.5:80',
    ])
    expect(steps.at(-1)?.id).toBe('dropped')
    expect(natRowsAfter(steps, 'dropped')).toEqual(natRowsAfter(steps, 'pc2-syn-ack'))
  })
})
