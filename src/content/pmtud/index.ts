import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { PMTUD_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { pmtudQuiz } from './quiz'
import { pmtudScenario } from './scenario'

export const pmtudTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: PMTUD_META,
  scenario: toScenarioHandle(pmtudScenario),
  quiz: pmtudQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
