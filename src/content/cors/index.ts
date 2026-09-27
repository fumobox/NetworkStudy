import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { CORS_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { corsQuiz } from './quiz'
import { corsScenario } from './scenario'

export const corsTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: CORS_META,
  scenario: toScenarioHandle(corsScenario),
  quiz: corsQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
