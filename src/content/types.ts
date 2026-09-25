import type { Quiz } from '@/components/features/quiz/types'
import type { ScenarioHandle } from '@/engine/types'
import type { ThemeMeta } from './themeMeta'

/** テーマ 1 つ分のコンテンツ（メタ情報・シナリオ・クイズ） */
export interface ThemeModule {
  readonly meta: ThemeMeta
  readonly scenario: ScenarioHandle
  readonly quiz: Quiz
}
