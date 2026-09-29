import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { VXLAN_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { vxlanQuiz } from './quiz'
import { vxlanScenario } from './scenario'

export const vxlanTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: VXLAN_META,
  scenario: toScenarioHandle(vxlanScenario),
  quiz: vxlanQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
