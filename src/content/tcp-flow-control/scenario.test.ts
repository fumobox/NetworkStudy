// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { tcpFlowControlScenario, type TcpFlowControlOptions } from './scenario'

const handle = toScenarioHandle(tcpFlowControlScenario)
const defaults: TcpFlowControlOptions = { receiverApp: 'slow', updateLost: false }

function build(overrides: Partial<TcpFlowControlOptions> = {}): readonly Step[] {
  return tcpFlowControlScenario.buildSteps({ ...defaults, ...overrides })
}

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}

/** 各メッセージの「ラベル 状態」 */
function flow(steps: readonly Step[]) {
  return messages(steps).map((m) => `${m.label} ${m.status}`)
}

function stateAt(steps: readonly Step[], stepId: string) {
  const index = steps.findIndex((step) => step.id === stepId)
  const state = deriveState(tcpFlowControlScenario.actors, steps, index)
  const client = state.actorStates.client?.values
  const server = state.actorStates.server?.values
  return {
    sndUna: client?.sndUna,
    sndNxt: client?.sndNxt,
    sndWnd: client?.sndWnd,
    usable: client?.usable,
    rcvNxt: server?.rcvNxt,
    buffer: server?.buffer,
    rcvWnd: server?.rcvWnd,
  }
}

const elapsed = (steps: readonly Step[]) =>
  deriveState(tcpFlowControlScenario.actors, steps, steps.length - 1).elapsedMs

const FIRST_WINDOW = [
  'DATA seq=1001 len=1000 delivered',
  'DATA seq=2001 len=1000 delivered',
  'DATA seq=3001 len=1000 delivered',
  'DATA seq=4001 len=1000 delivered',
]

describe('tcpFlowControlScenario', () => {
  it('すべてのオプションの組み合わせ（6 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ receiverApp: 'trickle', updateLost: 'true' }).options).toEqual({
      receiverApp: 'trickle',
      updateLost: true,
    })
    expect(handle.resolve({ receiverApp: 'never', updateLost: '?' }).options).toEqual(defaults)
  })

  describe('ゼロウィンドウとプローブ（RFC 9293 §3.8.6.1）', () => {
    it('ウィンドウいっぱいで止まり、ゼロウィンドウのあとプローブで確かめ、更新で残りを送る', () => {
      expect(flow(build())).toEqual([
        ...FIRST_WINDOW,
        'ACK 3001 win=2000 delivered',
        'ACK 5001 win=0 delivered',
        'Window probe seq=5001 len=1 rejected',
        'ACK 5001 win=0 delivered',
        'ACK 5001 win=4000 delivered',
        'DATA seq=5001 len=1000 delivered',
        'DATA seq=6001 len=1000 delivered',
        'ACK 7001 win=2000 delivered',
      ])
      expect(elapsed(build())).toBe(1000)
    })

    it('使えるウィンドウ = SND.UNA + SND.WND − SND.NXT', () => {
      const steps = build()
      expect(stateAt(steps, 'established')).toEqual({
        sndUna: '1001',
        sndNxt: '1001',
        sndWnd: '4000',
        usable: '4000',
        rcvNxt: '1001',
        buffer: '0 / 4000 bytes',
        rcvWnd: '4000',
      })
      expect(stateAt(steps, 'send-window')).toMatchObject({ sndNxt: '5001', usable: '0' })
      expect(stateAt(steps, 'window-shrinks')).toEqual({
        sndUna: '5001',
        sndNxt: '5001',
        sndWnd: '0',
        usable: '0',
        rcvNxt: '5001',
        buffer: '4000 / 4000 bytes',
        rcvWnd: '0',
      })
      expect(stateAt(steps, 'app-reads')).toMatchObject({ sndWnd: '4000', usable: '4000' })
    })

    it('ウィンドウの更新が失われても、倍の間隔の次のプローブで開く（プローブのバイトはデータとして数える）', () => {
      const steps = build({ updateLost: true })
      expect(flow(steps).slice(8)).toEqual([
        'ACK 5001 win=4000 lost',
        'Window probe seq=5001 len=1 delivered',
        'ACK 5002 win=3999 delivered',
        'DATA seq=5002 len=1000 delivered',
        'DATA seq=6002 len=999 delivered',
        'ACK 7001 win=2000 delivered',
      ])
      expect(elapsed(steps)).toBe(3000)
      const timers = steps.flatMap((step) =>
        step.events.flatMap((event) => (event.kind === 'timer' ? [event.durationMs] : [])),
      )
      expect(timers).toEqual([1000, 2000])
    })

    it('ACK の Win と、送信側の Win（Window Scale なしの最大 65535）', () => {
      const all = messages(build())
      const win = (m: Message | undefined) => m?.fields.find((f) => f.name === 'Win')?.value
      expect(win(all.find((m) => m.label.startsWith('ACK 5001 win=0')))).toBe('0')
      expect(win(all[0])).toBe('65535')
    })
  })

  describe('受信側のアプリケーション', () => {
    it('すぐに読むなら、ウィンドウは 4000 のままずれていき、止まらない', () => {
      const steps = build({ receiverApp: 'fast' })
      expect(flow(steps)).toEqual([
        ...FIRST_WINDOW,
        'ACK 3001 win=4000 delivered',
        'ACK 5001 win=4000 delivered',
        'DATA seq=5001 len=1000 delivered',
        'DATA seq=6001 len=1000 delivered',
        'ACK 7001 win=4000 delivered',
      ])
      expect(elapsed(steps)).toBe(0)
      // ウィンドウの更新のロスは影響しない
      expect(build({ receiverApp: 'fast', updateLost: true })).toEqual(steps)
    })

    it('500 バイトずつ読むなら、1000 バイト空くまでウィンドウを広げない（受信側の SWS 回避、RFC 9293 §3.8.6.2.2）', () => {
      const steps = build({ receiverApp: 'trickle' })
      expect(stateAt(steps, 'read-500')).toMatchObject({
        buffer: '3500 / 4000 bytes',
        rcvWnd: '0',
      })
      expect(flow(steps).slice(8)).toEqual([
        'ACK 5001 win=1000 delivered',
        'DATA seq=5001 len=1000 delivered',
        'ACK 6001 win=0 delivered',
        'ACK 6001 win=4000 delivered',
        'DATA seq=6001 len=1000 delivered',
        'ACK 7001 win=3000 delivered',
      ])
      expect(build({ receiverApp: 'trickle', updateLost: true })).toEqual(steps)
    })

    it('ラベルは短い', () => {
      for (const receiverApp of ['slow', 'fast', 'trickle'] as const) {
        for (const updateLost of [false, true]) {
          expect(
            Math.max(...messages(build({ receiverApp, updateLost })).map((m) => m.label.length)),
          ).toBeLessThanOrEqual(40)
        }
      }
    })
  })
})
