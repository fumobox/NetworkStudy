import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { NAT_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { natQuiz } from './quiz'
import { natScenario } from './scenario'

export const natTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: NAT_META,
  scenario: toScenarioHandle(natScenario),
  quiz: natQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
