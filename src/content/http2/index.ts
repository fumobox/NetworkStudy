import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { HTTP2_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { http2Quiz } from './quiz'
import { http2Scenario } from './scenario'

export const http2Theme: SequenceThemeModule = {
  kind: 'sequence',
  meta: HTTP2_META,
  scenario: toScenarioHandle(http2Scenario),
  quiz: http2Quiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
