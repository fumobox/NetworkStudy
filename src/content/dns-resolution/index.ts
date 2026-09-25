import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { DNS_RESOLUTION_META } from '../themeMeta'
import type { ThemeModule } from '../types'
import { dnsResolutionQuiz } from './quiz'
import { dnsResolutionScenario } from './scenario'

export const dnsResolutionTheme: ThemeModule = {
  meta: DNS_RESOLUTION_META,
  scenario: toScenarioHandle(dnsResolutionScenario),
  quiz: dnsResolutionQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
