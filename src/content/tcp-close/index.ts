import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { TCP_CLOSE_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { tcpCloseQuiz } from './quiz'
import { tcpCloseScenario } from './scenario'

export const tcpCloseTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: TCP_CLOSE_META,
  scenario: toScenarioHandle(tcpCloseScenario),
  quiz: tcpCloseQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
