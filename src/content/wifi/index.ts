import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { WIFI_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { wifiQuiz } from './quiz'
import { wifiScenario } from './scenario'

export const wifiTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: WIFI_META,
  scenario: toScenarioHandle(wifiScenario),
  quiz: wifiQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
