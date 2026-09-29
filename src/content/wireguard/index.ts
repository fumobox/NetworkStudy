import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { WIREGUARD_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { wireguardQuiz } from './quiz'
import { wireguardScenario } from './scenario'

export const wireguardTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: WIREGUARD_META,
  scenario: toScenarioHandle(wireguardScenario),
  quiz: wireguardQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
