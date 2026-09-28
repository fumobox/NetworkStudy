import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { REVERSE_PROXY_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { reverseProxyQuiz } from './quiz'
import { reverseProxyScenario } from './scenario'

export const reverseProxyTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: REVERSE_PROXY_META,
  scenario: toScenarioHandle(reverseProxyScenario),
  quiz: reverseProxyQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
