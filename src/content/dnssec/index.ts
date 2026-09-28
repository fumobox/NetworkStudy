import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { DNSSEC_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { dnssecQuiz } from './quiz'
import { dnssecScenario } from './scenario'

export const dnssecTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: DNSSEC_META,
  scenario: toScenarioHandle(dnssecScenario),
  quiz: dnssecQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
