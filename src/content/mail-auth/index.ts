import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { MAIL_AUTH_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { mailAuthQuiz } from './quiz'
import { mailAuthScenario } from './scenario'

export const mailAuthTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: MAIL_AUTH_META,
  scenario: toScenarioHandle(mailAuthScenario),
  quiz: mailAuthQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
