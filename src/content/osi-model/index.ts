import { lazy } from 'react'
import { OSI_MODEL_META } from '../themeMeta'
import type { CustomThemeModule } from '../types'
import { osiModelQuiz } from './quiz'

export const osiModelTheme: CustomThemeModule = {
  kind: 'custom',
  meta: OSI_MODEL_META,
  quiz: osiModelQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
  body: lazy(() =>
    import('./OsiWalkthrough').then((module) => ({ default: module.OsiWalkthrough })),
  ),
}
