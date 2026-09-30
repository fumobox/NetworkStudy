// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  pathMinutes,
  pathPosition,
  pathsContaining,
  readPathParam,
  resolvePathContext,
  themeSearch,
} from './learningPathNav'
import { findLearningPath, type LearningPath } from './learningPaths'
import { THEME_IDS, THEME_META } from './themeMeta'

function path(id: string): LearningPath {
  const found = findLearningPath(id)
  if (found === undefined) {
    throw new Error(`道筋がない: ${id}`)
  }
  return found
}

const WEB = path('web-developer')

describe('readPathParam', () => {
  it('知っている道筋の id だけを読む', () => {
    expect(readPathParam(new URLSearchParams('path=web-developer'))).toBe('web-developer')
    expect(readPathParam(new URLSearchParams('step=3&path=infrastructure'))).toBe('infrastructure')
    expect(readPathParam(new URLSearchParams('path=bogus'))).toBeNull()
    expect(readPathParam(new URLSearchParams('path='))).toBeNull()
    expect(readPathParam(new URLSearchParams(''))).toBeNull()
  })

  it('同じ名前が複数あれば最初のもの', () => {
    expect(readPathParam(new URLSearchParams('path=infrastructure&path=web-developer'))).toBe(
      'infrastructure',
    )
  })

  it('themeSearch で作ったクエリを読み戻せる', () => {
    expect(themeSearch('web-developer')).toBe('?path=web-developer')
    expect(readPathParam(new URLSearchParams(themeSearch('infrastructure')))).toBe('infrastructure')
  })
})

describe('pathPosition', () => {
  it('最初・途中・最後のテーマ', () => {
    const last = WEB.themeIds.length - 1
    expect(pathPosition(WEB, 'osi-model')).toMatchObject({
      index: 0,
      total: WEB.themeIds.length,
      previous: null,
      next: 'dns-resolution',
    })
    expect(pathPosition(WEB, 'cors')).toMatchObject({ previous: 'http-caching', next: 'csrf' })
    expect(pathPosition(WEB, 'hsts')).toMatchObject({ previous: 'csrf', next: 'oauth' })
    expect(pathPosition(WEB, 'reverse-proxy')).toMatchObject({
      index: last,
      previous: 'server-sent-events',
      next: null,
    })
  })

  it('道筋にないテーマでは null', () => {
    expect(pathPosition(WEB, 'tcp-sack')).toBeNull()
  })
})

describe('resolvePathContext', () => {
  it('?path= の道筋がテーマを含めば、その道筋だけ', () => {
    const context = resolvePathContext('dns-resolution', 'infrastructure')
    expect(context.kind).toBe('single')
    expect(context.kind === 'single' && context.position.path.id).toBe('infrastructure')
  })

  it('?path= の道筋がテーマを含まなければ無視する', () => {
    const context = resolvePathContext('csrf', 'infrastructure')
    expect(context.kind === 'single' && context.position.path.id).toBe('web-developer')
  })

  it('?path= がなければ、テーマを含む道筋の数で決まる', () => {
    expect(resolvePathContext('csrf', null).kind).toBe('single')
    const several = resolvePathContext('dns-resolution', null)
    expect(several.kind === 'several' && several.positions.map((p) => p.path.id)).toEqual([
      'web-developer',
      'infrastructure',
    ])
    expect(resolvePathContext('tcp-sack', null)).toEqual({ kind: 'none' })
  })

  it('複数の道筋にあるテーマでも、?path= の道筋を選べる', () => {
    for (const id of ['web-developer', 'infrastructure'] as const) {
      const context = resolvePathContext('dns-resolution', id)
      expect(context.kind === 'single' && context.position.path.id).toBe(id)
    }
  })

  it('どのテーマでも、?path= がなければテーマを含む道筋の数で決まる', () => {
    for (const id of THEME_IDS) {
      const expected = pathsContaining(id)
      const context = resolvePathContext(id, null)
      const [first] = expected
      if (first === undefined) {
        expect(context).toEqual({ kind: 'none' })
      } else if (expected.length === 1) {
        expect(context).toEqual({ kind: 'single', position: first })
      } else {
        expect(context).toEqual({ kind: 'several', positions: expected })
      }
    }
  })
})

describe('pathMinutes', () => {
  it('道筋のテーマの目安の時間を足す', () => {
    const expected = WEB.themeIds.reduce(
      (sum, id) => sum + (THEME_META.find((meta) => meta.id === id)?.minutes ?? 0),
      0,
    )
    expect(pathMinutes(WEB)).toBe(expected)
    expect(expected).toBeGreaterThan(WEB.themeIds.length)
  })
})
