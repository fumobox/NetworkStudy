import { lazy } from 'react'
import { ROUTE_LOOKUP_META } from '../themeMeta'
import type { CustomThemeModule } from '../types'
import { routeLookupQuiz } from './quiz'

export const routeLookupTheme: CustomThemeModule = {
  kind: 'custom',
  meta: ROUTE_LOOKUP_META,
  quiz: routeLookupQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
  body: lazy(() => import('./RouteLookup').then((module) => ({ default: module.RouteLookup }))),
}
