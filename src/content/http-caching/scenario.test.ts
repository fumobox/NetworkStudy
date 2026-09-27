// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { httpCachingScenario, type HttpCachingOptions } from './scenario'

const handle = toScenarioHandle(httpCachingScenario)
const defaults: HttpCachingOptions = { directive: 'maxAge', serverChange: false }

function build(overrides: Partial<HttpCachingOptions> = {}): readonly Step[] {
  return httpCachingScenario.buildSteps({ ...defaults, ...overrides })
}

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}

function field(message: Message | undefined, name: string): string | undefined {
  return message?.fields.find((candidate) => candidate.name === name)?.value
}

/** 各メッセージの [ラベル, Cache-Control, ETag, If-None-Match, Body] */
function exchange(steps: readonly Step[]) {
  return messages(steps).map((m) => [
    m.label,
    field(m, 'Cache-Control'),
    field(m, 'ETag'),
    field(m, 'If-None-Match'),
    field(m, 'Body'),
  ])
}

/** 最後のステップでのブラウザーのキャッシュの行と、経過時間 */
function final(steps: readonly Step[]) {
  const derived = deriveState(httpCachingScenario.actors, steps, steps.length - 1)
  const cache = derived.actorStates.browser?.values.cache
  return {
    cache: typeof cache === 'object' ? cache.rows : null,
    decision: derived.actorStates.browser?.values.decision,
    elapsedMs: derived.elapsedMs,
  }
}

function cacheAt(steps: readonly Step[], stepId: string) {
  const index = steps.findIndex((step) => step.id === stepId)
  const cache = deriveState(httpCachingScenario.actors, steps, index).actorStates.browser?.values
    .cache
  return typeof cache === 'object' ? cache.rows : null
}

describe('httpCachingScenario', () => {
  it('すべてのオプションの組み合わせ（6 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ directive: 'noStore', serverChange: 'true' }).options).toEqual({
      directive: 'noStore',
      serverChange: true,
    })
    expect(handle.resolve({ directive: 'private', serverChange: 'maybe' }).options).toEqual(
      defaults,
    )
  })

  describe('max-age（RFC 9111 §4.2、§4.3、RFC 9110 §13.1.2、§15.4.5）', () => {
    it('新しいうちは何も送らず、max-age が過ぎたら If-None-Match で確かめて 304 を受け取る', () => {
      const steps = build()
      expect(steps.map((step) => step.id)).toEqual([
        'first-request',
        'first-response',
        'reuse-fresh',
        'expired',
        'conditional-request',
        'not-modified',
        'reuse-validated',
      ])
      expect(exchange(steps)).toEqual([
        ['GET /app.js', undefined, undefined, undefined, undefined],
        ['200 OK', 'max-age=60', '"v1"', undefined, 'console.log("v1") …'],
        ['GET /app.js (If-None-Match)', undefined, undefined, '"v1"', undefined],
        ['304 Not Modified', 'max-age=60', '"v1"', undefined, '(none)'],
      ])
      expect(final(steps)).toEqual({
        cache: [['/app.js', '"v1"', 'max-age=60', '0', 'fresh']],
        decision: 'hit (revalidated)',
        elapsedMs: 60_000,
      })
    })

    it('経過時間とともに、fresh（Age 5）から stale（Age 60）になる', () => {
      const steps = build()
      expect(cacheAt(steps, 'first-response')).toEqual([
        ['/app.js', '"v1"', 'max-age=60', '0', 'fresh'],
      ])
      expect(cacheAt(steps, 'reuse-fresh')).toEqual([
        ['/app.js', '"v1"', 'max-age=60', '5', 'fresh'],
      ])
      expect(cacheAt(steps, 'expired')).toEqual([['/app.js', '"v1"', 'max-age=60', '60', 'stale']])
    })

    it('新しい版が公開されると、新しいうちは v1 を使い続け、再検証で 200 の v2 に置き換わる', () => {
      const steps = build({ serverChange: true })
      expect(steps.map((step) => step.id)).toEqual([
        'first-request',
        'first-response',
        'deploy',
        'reuse-fresh',
        'expired',
        'conditional-request',
        'modified',
      ])
      expect(exchange(steps).at(-1)).toEqual([
        '200 OK',
        'max-age=60',
        '"v2"',
        undefined,
        'console.log("v2") …',
      ])
      expect(final(steps).cache).toEqual([['/app.js', '"v2"', 'max-age=60', '0', 'fresh']])
    })
  })

  describe('no-cache（RFC 9111 §5.2.2.4）', () => {
    it('保存はするが、5 秒後でも使う前に確かめる', () => {
      const steps = build({ directive: 'noCache' })
      expect(steps.map((step) => step.id)).toEqual([
        'first-request',
        'first-response',
        'revisit',
        'conditional-request',
        'not-modified',
        'reuse-validated',
      ])
      expect(cacheAt(steps, 'first-response')).toEqual([
        ['/app.js', '"v1"', 'no-cache', '0', 'no-cache'],
      ])
      expect(exchange(steps).map(([label]) => label)).toEqual([
        'GET /app.js',
        '200 OK',
        'GET /app.js (If-None-Match)',
        '304 Not Modified',
      ])
      // タイマーは使わない（max-age の満了がない）
      expect(final(steps).elapsedMs).toBe(0)
    })
  })

  describe('no-store（RFC 9111 §5.2.2.5）', () => {
    it('保存しないので、毎回ふつうの GET でファイル全体を受け取る', () => {
      const steps = build({ directive: 'noStore' })
      expect(exchange(steps)).toEqual([
        ['GET /app.js', undefined, undefined, undefined, undefined],
        ['200 OK', 'no-store', '"v1"', undefined, 'console.log("v1") …'],
        ['GET /app.js', undefined, undefined, undefined, undefined],
        ['200 OK', 'no-store', '"v1"', undefined, 'console.log("v1") …'],
      ])
      expect(final(steps).cache).toEqual([])
    })

    it('新しい版が公開されていれば、2 回目は v2 を受け取る', () => {
      const steps = build({ directive: 'noStore', serverChange: true })
      expect(field(messages(steps).at(-1), 'ETag')).toBe('"v2"')
    })
  })
})
