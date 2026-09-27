import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { HTTP_CACHING_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { httpCachingQuiz } from './quiz'
import { httpCachingScenario } from './scenario'

export const httpCachingTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: HTTP_CACHING_META,
  scenario: toScenarioHandle(httpCachingScenario),
  quiz: httpCachingQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
