import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { ICMP_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { icmpQuiz } from './quiz'
import { icmpScenario } from './scenario'

export const icmpTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: ICMP_META,
  scenario: toScenarioHandle(icmpScenario),
  quiz: icmpQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
