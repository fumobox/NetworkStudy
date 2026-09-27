// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { http2Scenario, RESOURCES, type Http2Options } from './scenario'

const handle = toScenarioHandle(http2Scenario)
const defaults: Http2Options = { version: 'http2', loss: false }

function build(overrides: Partial<Http2Options> = {}): readonly Step[] {
  return http2Scenario.buildSteps({ ...defaults, ...overrides })
}

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}

function field(message: Message | undefined, name: string): string | undefined {
  return message?.fields.find((candidate) => candidate.name === name)?.value
}

/** ステップごとの要求の表（ID, Path, State, Received） */
function requestsAt(steps: readonly Step[], stepId: string) {
  const index = steps.findIndex((step) => step.id === stepId)
  const table = deriveState(http2Scenario.actors, steps, index).actorStates.client?.values.requests
  return typeof table === 'object' ? table.rows : null
}

function stateAt(steps: readonly Step[], stepId: string, key: string) {
  const index = steps.findIndex((step) => step.id === stepId)
  return deriveState(http2Scenario.actors, steps, index).actorStates.client?.values[key]
}

describe('http2Scenario', () => {
  it('すべてのオプションの組み合わせ（4 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ version: 'http1', loss: 'true' }).options).toEqual({
      version: 'http1',
      loss: true,
    })
    expect(handle.resolve({ version: 'http3', loss: '?' }).options).toEqual(defaults)
  })

  describe('HTTP/2（RFC 9113、RFC 7541）', () => {
    it('データの合計は初期のフロー制御のウィンドウ（65,535 バイト）より小さい（WINDOW_UPDATE を省けることの前提、RFC 9113 §6.9.2）', () => {
      expect(RESOURCES.reduce((sum, resource) => sum + resource.size, 0)).toBeLessThan(65_535)
    })

    it('序文と SETTINGS のあと、3 つのストリームの要求を待たずに送り、DATA が混ざって届く', () => {
      expect(messages(build()).map((m) => m.label)).toEqual([
        'Preface + SETTINGS',
        'SETTINGS',
        'HEADERS [stream 1] GET /style.css',
        'HEADERS [stream 3] GET /app.js',
        'HEADERS [stream 5] GET /hero.jpg',
        'HEADERS [stream 1] :status 200',
        'HEADERS [stream 3] :status 200',
        'HEADERS [stream 5] :status 200',
        'DATA [stream 1] style.css',
        'DATA [stream 3] app.js 1/3',
        'DATA [stream 5] hero.jpg 1/2',
        'DATA [stream 3] app.js 2/3',
        'DATA [stream 5] hero.jpg 2/2',
        'DATA [stream 3] app.js 3/3',
      ])
    })

    it('DATA フレームは 16,384 バイトまでで、最後のフレームだけに END_STREAM が付く', () => {
      const data = messages(build()).filter((m) => m.label.startsWith('DATA'))
      expect(data.map((m) => [m.label, field(m, 'Length'), field(m, 'Flags')])).toEqual([
        ['DATA [stream 1] style.css', '2,000 bytes', 'END_STREAM'],
        ['DATA [stream 3] app.js 1/3', '16,384 bytes', '-'],
        ['DATA [stream 5] hero.jpg 1/2', '16,384 bytes', '-'],
        ['DATA [stream 3] app.js 2/3', '16,384 bytes', '-'],
        ['DATA [stream 5] hero.jpg 2/2', '3,616 bytes', 'END_STREAM'],
        ['DATA [stream 3] app.js 3/3', '7,232 bytes', 'END_STREAM'],
      ])
    })

    it('HPACK: :authority は最初の要求で動的テーブルの 62 番に入り、次からは番号だけ', () => {
      const headers = messages(build()).filter((m) => m.label.includes('GET'))
      expect(headers.map((m) => field(m, ':authority'))).toEqual([
        'www.example.com (added to the dynamic table as 62)',
        'dynamic index 62',
        'dynamic index 62',
      ])
      expect(headers.map((m) => field(m, ':method'))).toEqual(
        Array.from({ length: 3 }, () => 'GET (static index 2)'),
      )
    })

    it('ストリームの状態と受け取った割合が進む', () => {
      const steps = build()
      expect(requestsAt(steps, 'h2-requests')).toEqual([
        ['1', '/style.css', 'half-closed (local)', '0%'],
        ['3', '/app.js', 'half-closed (local)', '0%'],
        ['5', '/hero.jpg', 'half-closed (local)', '0%'],
      ])
      expect(requestsAt(steps, 'h2-data-1')).toEqual([
        ['1', '/style.css', 'closed', '100%'],
        ['3', '/app.js', 'half-closed (local)', '41%'],
        ['5', '/hero.jpg', 'half-closed (local)', '82%'],
      ])
      expect(requestsAt(steps, 'h2-data-3')?.map((row) => row[2])).toEqual([
        'closed',
        'closed',
        'closed',
      ])
    })

    it('ロス: app.js のフレームが失われると、届いている hero.jpg も TCP で止まり、RTO の再送で一緒に進む', () => {
      const steps = build({ loss: true })
      const lost = messages(steps).find((m) => m.status === 'lost')
      expect(lost?.label).toBe('DATA [stream 3] app.js 1/3')
      // hero.jpg のフレームは届いている（TCP の受信バッファーで止まっているだけ）
      expect(messages(steps).find((m) => m.id === 'data-5-0')?.status).toBe('delivered')
      expect(requestsAt(steps, 'h2-data-1')).toEqual([
        ['1', '/style.css', 'closed', '100%'],
        ['3', '/app.js', 'half-closed (local)', '0%'],
        ['5', '/hero.jpg', 'half-closed (local)', '0%'],
      ])
      expect(stateAt(steps, 'h2-data-1', 'tcp')).toBe('1 segment missing')
      const retransmit = messages(steps).find((m) => m.retransmitOf !== undefined)
      expect(retransmit?.retransmitOf).toBe(lost?.id)
      expect(requestsAt(steps, 'h2-retransmit')).toEqual([
        ['1', '/style.css', 'closed', '100%'],
        ['3', '/app.js', 'half-closed (local)', '41%'],
        ['5', '/hero.jpg', 'half-closed (local)', '82%'],
      ])
      expect(stateAt(steps, 'h2-retransmit', 'tcp')).toBe('in order')
      expect(deriveState(http2Scenario.actors, steps, steps.length - 1).elapsedMs).toBe(1000)
    })
  })

  describe('HTTP/1.1（RFC 9112 §9.3）', () => {
    it('要求は 1 つずつで、前の応答が全部届いてから次を送る', () => {
      expect(messages(build({ version: 'http1' })).map((m) => m.label)).toEqual([
        'GET /style.css',
        '200 OK (style.css)',
        'GET /app.js',
        '200 OK (app.js 1/3)',
        '200 OK (app.js 2/3)',
        '200 OK (app.js 3/3)',
        'GET /hero.jpg',
        '200 OK (hero.jpg 1/2)',
        '200 OK (hero.jpg 2/2)',
      ])
    })

    it('要求の表は waiting → in flight → done の順に進む', () => {
      const steps = build({ version: 'http1' })
      expect(requestsAt(steps, 'h1-request-app.js')?.map((row) => row[2])).toEqual([
        'done',
        'in flight',
        'waiting',
      ])
    })

    it('ロス: app.js の応答が失われると、RTO の再送まで次の要求も送れない', () => {
      const steps = build({ version: 'http1', loss: true })
      expect(messages(steps).map((m) => [m.label, m.status])).toEqual([
        ['GET /style.css', 'delivered'],
        ['200 OK (style.css)', 'delivered'],
        ['GET /app.js', 'delivered'],
        ['200 OK (app.js 1/3)', 'lost'],
        ['200 OK (app.js 1/3)', 'delivered'],
        ['200 OK (app.js 2/3)', 'delivered'],
        ['200 OK (app.js 3/3)', 'delivered'],
        ['GET /hero.jpg', 'delivered'],
        ['200 OK (hero.jpg 1/2)', 'delivered'],
        ['200 OK (hero.jpg 2/2)', 'delivered'],
      ])
      expect(stateAt(steps, 'h1-response-app.js-lost', 'tcp')).toBe('1 segment missing')
      expect(stateAt(steps, 'h1-retransmit', 'tcp')).toBe('in order')
      expect(deriveState(http2Scenario.actors, steps, steps.length - 1).elapsedMs).toBe(1000)
    })
  })
})
