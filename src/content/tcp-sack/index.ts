import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { TCP_SACK_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { tcpSackQuiz } from './quiz'
import { tcpSackScenario } from './scenario'

export const tcpSackTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: TCP_SACK_META,
  scenario: toScenarioHandle(tcpSackScenario),
  quiz: tcpSackQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
