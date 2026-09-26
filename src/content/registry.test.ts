// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { validateQuiz } from '@/components/features/quiz/validate'
import { validateScenario } from '@/engine/validate'
import { findTextProblems } from '@/lib/i18n/textProblems'
import { THEME_QUIZZES } from './quizzes'
import { findTheme, THEMES } from './registry'
import { groupByCategory, THEME_CATEGORIES, THEME_IDS, THEME_META } from './themeMeta'

describe('registry', () => {
  it('themeMeta と同じ順・同じ id のテーマを持つ', () => {
    expect(THEMES.map((theme) => theme.meta.id)).toEqual(THEME_IDS)
  })

  it('ホーム用の軽い一覧（THEME_QUIZZES）は registry と同じ順・同じメタ情報とクイズ', () => {
    expect(THEME_QUIZZES.map((theme) => [theme.meta, theme.quiz])).toEqual(
      THEMES.map((theme) => [theme.meta, theme.quiz]),
    )
  })

  it('テーマ・シナリオ・クイズの id と種類がそろっている', () => {
    for (const theme of THEMES) {
      expect(theme.quiz.id).toBe(theme.meta.id)
      expect(theme.kind).toBe(theme.meta.kind)
      if (theme.kind === 'sequence') {
        expect(theme.scenario.id).toBe(theme.meta.id)
      }
    }
  })

  it('テーマは分類（THEME_CATEGORIES）の順にまとめて並び、どの分類にもテーマがある', () => {
    const order = THEME_META.map((meta) => THEME_CATEGORIES.indexOf(meta.category))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(groupByCategory(THEME_META).map((group) => group.category)).toEqual(THEME_CATEGORIES)
    // groupByCategory は元の順を保つ
    expect(groupByCategory(THEME_META).flatMap((group) => group.themes)).toEqual(THEME_META)
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
      if (theme.kind === 'sequence') {
        expect(validateScenario(theme.scenario)).toEqual([])
      }
      expect(validateQuiz(theme.quiz)).toEqual([])
    },
  )

  it.each(THEMES.map((theme) => [theme.meta.id, theme] as const))(
    '%s のクイズは、正解の位置がすべて同じではない（位置で当てられない）',
    (_, theme) => {
      const positions = theme.quiz.questions.map((question) =>
        question.choices.findIndex((choice) => choice.id === question.answerId),
      )
      expect(new Set(positions).size).toBeGreaterThan(1)
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
