import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { NAT_TRAVERSAL_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { natTraversalQuiz } from './quiz'
import { natTraversalScenario } from './scenario'

export const natTraversalTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: NAT_TRAVERSAL_META,
  scenario: toScenarioHandle(natTraversalScenario),
  quiz: natTraversalQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
