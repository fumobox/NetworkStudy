import type { Messages } from './en'

/** UI 文言の辞書（日本語）。キーの欠落・余剰や関数シグネチャの不一致は型エラーになる */
export const ja = {
  common: {
    siteName: 'NetworkStudy',
    tagline: 'ネットワークプロトコルの動きを、1パケットずつ自分の手で進めて学ぶ。',
    pageTitle: (p) => `${p.page} | ${p.site}`,
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
    controls: '再生の操作',
    position: 'ステップ',
    speed: '再生速度',
    speedValue: (p) => `${String(p.speed)}×`,
    keyboardHint: 'キーボード: ← → で移動、Space で再生・一時停止',
  },
  diagram: {
    label: 'シーケンス図',
    empty: 'まだメッセージは送られていません。',
    status: {
      delivered: '到達',
      lost: 'ロス',
      rejected: '拒否',
    },
    message: (p) =>
      `${p.label}、${p.from} から ${p.to} へ、${p.status}${p.retransmission ? '、再送' : ''}${p.encrypted ? '、暗号化' : ''}`,
    timer: (p) => `${p.name}（${p.duration}）`,
    timerLabel: (p) => `${p.actor}: ${p.name} タイマーが ${p.duration} で満了`,
    elapsed: (p) => `t = ${p.time}`,
  },
  notFound: {
    title: 'ページが見つかりません',
    description: 'お探しのページは存在しません。',
    backHome: 'ホームへ戻る',
  },
} satisfies Messages
