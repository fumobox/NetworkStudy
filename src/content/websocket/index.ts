import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { WEBSOCKET_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { webSocketQuiz } from './quiz'
import { webSocketScenario } from './scenario'

export const webSocketTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: WEBSOCKET_META,
  scenario: toScenarioHandle(webSocketScenario),
  quiz: webSocketQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
