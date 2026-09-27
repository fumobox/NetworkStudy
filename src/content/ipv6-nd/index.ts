import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { IPV6_ND_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { ipv6NdQuiz } from './quiz'
import { ipv6NdScenario } from './scenario'

export const ipv6NdTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: IPV6_ND_META,
  scenario: toScenarioHandle(ipv6NdScenario),
  quiz: ipv6NdQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
