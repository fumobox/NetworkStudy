import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { TCP_FLOW_CONTROL_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { tcpFlowControlQuiz } from './quiz'
import { tcpFlowControlScenario } from './scenario'

export const tcpFlowControlTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: TCP_FLOW_CONTROL_META,
  scenario: toScenarioHandle(tcpFlowControlScenario),
  quiz: tcpFlowControlQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
