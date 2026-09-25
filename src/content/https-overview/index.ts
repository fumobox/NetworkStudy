import { createElement, lazy } from 'react'
import { CertChainPanel } from '../tls-handshake/CertChainPanel'
import { HTTPS_OVERVIEW_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { httpsOverviewQuiz } from './quiz'
import { HTTPS_CERT_CHAIN, httpsOverviewScenario } from './scenario'

export const httpsOverviewTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: HTTPS_OVERVIEW_META,
  scenario: httpsOverviewScenario,
  quiz: httpsOverviewQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
  // TLS のテーマと同じく、証明書チェーンは専用のパネルで見せる
  panels: {
    render: (context) => createElement(CertChainPanel, { ...context, stateKey: HTTPS_CERT_CHAIN }),
    hiddenStateKeys: [HTTPS_CERT_CHAIN],
  },
}
