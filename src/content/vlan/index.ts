import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { VLAN_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { vlanQuiz } from './quiz'
import { vlanScenario } from './scenario'

export const vlanTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: VLAN_META,
  scenario: toScenarioHandle(vlanScenario),
  quiz: vlanQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
