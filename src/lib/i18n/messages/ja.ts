import type { Messages } from './en'

/** UI 文言の辞書（日本語）。キーの欠落・余剰や関数シグネチャの不一致は型エラーになる */
export const ja = {
  common: {
    siteName: 'NetworkStudy',
    tagline: 'ネットワークプロトコルの動きを、1パケットずつ自分の手で進めて学ぶ。',
    pageTitle: (p) => `${p.page} | NetworkStudy`,
  },
  nav: {
    home: 'ホーム',
    themes: 'テーマ一覧',
  },
  language: {
    label: '言語',
  },
  layout: {
    skipToContent: '本文へスキップ',
  },
  footer: {
    license: 'MIT ライセンス',
    source: 'ソースコード',
  },
  stepper: {
    counter: (p) => `ステップ ${String(p.current)} / ${String(p.total)}`,
    prev: '戻る',
    next: '次へ',
    play: '再生',
    pause: '一時停止',
    reset: '最初から',
  },
  notFound: {
    title: 'ページが見つかりません',
    description: 'お探しのページは存在しません。',
    backHome: 'ホームへ戻る',
  },
} satisfies Messages
