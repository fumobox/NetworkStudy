// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { validateQuiz } from '@/components/features/quiz/validate'
import { validateScenario } from '@/engine/validate'
import { findTextProblems } from '@/lib/i18n/textProblems'
import { findTheme, THEMES } from './registry'
import { THEME_IDS, THEME_META } from './themeMeta'

describe('registry', () => {
  it('themeMeta と同じ順・同じ id のテーマを持つ', () => {
    expect(THEMES.map((theme) => theme.meta.id)).toEqual(THEME_IDS)
  })

  it('テーマ・シナリオ・クイズの id がそろっている', () => {
    for (const theme of THEMES) {
      expect(theme.scenario.id).toBe(theme.meta.id)
      expect(theme.quiz.id).toBe(theme.meta.id)
    }
  })

  it('テーマ id は URL とファイルパスに使える形', () => {
    for (const id of THEME_IDS) {
      expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    }
    expect(new Set(THEME_IDS).size).toBe(THEME_IDS.length)
  })

  it.each(THEMES.map((theme) => [theme.meta.id, theme] as const))(
    '%s のシナリオとクイズは整合している',
    (_, theme) => {
      expect(validateScenario(theme.scenario)).toEqual([])
      expect(validateQuiz(theme.quiz)).toEqual([])
    },
  )

  it('メタ情報のタイトルと概要に翻訳の空欄がない', () => {
    expect(
      findTextProblems(
        THEME_META.flatMap((meta) => [
          { path: `${meta.id}.title`, text: meta.title },
          { path: `${meta.id}.summary`, text: meta.summary },
        ]),
      ),
    ).toEqual([])
  })

  it('findTheme は id でテーマを返し、未知の id や undefined では undefined', () => {
    expect(findTheme('tcp-handshake')?.meta.id).toBe('tcp-handshake')
    expect(findTheme('nope')).toBeUndefined()
    expect(findTheme(undefined)).toBeUndefined()
  })
})
