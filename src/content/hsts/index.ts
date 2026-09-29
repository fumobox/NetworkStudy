import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { HSTS_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { hstsQuiz } from './quiz'
import { hstsScenario } from './scenario'

export const hstsTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: HSTS_META,
  scenario: toScenarioHandle(hstsScenario),
  quiz: hstsQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
