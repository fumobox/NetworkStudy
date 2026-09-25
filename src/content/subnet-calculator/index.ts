import { lazy } from 'react'
import { SUBNET_CALCULATOR_META } from '../themeMeta'
import type { CustomThemeModule } from '../types'
import { subnetCalculatorQuiz } from './quiz'

export const subnetCalculatorTheme: CustomThemeModule = {
  kind: 'custom',
  meta: SUBNET_CALCULATOR_META,
  quiz: subnetCalculatorQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
  body: lazy(() =>
    import('./SubnetCalculator').then((module) => ({ default: module.SubnetCalculator })),
  ),
}
