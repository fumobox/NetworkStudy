/**
 * 公開するテーマのメタ情報。URL は `/:locale/themes/:id`。
 * 静的ページ生成スクリプト（scripts/）からも読み込むため、このファイルは型以外を import しない。
 */
import type { LocalizedText } from '@/lib/i18n/locale'

export const DIFFICULTIES = ['beginner', 'intermediate'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

export interface ThemeMeta {
  /** URL とファイルパスに使うので、英小文字・数字・ハイフンのみ */
  readonly id: string
  readonly title: LocalizedText
  readonly summary: LocalizedText
  readonly difficulty: Difficulty
  /** 目安の所要時間（分） */
  readonly minutes: number
}

export const DNS_RESOLUTION_META = {
  id: 'dns-resolution',
  title: { en: 'DNS name resolution', ja: 'DNS の名前解決' },
  summary: {
    en: 'How a name like www.example.com becomes an IP address: a resolver follows referrals from the root to the right server, and caches what it learns.',
    ja: 'www.example.com のような名前が IP アドレスになるまで。リゾルバがルートから委任をたどって担当のサーバーにたどり着き、わかったことをキャッシュする流れ。',
  },
  difficulty: 'beginner',
  minutes: 12,
} as const satisfies ThemeMeta

export const TCP_HANDSHAKE_META = {
  id: 'tcp-handshake',
  title: { en: 'TCP three-way handshake', ja: 'TCP 3 ウェイハンドシェイク' },
  summary: {
    en: 'How two hosts agree on sequence numbers and open a TCP connection, and what happens when a segment is lost or the port is closed.',
    ja: '2 つのホストがシーケンス番号を合わせて TCP の接続を開く流れと、セグメントが失われたときやポートが閉じているときに何が起きるか。',
  },
  difficulty: 'beginner',
  minutes: 10,
} as const satisfies ThemeMeta

/** サイトで案内する学習順（DNS → TCP → TLS）に並べる */
export const THEME_META = [
  DNS_RESOLUTION_META,
  TCP_HANDSHAKE_META,
] as const satisfies readonly ThemeMeta[]

export type ThemeId = (typeof THEME_META)[number]['id']

export const THEME_IDS: readonly ThemeId[] = THEME_META.map((theme) => theme.id)
