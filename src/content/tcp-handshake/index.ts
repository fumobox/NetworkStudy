import { lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { TCP_HANDSHAKE_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { tcpHandshakeQuiz } from './quiz'
import { tcpHandshakeScenario } from './scenario'

export const tcpHandshakeTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: TCP_HANDSHAKE_META,
  scenario: toScenarioHandle(tcpHandshakeScenario),
  quiz: tcpHandshakeQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
}
