// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, StateValue, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { tcpSackScenario, type TcpSackOptions } from './scenario'

const handle = toScenarioHandle(tcpSackScenario)
const defaults: TcpSackOptions = { ack: 'sack', loss: 'two' }

function build(overrides: Partial<TcpSackOptions> = {}): readonly Step[] {
  return tcpSackScenario.buildSteps({ ...defaults, ...overrides })
}

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}

/** データ以外のメッセージと再送（「← ACK …」「→ rtx seq」） */
function recovery(steps: readonly Step[]) {
  return messages(steps)
    .filter((m) => m.from === 'server' || m.retransmitOf !== undefined)
    .map((m) => (m.from === 'server' ? `← ${m.label}` : `→ rtx ${m.label}`))
}

function stateAt(steps: readonly Step[], index: number) {
  const values = deriveState(tcpSackScenario.actors, steps, index).actorStates
  const rows = (value: StateValue | undefined) =>
    typeof value === 'object' ? value.rows.map((row) => row[1]) : null
  return {
    sndUna: values.client?.values.sndUna,
    dupacks: values.client?.values.dupacks,
    scoreboard: rows(values.client?.values.scoreboard),
    outOfOrder: values.server?.values.outOfOrder,
  }
}

const stepIndex = (steps: readonly Step[], prefix: string) =>
  steps.findIndex((step) => step.id.startsWith(prefix))

describe('tcpSackScenario', () => {
  it('すべてのオプションの組み合わせ（6 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ ack: 'cumulative', loss: 'tail' }).options).toEqual({
      ack: 'cumulative',
      loss: 'tail',
    })
    expect(handle.resolve({ ack: 'dsack', loss: 'three' }).options).toEqual(defaults)
  })

  it('8 つのセグメントを一度に送り、2001 と 5001 が失われる', () => {
    const data = messages(build()).filter(
      (m) => m.from === 'client' && m.retransmitOf === undefined,
    )
    expect(data.map((m) => `${m.label} ${m.status}`)).toEqual([
      'DATA seq=1001 len=1000 delivered',
      'DATA seq=2001 len=1000 lost',
      'DATA seq=3001 len=1000 delivered',
      'DATA seq=4001 len=1000 delivered',
      'DATA seq=5001 len=1000 lost',
      'DATA seq=6001 len=1000 delivered',
      'DATA seq=7001 len=1000 delivered',
      'DATA seq=8001 len=1000 delivered',
    ])
  })

  describe('SACK あり（RFC 2018、RFC 6675）', () => {
    it('3 つ目の重複 ACK で 2001 を、SACK の範囲から 5001 を、同じ往復の中で再送する', () => {
      expect(recovery(build())).toEqual([
        '← ACK 2001',
        '← ACK 2001 SACK 3001-4001',
        '← ACK 2001 SACK 3001-5001',
        '← ACK 2001 SACK 6001-7001, 3001-5001',
        '→ rtx DATA seq=2001 len=1000',
        '← ACK 2001 SACK 6001-8001, 3001-5001',
        '← ACK 2001 SACK 6001-9001, 3001-5001',
        '→ rtx DATA seq=5001 len=1000',
        '← ACK 5001 SACK 6001-9001',
        '← ACK 9001',
      ])
    })

    it('SACK のブロックの右端は、受け取っていない最初のバイト。最初のブロックは最後に受け取った範囲', () => {
      const ack = messages(build()).find((m) => m.label === 'ACK 2001 SACK 6001-7001, 3001-5001')
      expect(ack?.fields.find((f) => f.name === 'SACK')?.value).toBe('6001-7001, 3001-5001')
    })

    it('スコアボードと重複 ACK の数', () => {
      const steps = build()
      expect(stateAt(steps, stepIndex(steps, 'fast-retransmit'))).toEqual({
        sndUna: '2001',
        dupacks: '3',
        scoreboard: [
          'ACKed',
          'retransmitted',
          'SACKed',
          'SACKed',
          'in flight',
          'SACKed',
          'in flight',
          'in flight',
        ],
        outOfOrder: '3001–5000, 6001–7000',
      })
      // IsLost: 5001 より後に 3000 バイト SACK された（(3 − 1) × 1000 + 1 以上）
      expect(stateAt(steps, stepIndex(steps, 'sack-retransmit'))).toMatchObject({
        dupacks: '5',
        scoreboard: [
          'ACKed',
          'retransmitted',
          'SACKed',
          'SACKed',
          'retransmitted',
          'SACKed',
          'SACKed',
          'SACKed',
        ],
      })
      expect(stateAt(steps, steps.length - 1)).toMatchObject({
        sndUna: '9001',
        dupacks: '0',
        outOfOrder: '-',
      })
    })
  })

  describe('SACK なし（累積の確認応答だけ、NewReno）', () => {
    it('2 つ目の抜けは、部分的な確認応答まで 1 往復よけいにかかる', () => {
      expect(recovery(build({ ack: 'cumulative' }))).toEqual([
        '← ACK 2001',
        '← ACK 2001',
        '← ACK 2001',
        '← ACK 2001',
        '→ rtx DATA seq=2001 len=1000',
        '← ACK 2001',
        '← ACK 2001',
        '← ACK 5001',
        '→ rtx DATA seq=5001 len=1000',
        '← ACK 9001',
      ])
    })

    it('送信側は、後のセグメントが届いたことを知らない（スコアボードに SACKed がない）', () => {
      const steps = build({ ack: 'cumulative' })
      const scoreboards = steps.map((_, i) => stateAt(steps, i).scoreboard ?? [])
      expect(scoreboards.flat()).not.toContain('SACKed')
    })
  })

  describe('末尾のロス（RFC 6298 §5）', () => {
    it('重複 ACK が来ないので、RTO を待って再送する', () => {
      for (const ack of ['sack', 'cumulative'] as const) {
        const steps = build({ ack, loss: 'tail' })
        expect(recovery(steps)).toEqual([
          '← ACK 2001 … 8001 (×7)',
          '→ rtx DATA seq=8001 len=1000',
          '← ACK 9001',
        ])
        expect(deriveState(tcpSackScenario.actors, steps, steps.length - 1).elapsedMs).toBe(1000)
      }
    })
  })

  it('失われたのが 1 つなら、再送は 1 回で、文章も 5001 の抜けに触れない', () => {
    for (const ack of ['sack', 'cumulative'] as const) {
      const steps = build({ ack, loss: 'one' })
      expect(recovery(steps).filter((line) => line.startsWith('→'))).toEqual([
        '→ rtx DATA seq=2001 len=1000',
      ])
      const texts = steps.flatMap((step) => [
        step.title.en,
        step.title.ja,
        step.description.en,
        step.description.ja,
      ])
      expect(texts.filter((text) => text.includes('5001'))).toEqual([])
    }
  })

  it('ラベルは短い', () => {
    for (const ack of ['sack', 'cumulative'] as const) {
      for (const loss of ['two', 'one', 'tail'] as const) {
        expect(
          Math.max(...messages(build({ ack, loss })).map((m) => m.label.length)),
        ).toBeLessThanOrEqual(40)
      }
    }
  })
})
