import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { DNS_RESOLUTION_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { dnsResolutionQuiz } from './quiz'
import { dnsResolutionScenario } from './scenario'

export const dnsResolutionTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: DNS_RESOLUTION_META,
  scenario: toScenarioHandle(dnsResolutionScenario),
  quiz: dnsResolutionQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
