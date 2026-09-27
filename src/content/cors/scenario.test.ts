// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { corsScenario, type CorsOptions } from './scenario'

const handle = toScenarioHandle(corsScenario)
const defaults: CorsOptions = {
  request: 'jsonPost',
  serverPolicy: 'exactOrigin',
  credentials: false,
}

function build(overrides: Partial<CorsOptions> = {}): readonly Step[] {
  return corsScenario.buildSteps({ ...defaults, ...overrides })
}

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}

function field(message: Message | undefined, name: string): string | undefined {
  return message?.fields.find((candidate) => candidate.name === name)?.value
}

/** 各メッセージの [from, to, ラベル, 状態] */
function flow(steps: readonly Step[]) {
  return messages(steps).map((m) => [m.from, m.to, m.label, m.status])
}

function final(steps: readonly Step[]) {
  const derived = deriveState(corsScenario.actors, steps, steps.length - 1)
  return {
    result: derived.actorStates.script?.values.result,
    check: derived.actorStates.browser?.values.corsCheck,
    handled: derived.actorStates.api?.values.lastRequest,
  }
}

const byId = (steps: readonly Step[], id: string) => messages(steps).find((m) => m.id === id)

describe('corsScenario', () => {
  it('すべてのオプションの組み合わせ（12 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(
      handle.resolve({ request: 'simpleGet', serverPolicy: 'wildcard', credentials: 'true' })
        .options,
    ).toEqual({ request: 'simpleGet', serverPolicy: 'wildcard', credentials: true })
    expect(
      handle.resolve({ request: 'PUT', serverPolicy: 'any', credentials: 'x' }).options,
    ).toEqual(defaults)
  })

  describe('プリフライト（Fetch Standard "CORS-preflight fetch"）', () => {
    it('資格情報を送らなければ、どの要求にも Cookie は付かない', () => {
      const steps = build()
      expect(messages(steps).some((m) => field(m, 'Cookie') !== undefined)).toBe(false)
    })

    it('プリフライトのキャッシュは、許可されたときだけ行が増える', () => {
      const cacheAfter = (steps: readonly Step[]) => {
        const index = steps.findIndex((step) => step.id === 'preflight-response')
        const cache = deriveState(corsScenario.actors, steps, index).actorStates.browser?.values
          .preflightCache
        return typeof cache === 'object' ? cache.rows : null
      }
      expect(cacheAfter(build())).toEqual([
        ['https://api.example.com/items', 'POST', 'content-type', '600'],
      ])
      expect(cacheAfter(build({ serverPolicy: 'notAllowed' }))).toEqual([])
    })

    it('許可しない応答には Access-Control-Allow-* がない', () => {
      const denied = byId(build({ serverPolicy: 'notAllowed' }), 'preflight-response')
      expect(
        [
          'Access-Control-Allow-Methods',
          'Access-Control-Allow-Headers',
          'Access-Control-Max-Age',
        ].map((name) => field(denied, name)),
      ).toEqual([undefined, undefined, undefined])
    })

    it('JSON の POST は、OPTIONS → 204 → POST → 201 の順で、スクリプトに応答が返る', () => {
      const steps = build()
      expect(flow(steps)).toEqual([
        ['script', 'browser', 'fetch()', 'delivered'],
        ['browser', 'api', 'OPTIONS /items', 'delivered'],
        ['api', 'browser', '204 No Content', 'delivered'],
        ['browser', 'api', 'POST /items', 'delivered'],
        ['api', 'browser', '201 Created', 'delivered'],
        ['browser', 'script', 'Response (201)', 'delivered'],
      ])
      expect(final(steps)).toEqual({
        result: 'Response 201',
        check: 'OK',
        handled: 'OPTIONS /items, POST /items → 201',
      })
    })

    it('プリフライトには Origin と Access-Control-Request-* が付き、応答は許可するものを返す', () => {
      const steps = build()
      const preflight = byId(steps, 'preflight')
      expect(field(preflight, 'Origin')).toBe('https://app.example.com')
      expect(field(preflight, 'Access-Control-Request-Method')).toBe('POST')
      expect(field(preflight, 'Access-Control-Request-Headers')).toBe('content-type')
      const allowed = byId(steps, 'preflight-response')
      expect(
        [
          'Access-Control-Allow-Origin',
          'Access-Control-Allow-Methods',
          'Access-Control-Allow-Headers',
          'Access-Control-Max-Age',
        ].map((name) => field(allowed, name)),
      ).toEqual(['https://app.example.com', 'POST', 'Content-Type', '600'])
    })

    it('許可されていなければ、プリフライトで止まり POST は送られない', () => {
      const steps = build({ serverPolicy: 'notAllowed' })
      expect(flow(steps)).toEqual([
        ['script', 'browser', 'fetch()', 'delivered'],
        ['browser', 'api', 'OPTIONS /items', 'delivered'],
        ['api', 'browser', '204 No Content', 'rejected'],
        ['browser', 'script', 'TypeError', 'delivered'],
      ])
      expect(final(steps)).toEqual({
        result: 'TypeError',
        check: 'failed (no Access-Control-Allow-Origin)',
        handled: 'OPTIONS /items',
      })
    })

    it('資格情報付きでは * が認められず、プリフライトで止まる。プリフライトに Cookie は付かない', () => {
      const steps = build({ serverPolicy: 'wildcard', credentials: true })
      expect(field(byId(steps, 'preflight'), 'Cookie')).toBe('(not sent)')
      expect(byId(steps, 'preflight-response')?.status).toBe('rejected')
      expect(final(steps).check).toBe('failed (* with credentials)')
    })

    it('資格情報付きでオリジンを名指しすれば、Cookie と Access-Control-Allow-Credentials で通る', () => {
      const steps = build({ credentials: true })
      expect(field(byId(steps, 'request'), 'Cookie')).toBe('session=abc123')
      expect(field(byId(steps, 'response'), 'Access-Control-Allow-Credentials')).toBe('true')
      expect(final(steps).result).toBe('Response 201')
    })
  })

  describe('プリフライトなしの GET（Fetch Standard "CORS-safelisted method"）', () => {
    it('資格情報付きの GET に * で答えると、応答で CORS のチェックに通らない（サーバーは処理済み）', () => {
      const steps = build({ request: 'simpleGet', serverPolicy: 'wildcard', credentials: true })
      expect(field(byId(steps, 'request'), 'Cookie')).toBe('session=abc123')
      expect(byId(steps, 'response')?.status).toBe('rejected')
      expect(final(steps)).toEqual({
        result: 'TypeError',
        check: 'failed (* with credentials)',
        handled: 'GET /items → 200',
      })
    })

    it('OPTIONS を送らず、GET に Origin を付ける', () => {
      const steps = build({ request: 'simpleGet', serverPolicy: 'wildcard' })
      expect(flow(steps).map(([, , label]) => label)).toEqual([
        'fetch()',
        'GET /items',
        '200 OK',
        'Response (200)',
      ])
      expect(field(byId(steps, 'response'), 'Access-Control-Allow-Origin')).toBe('*')
    })

    it('許可されていなくてもサーバーは GET を処理しているが、応答はスクリプトに渡らない', () => {
      const steps = build({ request: 'simpleGet', serverPolicy: 'notAllowed' })
      expect(flow(steps)).toEqual([
        ['script', 'browser', 'fetch()', 'delivered'],
        ['browser', 'api', 'GET /items', 'delivered'],
        ['api', 'browser', '200 OK', 'rejected'],
        ['browser', 'script', 'TypeError', 'delivered'],
      ])
      expect(final(steps)).toEqual({
        result: 'TypeError',
        check: 'failed (no Access-Control-Allow-Origin)',
        handled: 'GET /items → 200',
      })
    })
  })
})
