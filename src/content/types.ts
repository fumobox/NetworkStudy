import type { MDXContent } from 'mdx/types'
import type { LazyExoticComponent } from 'react'
import type { Quiz } from '@/components/features/quiz/types'
import type { Locale } from '@/lib/i18n/locale'
import type { ScenarioHandle } from '@/engine/types'
import type { ThemeMeta } from './themeMeta'

/** テーマ 1 つ分のコンテンツ（メタ情報・シナリオ・クイズ） */
export interface ThemeModule {
  readonly meta: ThemeMeta
  readonly scenario: ScenarioHandle
  readonly quiz: Quiz
  /** ロケールごとの概要（MDX）。表示中のロケールの分だけ読み込む */
  readonly overview: Readonly<Record<Locale, LazyExoticComponent<MDXContent>>>
}
