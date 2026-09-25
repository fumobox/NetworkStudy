import type { MDXContent } from 'mdx/types'
import type { ComponentType, LazyExoticComponent, ReactNode } from 'react'
import type { Quiz } from '@/components/features/quiz/types'
import type { Locale } from '@/lib/i18n/locale'
import type { ScenarioHandle, StateKey } from '@/engine/types'
import type { ScenarioPanelsContext } from '@/engine/ui/ScenarioPlayer'
import type { ThemeKind, ThemeMeta } from './themeMeta'

/** どの種類のテーマにもある部分（メタ情報・概要・クイズ） */
interface ThemeModuleBase<K extends ThemeKind> {
  /**
   * テーマの種類。TypeScript は入れ子のプロパティ（meta.kind）では型を絞り込めないので、ここにも持たせる。
   * meta.kind と同じ値であることは、meta の型で保証する
   */
  readonly kind: K
  readonly meta: ThemeMeta & { readonly kind: K }
  readonly quiz: Quiz
  /** ロケールごとの概要（MDX）。表示中のロケールの分だけ読み込む */
  readonly overview: Readonly<Record<Locale, LazyExoticComponent<MDXContent>>>
}

/** シーケンスエンジンを使うテーマ（ステップ実行の図・パケットの詳細・状態パネル） */
export interface SequenceThemeModule extends ThemeModuleBase<'sequence'> {
  readonly scenario: ScenarioHandle
  /** テーマ固有のパネル（TLS の証明書チェーンなど）。状態パネルで二重に表示しないキーも指定する */
  readonly panels?: {
    readonly render: (context: ScenarioPanelsContext) => ReactNode
    readonly hiddenStateKeys: readonly StateKey[]
  }
}

/** テーマ独自の UI を持つテーマ（サブネット計算、OSI 参照モデルなど） */
export interface CustomThemeModule extends ThemeModuleBase<'custom'> {
  /** 概要とクイズの間に表示する本体。テーマを開いたときに読み込む */
  readonly body: LazyExoticComponent<ComponentType>
}

/** テーマ 1 つ分のコンテンツ */
export type ThemeModule = SequenceThemeModule | CustomThemeModule
