import { createElement, lazy } from 'react'
import { toScenarioHandle } from '@/engine/scenario'
import { TCP_CONGESTION_META } from '../themeMeta'
import type { SequenceThemeModule } from '../types'
import { CwndGraph } from './CwndGraph'
import { tcpCongestionQuiz } from './quiz'
import { CWND_HISTORY, tcpCongestionScenario } from './scenario'

export const tcpCongestionTheme: SequenceThemeModule = {
  kind: 'sequence',
  meta: TCP_CONGESTION_META,
  scenario: toScenarioHandle(tcpCongestionScenario),
  quiz: tcpCongestionQuiz,
  overview: {
    en: lazy(() => import('./overview.en.mdx')),
    ja: lazy(() => import('./overview.ja.mdx')),
  },
  // ラウンドごとの記録はグラフで見せるので、汎用の状態パネルには出さない（cwnd と ssthresh は残す）
  panels: {
    render: (context) => createElement(CwndGraph, context),
    hiddenStateKeys: [CWND_HISTORY],
  },
}
