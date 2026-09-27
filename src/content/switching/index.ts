import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { SWITCHING_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { switchingQuiz } from './quiz'
import { switchingScenario } from './scenario'

export const switchingTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: SWITCHING_META,
  scenario: toScenarioHandle(switchingScenario),
  quiz: switchingQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
