import { dnsResolutionQuiz } from './dns-resolution/quiz'
import { httpsOverviewQuiz } from './https-overview/quiz'
import { osiModelQuiz } from './osi-model/quiz'
import { subnetCalculatorQuiz } from './subnet-calculator/quiz'
import { tcpCloseQuiz } from './tcp-close/quiz'
import { tcpCongestionQuiz } from './tcp-congestion/quiz'
import { tcpHandshakeQuiz } from './tcp-handshake/quiz'
import {
  DNS_RESOLUTION_META,
  HTTPS_OVERVIEW_META,
  OSI_MODEL_META,
  SUBNET_CALCULATOR_META,
  TCP_CLOSE_META,
  TCP_CONGESTION_META,
  TCP_HANDSHAKE_META,
  TLS_HANDSHAKE_META,
} from './themeMeta'
import { tlsHandshakeQuiz } from './tls-handshake/quiz'
import type { ThemeModule } from './types'

/**
 * メタ情報とクイズだけの軽い一覧（ホームでクイズの進捗を出すため）。
 * シナリオやパネルを含む registry を import すると、ホームの初回ロードにテーマのページが入ってしまう。
 * 並び順と内容が registry と一致することは registry.test.ts で確かめる
 */
export const THEME_QUIZZES: readonly Pick<ThemeModule, 'meta' | 'quiz'>[] = [
  { meta: DNS_RESOLUTION_META, quiz: dnsResolutionQuiz },
  { meta: TCP_HANDSHAKE_META, quiz: tcpHandshakeQuiz },
  { meta: TLS_HANDSHAKE_META, quiz: tlsHandshakeQuiz },
  { meta: HTTPS_OVERVIEW_META, quiz: httpsOverviewQuiz },
  { meta: TCP_CLOSE_META, quiz: tcpCloseQuiz },
  { meta: TCP_CONGESTION_META, quiz: tcpCongestionQuiz },
  { meta: SUBNET_CALCULATOR_META, quiz: subnetCalculatorQuiz },
  { meta: OSI_MODEL_META, quiz: osiModelQuiz },
]
