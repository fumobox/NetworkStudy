import type { Messages } from './en'

/** UI 文言の辞書（日本語）。キーの欠落・余剰や関数シグネチャの不一致は型エラーになる */
export const ja = {
  common: {
    siteName: 'NetworkStudy',
    tagline: 'ネットワークプロトコルの動きを、1 パケットずつ自分の手で進めて学ぶ。',
    pageTitle: (p) => `${p.page} | ${p.site}`,
  },
  nav: {
    home: 'ホーム',
    themes: 'テーマ一覧',
    menu: 'メニュー',
    close: '閉じる',
  },
  colorScheme: {
    system: 'システムに従う',
    light: 'ライト',
    dark: 'ダーク',
    toggle: (p) => `配色: ${p.current}。「${p.next}」に切り替える`,
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
  options: {
    title: 'もしも…',
  },
  inspector: {
    title: 'パケットの詳細',
    empty: 'まだ表示するメッセージはありません。',
    route: (p) => `${p.from} → ${p.to}`,
    highlighted: 'このステップで注目するフィールド',
    retransmitOf: (p) => `${p.label} の再送`,
    encrypted: '実際にはこのメッセージは暗号化されています。学習のために中身を表示しています。',
  },
  actorState: {
    title: '各参加者の状態',
    changed: 'このステップで変化',
    added: 'このステップで追加',
    emptyTable: '空',
  },
  quiz: {
    title: '理解度チェック',
    question: (p) => `問題 ${String(p.n)} / ${String(p.total)}`,
    correct: '正解！',
    incorrect: '不正解。',
    answerIs: (p) => `正解は「${p.answer}」`,
    yourAnswer: '（あなたの回答）',
    correctAnswer: '（正解）',
    score: (p) => `${String(p.total)} 問中 ${String(p.correct)} 問正解`,
    reset: 'もう一度',
  },
  home: {
    orderTitle: 'どこから始めるか',
    orderLead:
      'まず基礎から始め、PC がネットワークにつながるまでを見て、次に Web のページがブラウザーに届くまでをたどる。最後のまとまりでは、TCP をもっと詳しく見る。',
    howToTitle: 'このサイトの使い方',
    howTo: [
      '各テーマの最初にある短い概要を読む。',
      'ボタンか ← → キーで図をステップ実行し、メッセージを選んでフィールドを見る。',
      '「もしも…」のオプションで、うまくいかないときに何が起きるかを試す。',
      '最後のクイズで理解を確かめる。',
    ],
    notStarted: 'クイズは未挑戦',
    progress: (p) => `クイズ: ${String(p.total)} 問中 ${String(p.correct)} 問正解`,
  },
  categories: {
    basics: {
      title: 'ネットワークの基礎',
      lead: 'データを送る仕事を層に分けるしくみと、IP アドレスをネットワークに分けるしくみ。',
    },
    ip: {
      title: 'ネットワークにつながるまで',
      lead: 'PC がアドレスをもらい（DHCP）、隣の機器を見つけ（ARP）、経路を確かめ（ICMP）、1 つのグローバルアドレスを共有し（NAT）、ルーターが次の送り先を選ぶまで。',
    },
    web: {
      title: 'Web のページが届くまで',
      lead: 'ブラウザーはサーバーのアドレスを調べ（DNS）、接続を開き（TCP）、その接続を安全にして（TLS）、ページを受け取る（HTTPS）。',
    },
    tcp: {
      title: 'TCP をもっと詳しく',
      lead: '接続の閉じ方と、TCP がネットワークを混ませすぎないしくみ。',
    },
  },
  theme: {
    difficulty: {
      beginner: '初級',
      intermediate: '中級',
    },
    minutes: (p) => `約 ${String(p.minutes)} 分`,
    player: 'ステップ実行',
    overview: '概要',
    loading: '読み込み中…',
  },
  notFound: {
    title: 'ページが見つかりません',
    description: 'お探しのページは存在しません。',
    backHome: 'ホームへ戻る',
  },
} satisfies Messages
