import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { BGP_ANYCAST_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { bgpAnycastQuiz } from './quiz'
import { bgpAnycastScenario } from './scenario'

export const bgpAnycastTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: BGP_ANYCAST_META,
  scenario: toScenarioHandle(bgpAnycastScenario),
  quiz: bgpAnycastQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
