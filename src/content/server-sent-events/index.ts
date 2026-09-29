import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { SERVER_SENT_EVENTS_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { sseQuiz } from './quiz'
import { sseScenario } from './scenario'

export const serverSentEventsTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: SERVER_SENT_EVENTS_META,
  scenario: toScenarioHandle(sseScenario),
  quiz: sseQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
