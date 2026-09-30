import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { ARP_SPOOFING_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { arpSpoofingQuiz } from './quiz'
import { arpSpoofingScenario } from './scenario'

export const arpSpoofingTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: ARP_SPOOFING_META,
  scenario: toScenarioHandle(arpSpoofingScenario),
  quiz: arpSpoofingQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
