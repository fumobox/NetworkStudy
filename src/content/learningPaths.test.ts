// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { findLearningPath, LEARNING_PATH_IDS, LEARNING_PATHS } from './learningPaths'
import { THEME_IDS } from './themeMeta'

/** 同じ道筋に両方あるなら、前者を先に読む（概要どうしのリンクで前提にしているもの） */
const PREREQUISITES: readonly (readonly [string, string])[] = [
  ['dns-resolution', 'https-overview'],
  ['tcp-handshake', 'https-overview'],
  ['tls-handshake', 'https-overview'],
  ['tls-handshake', 'hsts'],
  ['cors', 'csrf'],
  ['csrf', 'hsts'],
  ['websocket', 'server-sent-events'],
  ['tcp-handshake', 'firewall'],
  ['tcp-handshake', 'pmtud'],
  ['arp', 'dhcp'],
  ['switching', 'vlan'],
  ['nat', 'container-networking'],
  ['switching', 'container-networking'],
  ['switching', 'vxlan'],
  ['vlan', 'vxlan'],
  ['container-networking', 'vxlan'],
  ['pmtud', 'vxlan'],
  ['tcp-handshake', 'vxlan'],
]

describe('学習の道筋', () => {
  it('id は URL に使える形で、重複せず、LEARNING_PATH_IDS の順に並ぶ', () => {
    for (const id of LEARNING_PATH_IDS) {
      expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    }
    expect(new Set(LEARNING_PATH_IDS).size).toBe(LEARNING_PATH_IDS.length)
    expect(LEARNING_PATHS.map((path) => path.id)).toEqual(LEARNING_PATH_IDS)
  })

  it.each(LEARNING_PATHS.map((path) => [path.id, path] as const))(
    '%s: 存在するテーマだけを、重複なく 2 つ以上並べる',
    (_, path) => {
      for (const id of path.themeIds) {
        expect(THEME_IDS).toContain(id)
      }
      expect(new Set(path.themeIds).size).toBe(path.themeIds.length)
      expect(path.themeIds.length).toBeGreaterThanOrEqual(2)
    },
  )

  it.each(LEARNING_PATHS.map((path) => [path.id, path] as const))(
    '%s: 前提のテーマを先に読む',
    (_, path) => {
      const order: readonly string[] = path.themeIds
      for (const [before, after] of PREREQUISITES) {
        if (order.includes(before) && order.includes(after)) {
          expect(order.indexOf(before), `${before} → ${after}`).toBeLessThan(order.indexOf(after))
        }
      }
    },
  )

  it('名前と説明は英日の両方がある', () => {
    for (const path of LEARNING_PATHS) {
      for (const text of [path.title, path.summary]) {
        expect(text.en.trim()).not.toBe('')
        expect(text.ja.trim()).not.toBe('')
      }
    }
  })

  it('findLearningPath は id で探し、知らない id では undefined', () => {
    expect(findLearningPath('infrastructure')?.id).toBe('infrastructure')
    expect(findLearningPath('no-such-path')).toBeUndefined()
    expect(findLearningPath(undefined)).toBeUndefined()
  })
})
