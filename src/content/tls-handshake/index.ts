import { createElement, lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { TLS_HANDSHAKE_META } from '../themeMeta'
import type { ThemeModule } from '../types'
import { CertChainPanel } from './CertChainPanel'
import { tlsHandshakeQuiz } from './quiz'
import { CERT_CHAIN, tlsHandshakeScenario } from './scenario'

export const tlsHandshakeTheme: ThemeModule = {
  meta: TLS_HANDSHAKE_META,
  scenario: toScenarioHandle(tlsHandshakeScenario),
  quiz: tlsHandshakeQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
  // 証明書チェーンは専用のパネルで見せるので、汎用の状態パネルには出さない
  panels: {
    render: (context) => createElement(CertChainPanel, context),
    hiddenStateKeys: [CERT_CHAIN],
  },
}
