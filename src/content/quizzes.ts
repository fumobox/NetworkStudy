import type { Quiz } from '@/components/features/quiz/types'
import { dnsResolutionQuiz } from './dns-resolution/quiz'
import { tcpHandshakeQuiz } from './tcp-handshake/quiz'
import {
  DNS_RESOLUTION_META,
  TCP_HANDSHAKE_META,
  TLS_HANDSHAKE_META,
  type ThemeMeta,
} from './themeMeta'
import { tlsHandshakeQuiz } from './tls-handshake/quiz'

/**
 * メタ情報とクイズだけの軽い一覧（ホームでクイズの進捗を出すため）。
 * シナリオやパネルを含む registry を import すると、ホームの初回ロードにテーマのページが入ってしまう。
 * 並び順と内容が registry と一致することは registry.test.ts で確かめる
 */
export const THEME_QUIZZES: readonly { readonly meta: ThemeMeta; readonly quiz: Quiz }[] = [
  { meta: DNS_RESOLUTION_META, quiz: dnsResolutionQuiz },
  { meta: TCP_HANDSHAKE_META, quiz: tcpHandshakeQuiz },
  { meta: TLS_HANDSHAKE_META, quiz: tlsHandshakeQuiz },
]
