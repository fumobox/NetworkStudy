import type { LocalizedText } from '@/lib/i18n/locale'
import type { EventName } from './scenario'

/** cwnd のグラフ（CwndGraph）の文言。用語集のテスト（glossary.test.tsx）でも検査する */
export const CWND_TEXT = {
  title: { en: 'cwnd in each round', ja: 'ラウンドごとの cwnd' },
  xAxis: { en: 'Round', ja: 'ラウンド' },
  yAxis: { en: 'Segments', ja: 'セグメント数' },
  cwnd: { en: 'cwnd (congestion window)', ja: 'cwnd（輻輳ウィンドウ）' },
  ssthresh: { en: 'ssthresh (slow start threshold)', ja: 'ssthresh（スロースタートのしきい値）' },
  empty: {
    en: 'No round has been sent yet.',
    ja: 'まだどのラウンドも送っていない。',
  },
  tableCaption: {
    en: 'cwnd and ssthresh in each round',
    ja: 'ラウンドごとの cwnd と ssthresh',
  },
  event: { en: 'What happened', ja: '起きたこと' },
  lossLegend: {
    en: 'Loss detected (3 duplicate ACKs or RTO)',
    ja: 'ロスを検出（重複 ACK が 3 つ、または RTO）',
  },
  events: {
    'slow start': { en: 'Slow start', ja: 'スロースタート' },
    'congestion avoidance': { en: 'Congestion avoidance', ja: '輻輳回避' },
    '3 dup ACKs': { en: '3 duplicate ACKs (fast retransmit)', ja: '重複 ACK が 3 つ（高速再送）' },
    RTO: { en: 'RTO expired', ja: 'RTO の満了' },
  } satisfies Record<EventName, LocalizedText>,
} as const

/** グラフの読み上げ用の要約 */
export function cwndSummary(values: readonly number[]): LocalizedText {
  return {
    en: `cwnd by round: ${values.join(', ')}`,
    ja: `ラウンドごとの cwnd: ${values.join('、')}`,
  }
}
