import type { MDXContent } from 'mdx/types'
import type { LazyExoticComponent, ReactNode } from 'react'
import type { Quiz } from '@/components/features/quiz/types'
import type { Locale } from '@/lib/i18n/locale'
import type { ScenarioHandle, StateKey } from '@/engine/types'
import type { ScenarioPanelsContext } from '@/engine/ui/ScenarioPlayer'
import type { ThemeMeta } from './themeMeta'

/** テーマ 1 つ分のコンテンツ（メタ情報・シナリオ・クイズ） */
export interface ThemeModule {
  readonly meta: ThemeMeta
  readonly scenario: ScenarioHandle
  readonly quiz: Quiz
  /** ロケールごとの概要（MDX）。表示中のロケールの分だけ読み込む */
  readonly overview: Readonly<Record<Locale, LazyExoticComponent<MDXContent>>>
  /** テーマ固有のパネル（TLS の証明書チェーンなど）。状態パネルで二重に表示しないキーも指定する */
  readonly panels?: {
    readonly render: (context: ScenarioPanelsContext) => ReactNode
    readonly hiddenStateKeys: readonly StateKey[]
  }
}
