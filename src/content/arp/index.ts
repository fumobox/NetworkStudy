import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { ARP_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { arpQuiz } from './quiz'
import { arpScenario } from './scenario'

export const arpTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: ARP_META,
  scenario: toScenarioHandle(arpScenario),
  quiz: arpQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
