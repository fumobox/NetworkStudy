import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { OAUTH_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { oauthQuiz } from './quiz'
import { oauthScenario } from './scenario'

export const oauthTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: OAUTH_META,
  scenario: toScenarioHandle(oauthScenario),
  quiz: oauthQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
