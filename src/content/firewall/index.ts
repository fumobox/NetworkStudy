import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { FIREWALL_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { firewallQuiz } from './quiz'
import { firewallScenario } from './scenario'

export const firewallTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: FIREWALL_META,
  scenario: toScenarioHandle(firewallScenario),
  quiz: firewallQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
