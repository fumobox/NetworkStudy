import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { QUIC_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { quicQuiz } from './quiz'
import { quicScenario } from './scenario'

export const quicTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: QUIC_META,
  scenario: toScenarioHandle(quicScenario),
  quiz: quicQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
