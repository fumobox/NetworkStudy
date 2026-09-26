import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { DHCP_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { dhcpQuiz } from './quiz'
import { dhcpScenario } from './scenario'

export const dhcpTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: DHCP_META,
  scenario: toScenarioHandle(dhcpScenario),
  quiz: dhcpQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
