/**
 * 公開するテーマのメタ情報。URL は `/:locale/themes/:id`。
 * 静的ページ生成スクリプト（scripts/）からも読み込むため、このファイルは型以外を import しない。
 */
import type { LocalizedText } from '@/lib/i18n/locale'

export const DIFFICULTIES = ['beginner', 'intermediate'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

/**
 * テーマの種類。sequence はシーケンスエンジン（ステップ実行の図）を使い、custom はテーマ独自の UI（計算ツールなど）を持つ。
 * e2e や静的ページ生成（DOM に依存しない側）からも判別できるよう、メタ情報に持たせる
 */
export const THEME_KINDS = ['sequence', 'custom'] as const
export type ThemeKind = (typeof THEME_KINDS)[number]

/**
 * テーマの分類（ホームとサイドバーの見出し。表示名は辞書の `categories`）。この順に案内する。
 * basics: ネットワークの基礎、ip: ネットワークにつながるまで（ARP、DHCP、ICMP、パス MTU 探索、NAT、NAT 越え、経路制御、BGP とエニーキャスト）、lan: LAN の中（スイッチ、VLAN、コンテナーのネットワーク、VXLAN、Wi-Fi、IPv6 の近隣探索）、
 * web: Web ページが届くまで（DNS → TCP → TLS → HTTPS）、tcp: TCP をもっと詳しく、
 * http: Web 開発で出会う HTTP（キャッシュ、CORS、HTTP/2、QUIC、WebSocket、Server-Sent Events、リバースプロキシとロードバランサー、OAuth 2.0 と OpenID Connect）、security: ネットワークのセキュリティ（ARP スプーフィング、ファイアウォール、WireGuard、DNSSEC、メールの送信ドメイン認証、HSTS、Cookie と CSRF）
 */
export const THEME_CATEGORIES = ['basics', 'ip', 'lan', 'web', 'tcp', 'http', 'security'] as const
export type ThemeCategory = (typeof THEME_CATEGORIES)[number]

export interface ThemeMeta {
  /** URL とファイルパスに使うので、英小文字・数字・ハイフンのみ */
  readonly id: string
  readonly kind: ThemeKind
  readonly category: ThemeCategory
  readonly title: LocalizedText
  readonly summary: LocalizedText
  readonly difficulty: Difficulty
  /** 目安の所要時間（分） */
  readonly minutes: number
}

export const DNS_RESOLUTION_META = {
  id: 'dns-resolution',
  category: 'web',
  title: { en: 'DNS name resolution', ja: 'DNS の名前解決' },
  summary: {
    en: 'How a name like www.example.com becomes an IP address: a resolver follows referrals from the root to the right server, and caches what it learns.',
    ja: 'www.example.com のような名前が IP アドレスになるまで。リゾルバーがルートから委任をたどって担当のサーバーにたどり着き、わかったことをキャッシュする流れ。',
  },
  kind: 'sequence',
  difficulty: 'beginner',
  minutes: 12,
} as const satisfies ThemeMeta

export const TCP_HANDSHAKE_META = {
  id: 'tcp-handshake',
  category: 'web',
  title: { en: 'TCP three-way handshake', ja: 'TCP 3 ウェイハンドシェイク' },
  summary: {
    en: 'How two hosts agree on sequence numbers and open a TCP connection, and what happens when a segment is lost or the port is closed.',
    ja: '2 つのホストがシーケンス番号を合わせて TCP の接続を開く流れと、セグメントが失われたときやポートが閉じているときに何が起きるか。',
  },
  kind: 'sequence',
  difficulty: 'beginner',
  minutes: 10,
} as const satisfies ThemeMeta

export const TLS_HANDSHAKE_META = {
  id: 'tls-handshake',
  category: 'web',
  title: { en: 'TLS 1.3 handshake and certificates', ja: 'TLS 1.3 のハンドシェイクと証明書' },
  summary: {
    en: 'How a browser and a server agree on keys in one round trip, and how the browser checks the server’s certificate chain before trusting it.',
    ja: 'ブラウザーとサーバーが 1 往復で鍵を合わせる流れと、ブラウザーがサーバーの証明書チェーンを確かめてから信頼するまで。',
  },
  kind: 'sequence',
  difficulty: 'intermediate',
  minutes: 15,
} as const satisfies ThemeMeta

export const TCP_CLOSE_META = {
  id: 'tcp-close',
  kind: 'sequence',
  category: 'tcp',
  title: { en: 'Closing a TCP connection', ja: 'TCP の接続の終了' },
  summary: {
    en: 'How the two sides close a TCP connection with four segments, one direction at a time, and why the side that closes first waits in TIME-WAIT.',
    ja: '両者が 4 つのセグメントで、向きごとに TCP の接続を閉じる流れと、先に閉じた側が TIME-WAIT で待つ理由。',
  },
  difficulty: 'intermediate',
  minutes: 10,
} as const satisfies ThemeMeta

export const SUBNET_CALCULATOR_META = {
  id: 'subnet-calculator',
  kind: 'custom',
  category: 'basics',
  title: { en: 'Subnet calculator', ja: 'サブネット計算' },
  summary: {
    en: 'How an IPv4 address splits into a network part and a host part: work out the subnet mask, network and broadcast addresses, and how many hosts fit.',
    ja: 'IPv4 アドレスがネットワーク部とホスト部に分かれるしくみ。サブネットマスク、ネットワークアドレスとブロードキャストアドレス、入るホストの数を求める。',
  },
  difficulty: 'beginner',
  minutes: 8,
} as const satisfies ThemeMeta

export const HTTPS_OVERVIEW_META = {
  id: 'https-overview',
  kind: 'sequence',
  category: 'web',
  title: { en: 'HTTPS from start to finish', ja: 'HTTPS の全体像' },
  summary: {
    en: 'Everything that happens when a browser opens an https:// page, in one walkthrough: DNS lookup, TCP connection, TLS handshake, and the HTTP request and response.',
    ja: 'ブラウザーが https:// のページを開くときに起きることを、1 本のステップ実行で。名前解決、TCP の接続、TLS のハンドシェイク、HTTP の要求と応答。',
  },
  difficulty: 'intermediate',
  minutes: 15,
} as const satisfies ThemeMeta

export const OSI_MODEL_META = {
  id: 'osi-model',
  kind: 'custom',
  category: 'basics',
  title: { en: 'The OSI model and encapsulation', ja: 'OSI 参照モデルとカプセル化' },
  summary: {
    en: 'How the seven layers of the OSI model split up the work of sending data, and how each layer adds its header on the way down and removes it on the way up.',
    ja: 'OSI 参照モデルの 7 つの層が、データを送る仕事をどう分け合うか。各層が、下りるときにヘッダーを付け、上るときに外すカプセル化の流れ。',
  },
  difficulty: 'beginner',
  minutes: 10,
} as const satisfies ThemeMeta

export const TCP_CONGESTION_META = {
  id: 'tcp-congestion',
  kind: 'sequence',
  category: 'tcp',
  title: { en: 'TCP congestion control', ja: 'TCP の輻輳制御' },
  summary: {
    en: 'How a TCP sender grows its congestion window with slow start and congestion avoidance, and how it reacts to a lost segment and to a timeout.',
    ja: 'TCP の送信側が、スロースタートと輻輳回避で輻輳ウィンドウを広げるしくみと、セグメントのロスやタイムアウトへの反応。',
  },
  difficulty: 'intermediate',
  minutes: 12,
} as const satisfies ThemeMeta

export const TCP_FLOW_CONTROL_META = {
  id: 'tcp-flow-control',
  kind: 'sequence',
  category: 'tcp',
  title: { en: 'TCP flow control: the receive window', ja: 'TCP のフロー制御: 受信ウィンドウ' },
  summary: {
    en: 'How a TCP receiver uses the window in every ACK to keep the sender from overrunning its buffer, and what happens when the window drops to zero.',
    ja: 'TCP の受信側が、ACK のたびに知らせるウィンドウで、送信側がバッファーをあふれさせないようにするしくみと、ウィンドウが 0 になったときの動き。',
  },
  difficulty: 'intermediate',
  minutes: 12,
} as const satisfies ThemeMeta

export const TCP_SACK_META = {
  id: 'tcp-sack',
  kind: 'sequence',
  category: 'tcp',
  title: {
    en: 'Fast retransmit and SACK: resending only what was lost',
    ja: '高速再送と SACK: 失われた分だけを再送する',
  },
  summary: {
    en: 'How duplicate ACKs trigger a retransmission without waiting for the timer, and how SACK tells the sender exactly which segments are missing.',
    ja: '重複 ACK で、タイマーを待たずに再送するしくみと、SACK で、どのセグメントが抜けているかを送信側に正確に知らせるしくみ。',
  },
  difficulty: 'intermediate',
  minutes: 12,
} as const satisfies ThemeMeta

export const ARP_SPOOFING_META = {
  id: 'arp-spoofing',
  kind: 'sequence',
  category: 'security',
  title: {
    en: 'ARP spoofing and Dynamic ARP Inspection',
    ja: 'ARP スプーフィングと Dynamic ARP Inspection',
  },
  summary: {
    en: 'How one forged ARP reply sends a PC’s traffic through an attacker on the same LAN, and how DHCP snooping with Dynamic ARP Inspection, ARP ACLs and static entries stop it.',
    ja: '偽の ARP の応答 1 つで、PC の通信が同じ LAN の攻撃者を通るようになるしくみと、DHCP スヌーピングと Dynamic ARP Inspection、ARP ACL、静的なエントリーでの止め方。',
  },
  difficulty: 'intermediate',
  minutes: 15,
} as const satisfies ThemeMeta

export const FIREWALL_META = {
  id: 'firewall',
  kind: 'sequence',
  category: 'security',
  title: {
    en: 'Stateful firewall: letting replies in, keeping strangers out',
    ja: 'ステートフルファイアウォール: 返事は通し、見知らぬ相手は止める',
  },
  summary: {
    en: 'How a firewall remembers the connections your PC opened, lets the replies back in without any inbound rule, tracks UDP with a timer, and drops or rejects a connection nobody asked for.',
    ja: 'ファイアウォールが PC の開いた接続を覚え、内向きのルールなしで返事を通し、UDP をタイマーで追い、誰も頼んでいない接続を捨てるか拒否するしくみ。',
  },
  difficulty: 'intermediate',
  minutes: 12,
} as const satisfies ThemeMeta

export const WIREGUARD_META = {
  id: 'wireguard',
  kind: 'sequence',
  category: 'security',
  title: {
    en: 'WireGuard: a remote-access VPN built on public keys',
    ja: 'WireGuard: 公開鍵で結ぶリモートアクセス VPN',
  },
  summary: {
    en: 'How a laptop reaches an office network through WireGuard: a one-round-trip handshake between two public keys, AllowedIPs that pick the peer for outgoing packets and check the source of incoming ones, an endpoint that follows the laptop from network to network, keepalives that hold a NAT mapping open, fresh keys every two minutes, and cookies that protect a busy server.',
    ja: 'ノート PC が WireGuard でオフィスのネットワークに届くまで。2 つの公開鍵の間の 1 往復のハンドシェイク、出ていくパケットのピアを選び、入ってくるパケットの送信元を確かめる AllowedIPs、ネットワークを移るノート PC を追うエンドポイント、NAT の対応を保つキープアライブ、2 分ごとの鍵の更新、負荷の高いサーバーを守る cookie。',
  },
  difficulty: 'intermediate',
  minutes: 20,
} as const satisfies ThemeMeta

export const DNSSEC_META = {
  id: 'dnssec',
  kind: 'sequence',
  category: 'security',
  title: {
    en: 'DNSSEC: a chain of trust for DNS answers',
    ja: 'DNSSEC: DNS の答えをたどる信頼の連鎖',
  },
  summary: {
    en: 'How a validating resolver proves that a DNS answer is genuine, from the root trust anchor through DS and DNSKEY records to the RRSIG on the answer, and why a forged answer or an expired signature ends in SERVFAIL.',
    ja: '検証するリゾルバーが、ルートのトラストアンカーから DS と DNSKEY をたどって答えの RRSIG を確かめ、DNS の答えが本物だと証明するしくみと、偽造された答えや期限切れの署名が SERVFAIL になる理由。',
  },
  difficulty: 'intermediate',
  minutes: 15,
} as const satisfies ThemeMeta

export const MAIL_AUTH_META = {
  id: 'mail-auth',
  kind: 'sequence',
  category: 'security',
  title: {
    en: 'Email authentication: SPF, DKIM and DMARC',
    ja: 'メールの送信ドメイン認証: SPF、DKIM、DMARC',
  },
  summary: {
    en: 'How a receiving mail server checks which servers may send for a domain (SPF), whether the message was signed and left unchanged (DKIM), and what the domain owner wants done with mail that fails (DMARC), and why forwarding breaks one of them but not the other.',
    ja: '受信サーバーが、そのドメインのメールを送ってよいサーバーか（SPF）、メッセージが署名され改変されていないか（DKIM）、失敗したメールをどう扱ってほしいか（DMARC）を確かめるしくみと、転送で壊れるものと壊れないもの。',
  },
  difficulty: 'intermediate',
  minutes: 15,
} as const satisfies ThemeMeta

export const HSTS_META = {
  id: 'hsts',
  kind: 'sequence',
  category: 'security',
  title: { en: 'HSTS and SSL stripping', ja: 'HSTS と SSL ストリッピング' },
  summary: {
    en: 'How an attacker on public Wi-Fi takes over the first plain-http request and keeps you on http (SSL stripping), and how Strict-Transport-Security makes the browser switch to https before sending anything, refuse bad certificates without a way to click through, cover subdomains, and protect even the first visit with the preload list.',
    ja: '公衆 Wi-Fi の攻撃者が最初の平文の http の要求を乗っ取り、利用者を http のままにする攻撃（SSL ストリッピング）と、Strict-Transport-Security で、ブラウザーが何かを送る前に https に切り替え、おかしな証明書では無視して進めずに打ち切り、サブドメインも守り、プリロードリストで初めての訪問まで守るしくみ。',
  },
  difficulty: 'intermediate',
  minutes: 12,
} as const satisfies ThemeMeta

export const CSRF_META = {
  id: 'csrf',
  kind: 'sequence',
  category: 'security',
  title: {
    en: 'Cookies and CSRF: SameSite, tokens and Fetch Metadata',
    ja: 'Cookie と CSRF: SameSite、トークン、Fetch Metadata',
  },
  summary: {
    en: 'How a session cookie makes the browser send authenticated requests that another site started (CSRF), how SameSite=Lax and Strict decide when the cookie goes along, why a GET that changes data still gets through, and how a CSRF token or a check of Origin and Sec-Fetch-Site stops the attack.',
    ja: 'セッション Cookie のせいで、別のサイトが始めた要求にもブラウザーが認証を付けて送ってしまうしくみ（CSRF）、SameSite=Lax と Strict が Cookie を付けるかどうかを決める規則、データを変える GET がそれでも通ってしまう理由、CSRF トークンや Origin と Sec-Fetch-Site の確認で攻撃を止める方法。',
  },
  difficulty: 'intermediate',
  minutes: 15,
} as const satisfies ThemeMeta

export const WEBSOCKET_META = {
  id: 'websocket',
  kind: 'sequence',
  category: 'http',
  title: {
    en: 'WebSocket: handshake, frames, and closing',
    ja: 'WebSocket: ハンドシェイク、フレーム、接続の終了',
  },
  summary: {
    en: 'How a browser turns an HTTP request into a two-way WebSocket connection with 101 Switching Protocols, why every frame from the browser is masked, how Ping and Pong check that the other side is still there, and how the closing handshake ends it.',
    ja: 'ブラウザーが HTTP の要求を 101 Switching Protocols で双方向の WebSocket の接続に切り替えるしくみ、ブラウザーからのフレームをすべてマスクする理由、Ping と Pong で相手がまだいるかを確かめるしくみ、終了のハンドシェイクで閉じる流れ。',
  },
  difficulty: 'intermediate',
  minutes: 15,
} as const satisfies ThemeMeta

export const SERVER_SENT_EVENTS_META = {
  id: 'server-sent-events',
  kind: 'sequence',
  category: 'http',
  title: {
    en: 'Server-Sent Events: a response that never ends, and reconnecting on its own',
    ja: 'Server-Sent Events: 終わらない応答と自動の再接続',
  },
  summary: {
    en: 'How a server sends events to a page over one HTTP response that never ends (text/event-stream), how the browser parses the stream, reconnects on its own with Last-Event-ID and gives up on 204 or a wrong Content-Type, and why six tabs over HTTP/1.1 run out of connections while HTTP/2 does not.',
    ja: 'サーバーが、終わらない 1 つの HTTP の応答（text/event-stream）でページにイベントを送るしくみ、ブラウザーがストリームを読み、Last-Event-ID を付けて自分で接続し直し、204 や誤った Content-Type ではあきらめるまで、そして 6 つのタブで HTTP/1.1 の接続が足りなくなり、HTTP/2 ではそうならない理由。',
  },
  difficulty: 'intermediate',
  minutes: 10,
} as const satisfies ThemeMeta

export const REVERSE_PROXY_META = {
  id: 'reverse-proxy',
  kind: 'sequence',
  category: 'http',
  title: {
    en: 'Reverse proxies and load balancers',
    ja: 'リバースプロキシとロードバランサー',
  },
  summary: {
    en: 'How a reverse proxy ends TLS and spreads requests over several backends, what it tells them with Forwarded, X-Forwarded-For and Via, and what happens when a backend crashes (502) or is too slow (504). Also sticky sessions, health checks, layer-4 load balancing with the PROXY protocol, and the proxy as a shared cache.',
    ja: 'リバースプロキシが TLS を終端し、要求を何台かのバックエンドに振り分けるしくみ、Forwarded・X-Forwarded-For・Via で伝えること、バックエンドが落ちたとき（502）や遅いとき（504）に起きること。スティッキーセッション、ヘルスチェック、PROXY protocol を使う L4 の負荷分散、共有キャッシュとしてのプロキシも。',
  },
  difficulty: 'intermediate',
  minutes: 15,
} as const satisfies ThemeMeta

export const OAUTH_META = {
  id: 'oauth',
  kind: 'sequence',
  category: 'http',
  title: {
    en: 'OAuth 2.0 and OpenID Connect: the authorization code flow with PKCE',
    ja: 'OAuth 2.0 と OpenID Connect: PKCE 付きの認可コードフロー',
  },
  summary: {
    en: 'How “Log in with …” works: redirects through the browser, a code traded for tokens on the back channel, PKCE, state and nonce, checking the ID token, calling an API with a bearer token, and refreshing it when it expires.',
    ja: '「… でログイン」のしくみ。ブラウザーを通るリダイレクト、バックチャネルでコードをトークンに引き換えること、PKCE と state と nonce、ID トークンの確かめ、Bearer トークンでの API の呼び出し、期限切れのときのリフレッシュ。',
  },
  difficulty: 'intermediate',
  minutes: 20,
} as const satisfies ThemeMeta

export const ARP_META = {
  id: 'arp',
  kind: 'sequence',
  category: 'ip',
  title: { en: 'ARP: from IP address to MAC address', ja: 'ARP: IP アドレスから MAC アドレスへ' },
  summary: {
    en: 'How your PC finds the MAC address of the next device on the LAN before it can send a packet, and why that device is the router for anything on the Internet.',
    ja: 'パケットを送る前に、PC が LAN の次の機器の MAC アドレスを調べるしくみと、インターネット宛てならその機器がルーターになる理由。',
  },
  difficulty: 'beginner',
  minutes: 8,
} as const satisfies ThemeMeta

export const DHCP_META = {
  id: 'dhcp',
  kind: 'sequence',
  category: 'ip',
  title: { en: 'DHCP: getting an IP address', ja: 'DHCP: IP アドレスをもらう' },
  summary: {
    en: 'How a PC that has just connected gets an IP address, a subnet mask, a gateway, and a DNS server from a DHCP server, and how it keeps the lease.',
    ja: 'つながったばかりの PC が、DHCP サーバーから IP アドレス、サブネットマスク、ゲートウェイ、DNS サーバーをもらうしくみと、リースを続ける方法。',
  },
  difficulty: 'beginner',
  minutes: 10,
} as const satisfies ThemeMeta

export const ICMP_META = {
  id: 'icmp',
  kind: 'sequence',
  category: 'ip',
  title: { en: 'ICMP: ping and traceroute', ja: 'ICMP: ping と traceroute' },
  summary: {
    en: 'How ping checks that a host is reachable, and how traceroute uses TTL and Time Exceeded to find every router on the path.',
    ja: 'ping がホストに届くかを確かめるしくみと、traceroute が TTL と Time Exceeded を使って途中のルーターを調べるしくみ。',
  },
  difficulty: 'beginner',
  minutes: 12,
} as const satisfies ThemeMeta

export const PMTUD_META = {
  id: 'pmtud',
  kind: 'sequence',
  category: 'ip',
  title: {
    en: 'Path MTU discovery: when a packet is too big',
    ja: 'パス MTU 探索: パケットが大きすぎるとき',
  },
  summary: {
    en: 'How a host learns the largest packet that fits the whole path from ICMP Fragmentation Needed, what happens when that ICMP is blocked, and how routers fragment packets without DF.',
    ja: 'ホストが ICMP の Fragmentation Needed から経路全体に入る最大のパケットを知るしくみと、その ICMP が遮られたときに起きること、DF のないパケットをルーターが分割するしくみ。',
  },
  difficulty: 'intermediate',
  minutes: 12,
} as const satisfies ThemeMeta

export const NAT_META = {
  id: 'nat',
  kind: 'sequence',
  category: 'ip',
  title: { en: 'NAT: sharing one public address', ja: 'NAT: 1 つのグローバルアドレスを共有する' },
  summary: {
    en: 'How a home router rewrites addresses and ports so that many devices with private addresses can share one public address.',
    ja: '家庭のルーターがアドレスとポートを書き換え、プライベートアドレスの機器たちが 1 つのグローバルアドレスを共有するしくみ。',
  },
  difficulty: 'intermediate',
  minutes: 10,
} as const satisfies ThemeMeta

export const NAT_TRAVERSAL_META = {
  id: 'nat-traversal',
  kind: 'sequence',
  category: 'ip',
  title: { en: 'NAT traversal: STUN, TURN and ICE', ja: 'NAT 越え: STUN・TURN・ICE' },
  summary: {
    en: 'How two PCs behind different NATs find a path to each other: STUN tells each one its public address, ICE tries every pair of addresses, and a TURN server relays the traffic when nothing else works.',
    ja: '別々の NAT の内側にある 2 台の PC が通り道を見つけるまで。STUN で自分のグローバルアドレスを知り、ICE でアドレスの組をすべて試し、どれも通らなければ TURN のサーバーが中継する。',
  },
  difficulty: 'intermediate',
  minutes: 20,
} as const satisfies ThemeMeta

export const BGP_ANYCAST_META = {
  id: 'bgp-anycast',
  kind: 'sequence',
  category: 'ip',
  title: {
    en: 'BGP and anycast: how routes travel, and one address in many places',
    ja: 'BGP とエニーキャスト: 経路が伝わるしくみと、1 つのアドレスを複数の拠点で',
  },
  summary: {
    en: 'How networks tell each other which addresses they reach (OPEN, KEEPALIVE, UPDATE, AS_PATH), how a router picks the shortest path, and how one DNS address served from two sites fails over, and why a route change breaks TCP but not UDP.',
    ja: 'ネットワークどうしが、届けられるアドレスを伝え合うしくみ（OPEN、KEEPALIVE、UPDATE、AS_PATH）、ルーターが短い経路を選ぶしくみ、2 つの拠点で応える 1 つの DNS のアドレスの切り替わり方、経路が変わると TCP は切れて UDP は切れない理由。',
  },
  difficulty: 'intermediate',
  minutes: 20,
} as const satisfies ThemeMeta

export const ROUTE_LOOKUP_META = {
  id: 'route-lookup',
  kind: 'custom',
  category: 'ip',
  title: { en: 'Route lookup: longest prefix match', ja: '経路の検索: 最長一致' },
  summary: {
    en: 'How a router picks where to send each packet: compare the destination with every prefix in the routing table, and the longest match wins.',
    ja: 'ルーターがパケットごとに送り先を決めるしくみ。宛先を経路表のプレフィックスと比べ、いちばん長く一致した経路を使う。',
  },
  difficulty: 'beginner',
  minutes: 10,
} as const satisfies ThemeMeta

export const HTTP_CACHING_META = {
  id: 'http-caching',
  kind: 'sequence',
  category: 'http',
  title: {
    en: 'HTTP caching: Cache-Control and ETag',
    ja: 'HTTP のキャッシュ: Cache-Control と ETag',
  },
  summary: {
    en: 'How the browser reuses a response while it is fresh, and revalidates it with ETag and If-None-Match to get a small 304 instead of the whole file.',
    ja: 'ブラウザーが応答を新しいうちは使い回し、古くなったら ETag と If-None-Match で確かめて、ファイル全体ではなく小さな 304 を受け取るしくみ。',
  },
  difficulty: 'beginner',
  minutes: 10,
} as const satisfies ThemeMeta

export const CORS_META = {
  id: 'cors',
  kind: 'sequence',
  category: 'http',
  title: {
    en: 'CORS: cross-origin requests and preflight',
    ja: 'CORS: オリジンをまたぐ要求とプリフライト',
  },
  summary: {
    en: 'Why a page on one origin cannot freely read an API on another, how the browser asks first with OPTIONS, and which Access-Control-* headers make it allow the request.',
    ja: '別のオリジンのページが API を自由に読めない理由、ブラウザーが OPTIONS で先に尋ねるしくみ、要求を許すための Access-Control-* ヘッダー。',
  },
  difficulty: 'beginner',
  minutes: 12,
} as const satisfies ThemeMeta

export const HTTP2_META = {
  id: 'http2',
  kind: 'sequence',
  category: 'http',
  title: {
    en: 'HTTP/1.1 vs HTTP/2: many requests on one connection',
    ja: 'HTTP/1.1 と HTTP/2: 1 つの接続でたくさんの要求',
  },
  summary: {
    en: 'Why HTTP/1.1 sends requests one after another on a connection, how HTTP/2 interleaves frames of several streams on one connection, and why one lost packet still stalls every stream.',
    ja: 'HTTP/1.1 が 1 つの接続で要求を順番にしか送れない理由、HTTP/2 が複数のストリームのフレームを 1 つの接続に混ぜて送るしくみ、それでもパケットが 1 つ失われると全ストリームが止まる理由。',
  },
  difficulty: 'intermediate',
  minutes: 12,
} as const satisfies ThemeMeta

export const QUIC_META = {
  id: 'quic',
  kind: 'sequence',
  category: 'http',
  title: {
    en: 'QUIC and HTTP/3: handshake, 0-RTT, and loss',
    ja: 'QUIC と HTTP/3: ハンドシェイク、0-RTT、ロス',
  },
  summary: {
    en: 'How QUIC folds the transport and TLS handshakes into one round trip over UDP, sends requests with 0-RTT on a returning visit, and keeps a lost packet from stalling other streams.',
    ja: 'QUIC が UDP の上でトランスポートと TLS のハンドシェイクを 1 往復にまとめるしくみ、再訪問のときに 0-RTT で要求を送るしくみ、失われたパケットがほかのストリームを止めない理由。',
  },
  difficulty: 'intermediate',
  minutes: 15,
} as const satisfies ThemeMeta

export const SWITCHING_META = {
  id: 'switching',
  kind: 'sequence',
  category: 'lan',
  title: {
    en: 'Switching: how a switch learns MAC addresses',
    ja: 'スイッチ: MAC アドレスを学習する',
  },
  summary: {
    en: 'How a switch learns which port each MAC address is behind, why it floods a frame to every other port when it does not know, and why it stops flooding once it has learned.',
    ja: 'スイッチが MAC アドレスごとにどのポートの先にいるかを学習するしくみ、知らない宛先のフレームをほかの全ポートに流す（フラッディング）理由、学習した後は流さなくなる理由。',
  },
  difficulty: 'beginner',
  minutes: 8,
} as const satisfies ThemeMeta

export const IPV6_ADDRESS_META = {
  id: 'ipv6-address',
  kind: 'custom',
  category: 'basics',
  title: { en: 'IPv6 addresses: notation and kinds', ja: 'IPv6 アドレス: 表記と種類' },
  summary: {
    en: 'How a 128-bit IPv6 address is written and shortened (RFC 5952), how to tell link-local, global, multicast and other kinds apart, and how an interface ID can come from a MAC address.',
    ja: '128 ビットの IPv6 アドレスの書き方と短くし方（RFC 5952）、リンクローカル・グローバル・マルチキャストなどの種類の見分け方、MAC アドレスからインターフェース ID を作る方法。',
  },
  difficulty: 'beginner',
  minutes: 8,
} as const satisfies ThemeMeta

export const VLAN_META = {
  id: 'vlan',
  kind: 'sequence',
  category: 'lan',
  title: {
    en: 'VLAN: one switch, separate networks',
    ja: 'VLAN: 1 台のスイッチを別々のネットワークに分ける',
  },
  summary: {
    en: 'How VLANs keep a broadcast inside one group of ports, how an 802.1Q tag carries the VLAN ID across a trunk link, and why traffic between two VLANs has to go through a router.',
    ja: 'VLAN がブロードキャストを同じグループのポートの中に閉じ込めるしくみ、802.1Q のタグがトランクリンクで VLAN ID を運ぶしくみ、別の VLAN との通信がルーターを通らなければならない理由。',
  },
  difficulty: 'intermediate',
  minutes: 12,
} as const satisfies ThemeMeta

export const CONTAINER_NETWORKING_META = {
  id: 'container-networking',
  kind: 'sequence',
  category: 'lan',
  title: {
    en: 'Container networking: veth, bridge and NAT',
    ja: 'コンテナーのネットワーク: veth、ブリッジ、NAT',
  },
  summary: {
    en: 'How a container’s packets reach the outside world: a veth pair connects the container to a bridge in the host, the host routes the packet and rewrites its source (MASQUERADE), and connection tracking sends the reply back. Also published ports (DNAT), containers talking over the bridge, and Docker’s embedded DNS server.',
    ja: 'コンテナーのパケットが外に出るまで。veth ペアがコンテナーをホストの中のブリッジにつなぎ、ホストが経路を選んで送信元を書き換え（MASQUERADE）、接続の追跡が返事を戻す。ポートの公開（DNAT）、ブリッジを通るコンテナー同士の通信、Docker の組み込みの DNS サーバーも。',
  },
  difficulty: 'intermediate',
  minutes: 15,
} as const satisfies ThemeMeta

export const VXLAN_META = {
  id: 'vxlan',
  kind: 'sequence',
  category: 'lan',
  title: {
    en: 'VXLAN: stretching a LAN over an IP network',
    ja: 'VXLAN: IP ネットワークの上に LAN を延ばす',
  },
  summary: {
    en: 'How a VTEP wraps an Ethernet frame in UDP (port 4789) with a 24-bit VNI, floods the first ARP to the other VTEPs and learns which host each MAC address is behind, keeps tenants apart on one network, why the 50 bytes of overhead cause MTU trouble, and how the outer source port spreads flows over equal-cost paths.',
    ja: 'VTEP が Ethernet のフレームを 24 ビットの VNI とともに UDP（ポート 4789）で包むしくみ、最初の ARP をほかの VTEP に流して、どの MAC アドレスがどのホストの先にいるかを学習するしくみ、1 つのネットワークの上でテナントを分けるしくみ、50 バイトのオーバーヘッドが MTU の問題を起こす理由、外側の送信元ポートで流れを等コストの経路に散らすしくみ。',
  },
  difficulty: 'intermediate',
  minutes: 18,
} as const satisfies ThemeMeta

export const WIFI_META = {
  id: 'wifi',
  kind: 'sequence',
  category: 'lan',
  title: {
    en: 'Wi-Fi: joining a wireless network',
    ja: 'Wi-Fi: 無線 LAN につながる',
  },
  summary: {
    en: 'How a laptop finds a Wi-Fi network, authenticates and associates with the access point, agrees on keys in the WPA2 4-way handshake without sending the passphrase, and shares the air with CSMA/CA: ToDS / FromDS addresses, backoff, Acks, hidden nodes and RTS/CTS.',
    ja: 'ノート PC が Wi-Fi のネットワークを見つけ、アクセスポイントと認証・アソシエーションし、パスフレーズを送らずに WPA2 の 4 ウェイハンドシェイクで鍵を決め、CSMA/CA で電波を分け合うまで。ToDS / FromDS とアドレス、バックオフ、Ack、隠れ端末と RTS/CTS。',
  },
  difficulty: 'intermediate',
  minutes: 18,
} as const satisfies ThemeMeta

export const IPV6_ND_META = {
  id: 'ipv6-nd',
  kind: 'sequence',
  category: 'lan',
  title: {
    en: 'IPv6 on the LAN: SLAAC and Neighbor Discovery',
    ja: 'IPv6 で LAN につながる: SLAAC と近隣探索',
  },
  summary: {
    en: 'How an IPv6 host gives itself a link-local address, checks that nobody else uses it (DAD), learns the prefix and default router from a Router Advertisement, builds a global address without DHCP, and finds a neighbor’s MAC address with Neighbor Solicitation instead of ARP.',
    ja: 'IPv6 のホストが自分でリンクローカルアドレスを作り、誰も使っていないか確かめ（DAD）、Router Advertisement からプレフィックスとデフォルトルーターを知り、DHCP なしでグローバルアドレスを作り、ARP の代わりに Neighbor Solicitation で隣の機器の MAC アドレスを調べるまで。',
  },
  difficulty: 'intermediate',
  minutes: 15,
} as const satisfies ThemeMeta

/**
 * サイトで案内する学習順。分類（THEME_CATEGORIES）の順にまとめて並べる（registry.test.ts で確かめる）。
 * 基礎（OSI 参照モデル → サブネット計算 → IPv6 アドレス）→ ネットワークにつながるまで（ARP → DHCP → ICMP → パス MTU 探索 → NAT → NAT 越え → 経路の検索 → BGP とエニーキャスト）→ LAN の中（スイッチ → VLAN → コンテナーのネットワーク → VXLAN → Wi-Fi → IPv6 の SLAAC・近隣探索）→ Web ページが届くまで（DNS → TCP → TLS → HTTPS の全体像）→ TCP をもっと詳しく → Web 開発で出会う HTTP（HTTP のキャッシュ → CORS → HTTP/2 → QUIC → WebSocket → Server-Sent Events → リバースプロキシとロードバランサー → OAuth 2.0 と OpenID Connect）→ ネットワークのセキュリティ（ARP スプーフィング → ファイアウォール → WireGuard → DNSSEC → メールの送信ドメイン認証 → HSTS → Cookie と CSRF）
 */
export const THEME_META = [
  OSI_MODEL_META,
  SUBNET_CALCULATOR_META,
  IPV6_ADDRESS_META,
  ARP_META,
  DHCP_META,
  ICMP_META,
  PMTUD_META,
  NAT_META,
  NAT_TRAVERSAL_META,
  ROUTE_LOOKUP_META,
  BGP_ANYCAST_META,
  SWITCHING_META,
  VLAN_META,
  CONTAINER_NETWORKING_META,
  VXLAN_META,
  WIFI_META,
  IPV6_ND_META,
  DNS_RESOLUTION_META,
  TCP_HANDSHAKE_META,
  TLS_HANDSHAKE_META,
  HTTPS_OVERVIEW_META,
  TCP_CLOSE_META,
  TCP_CONGESTION_META,
  TCP_FLOW_CONTROL_META,
  TCP_SACK_META,
  HTTP_CACHING_META,
  CORS_META,
  HTTP2_META,
  QUIC_META,
  WEBSOCKET_META,
  SERVER_SENT_EVENTS_META,
  REVERSE_PROXY_META,
  OAUTH_META,
  ARP_SPOOFING_META,
  FIREWALL_META,
  WIREGUARD_META,
  DNSSEC_META,
  MAIL_AUTH_META,
  HSTS_META,
  CSRF_META,
] as const satisfies readonly ThemeMeta[]

export type ThemeId = (typeof THEME_META)[number]['id']

export const THEME_IDS: readonly ThemeId[] = THEME_META.map((theme) => theme.id)

/** 指定した種類のテーマのメタ情報（学習順） */
export function themeMetaOfKind(kind: ThemeKind): readonly ThemeMeta[] {
  const all: readonly ThemeMeta[] = THEME_META
  return all.filter((meta) => meta.kind === kind)
}

export interface ThemeGroup<T extends { readonly meta: ThemeMeta } | ThemeMeta> {
  readonly category: ThemeCategory
  readonly themes: readonly T[]
}

/** 分類ごとにまとめる（分類の順、分類の中は元の順）。テーマのない分類は含めない */
export function groupByCategory<T extends ThemeMeta | { readonly meta: ThemeMeta }>(
  items: readonly T[],
): readonly ThemeGroup<T>[] {
  const categoryOf = (item: T) => ('meta' in item ? item.meta.category : item.category)
  return THEME_CATEGORIES.map((category) => ({
    category,
    themes: items.filter((item) => categoryOf(item) === category),
  })).filter((group) => group.themes.length > 0)
}
