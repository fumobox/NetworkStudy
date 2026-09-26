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
 * basics: ネットワークの基礎、ip: ネットワークにつながるまで（ARP、DHCP、ICMP、NAT、経路制御）、
 * web: Web ページが届くまで（DNS → TCP → TLS → HTTPS）、tcp: TCP をもっと詳しく
 */
export const THEME_CATEGORIES = ['basics', 'ip', 'web', 'tcp'] as const
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

/**
 * サイトで案内する学習順。分類（THEME_CATEGORIES）の順にまとめて並べる（registry.test.ts で確かめる）。
 * 基礎（OSI 参照モデル → サブネット計算）→ ネットワークにつながるまで（ARP …）→ Web ページが届くまで（DNS → TCP → TLS → HTTPS の全体像）→ TCP をもっと詳しく
 */
export const THEME_META = [
  OSI_MODEL_META,
  SUBNET_CALCULATOR_META,
  ARP_META,
  DNS_RESOLUTION_META,
  TCP_HANDSHAKE_META,
  TLS_HANDSHAKE_META,
  HTTPS_OVERVIEW_META,
  TCP_CLOSE_META,
  TCP_CONGESTION_META,
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
