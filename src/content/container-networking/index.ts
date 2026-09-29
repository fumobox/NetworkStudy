import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { CONTAINER_NETWORKING_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { containerNetworkingQuiz } from './quiz'
import { containerNetworkingScenario } from './scenario'

export const containerNetworkingTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: CONTAINER_NETWORKING_META,
  scenario: toScenarioHandle(containerNetworkingScenario),
  quiz: containerNetworkingQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
