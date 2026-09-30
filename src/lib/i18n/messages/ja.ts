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
    loadErrorTitle: 'このページを読み込めませんでした',
    loadErrorDescription:
      '開いた後でサイトが更新されたか、接続が途切れた可能性があります。読み込み直すと、たいてい直ります。',
    reload: 'ページを読み込み直す',
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
    layers: 'プロトコルの層ごとのフィールド',
    layerHighlighted: 'このステップで注目するフィールドを含む',
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
    retryIncorrect: (p) => `間違えた ${String(p.count)} 問を解き直す`,
  },
  home: {
    orderTitle: 'どこから始めるか',
    orderLead:
      'まず基礎から始め、PC がネットワークにつながるまでと LAN の中を見て、次に Web のページがブラウザーに届くまでをたどる。そのあと TCP をもっと詳しく見て、Web 開発で出会う HTTP のしくみを見て、最後にネットワークのセキュリティを見る。',
    howToTitle: 'このサイトの使い方',
    howTo: [
      '各テーマの最初にある短い概要を読む。',
      'ボタンか ← → キーで図をステップ実行し、メッセージを選んでフィールドを見る。',
      '「もしも…」のオプションで、うまくいかないときに何が起きるかを試す。',
      '最後のクイズで理解を確かめる。',
    ],
    notStarted: 'クイズは未挑戦',
    overallTitle: 'これまでの進み具合',
    overall: (p) =>
      `クイズを解き終えたテーマ: ${String(p.themes)} テーマ中 ${String(p.finished)} テーマ。正解: ${String(p.questions)} 問中 ${String(p.correct)} 問。`,
    progress: (p) => `クイズ: ${String(p.total)} 問中 ${String(p.correct)} 問正解`,
  },
  paths: {
    title: '学習の道筋',
    lead: 'どこから始めるか迷ったら、仕事に合った道筋を選ぶ。どの道筋も、読む順にテーマを並べている。',
    pageTitle: (p) => `学習の道筋: ${p.path}`,
    themesTitle: 'この道筋のテーマ',
    themeCount: (p) => `${String(p.count)} テーマ`,
    progressTitle: 'この道筋の進み具合',
    progress: (p) =>
      `クイズを解き終えたテーマ: ${String(p.themes)} テーマ中 ${String(p.finished)} テーマ`,
    start: '最初のテーマから始める',
    continue: (p) => `続きから: ${p.title}`,
  },
  pathNav: {
    label: (p) => `学習の道筋: ${p.path}`,
    position: (p) => `${String(p.total)} テーマ中 ${String(p.current)} 番目`,
    previous: '前のテーマ',
    next: '次のテーマ',
    previousTo: (p) => `前: ${p.title}`,
    nextTo: (p) => `次: ${p.title}`,
    finished: 'この道筋の最後のテーマです。',
    backToPath: 'この道筋のテーマの一覧',
    showAll: 'この道筋のテーマをすべて表示',
    inPathsTitle: 'このテーマを含む学習の道筋',
  },
  categories: {
    basics: {
      title: 'ネットワークの基礎',
      lead: 'データを送る仕事を層に分けるしくみ、IPv4 アドレスをネットワークに分けるしくみ、IPv6 アドレスの書き方。',
    },
    ip: {
      title: 'ネットワークにつながるまで',
      lead: 'PC がアドレスをもらい（DHCP）、隣の機器を見つけ（ARP）、経路を確かめ（ICMP）、送れるパケットの大きさを知り（パス MTU）、1 つのグローバルアドレスを共有し（NAT）、NAT の内側どうしでもつながり（STUN・TURN・ICE）、ルーターがネクストホップを選ぶまで。',
    },
    lan: {
      title: 'LAN の中',
      lead: 'スイッチがフレームをどう運ぶか、VLAN が 1 台のスイッチを別々のネットワークに分けるしくみ、1 台のホストの中でコンテナーが仮想の LAN とホストのアドレスを共有するしくみ、VXLAN が IP ネットワークの上でホストをまたいで LAN を延ばすしくみ、機器が Wi-Fi のネットワークに参加して電波を分け合うしくみ、IPv6 のホストが隣の機器を見つけて自分でアドレスを決めるまで。',
    },
    web: {
      title: 'Web のページが届くまで',
      lead: 'ブラウザーはサーバーのアドレスを調べ（DNS）、接続を開き（TCP）、その接続を安全にして（TLS）、ページを受け取る（HTTPS）。',
    },
    tcp: {
      title: 'TCP をもっと詳しく',
      lead: '接続の閉じ方、TCP がネットワークと受信側に送りすぎないしくみ、失われたセグメントの取り戻し方。',
    },
    http: {
      title: 'Web 開発で出会う HTTP',
      lead: 'Web を作り始めるとすぐ出会うしくみ。ブラウザーが応答をキャッシュし、まだ使えるかを確かめる流れ、別のオリジンの応答をブラウザーがページに読ませない理由、HTTP/2 と HTTP/3（QUIC）が 1 つの接続を速くするしくみ、WebSocket が 1 つの接続を開いたまま双方向にメッセージを送るしくみ、Server-Sent Events が 1 つの長い HTTP の応答で知らせを流すしくみ、サーバーの前に立つリバースプロキシとロードバランサーの働き、そして「… でログイン」が OAuth 2.0 と OpenID Connect でクライアントに限られたトークンを渡すしくみ。',
    },
    security: {
      title: 'ネットワークのセキュリティ',
      lead: '偽の ARP の応答 1 つで攻撃者が LAN の中間に入るしくみとスイッチでの止め方、ファイアウォールが、こちらから開いた接続を覚えてほかのすべてを止めるしくみ、WireGuard が公開鍵でノート PC をオフィスのネットワークにつなぐしくみ、DNSSEC でリゾルバーが DNS の答えを本物だと証明するしくみ、メールサーバーが SPF・DKIM・DMARC で偽のメールを見分けるしくみ、HSTS で公衆 Wi-Fi の攻撃者に https を剥ぎ取らせないしくみ、SameSite の Cookie と CSRF トークンで、別のサイトが始めた要求を自分の名前で通させないしくみ。',
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
