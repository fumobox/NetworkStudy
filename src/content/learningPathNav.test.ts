// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  pathPosition,
  pathsContaining,
  readPathParam,
  resolvePathContext,
  themeSearch,
} from './learningPathNav'
import { findLearningPath, LEARNING_PATHS, type LearningPath } from './learningPaths'
import { THEME_IDS } from './themeMeta'

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

  it('どのテーマでも、結果は pathsContaining と一致する', () => {
    for (const id of THEME_IDS) {
      const context = resolvePathContext(id, null)
      const count = { none: 0, single: 1, several: pathsContaining(id).length }[context.kind]
      expect(pathsContaining(id).length).toBe(count)
    }
    expect(LEARNING_PATHS.length).toBeGreaterThan(1)
  })
})
