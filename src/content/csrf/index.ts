import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { CSRF_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { csrfQuiz } from './quiz'
import { csrfScenario } from './scenario'

export const csrfTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: CSRF_META,
  scenario: toScenarioHandle(csrfScenario),
  quiz: csrfQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
