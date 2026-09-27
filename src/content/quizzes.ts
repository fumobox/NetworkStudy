import { arpQuiz } from './arp/quiz'
import { corsQuiz } from './cors/quiz'
import { dhcpQuiz } from './dhcp/quiz'
import { dnsResolutionQuiz } from './dns-resolution/quiz'
import { httpCachingQuiz } from './http-caching/quiz'
import { http2Quiz } from './http2/quiz'
import { httpsOverviewQuiz } from './https-overview/quiz'
import { icmpQuiz } from './icmp/quiz'
import { ipv6AddressQuiz } from './ipv6-address/quiz'
import { natQuiz } from './nat/quiz'
import { osiModelQuiz } from './osi-model/quiz'
import { quicQuiz } from './quic/quiz'
import { routeLookupQuiz } from './route-lookup/quiz'
import { subnetCalculatorQuiz } from './subnet-calculator/quiz'
import { switchingQuiz } from './switching/quiz'
import { tcpCloseQuiz } from './tcp-close/quiz'
import { tcpCongestionQuiz } from './tcp-congestion/quiz'
import { tcpHandshakeQuiz } from './tcp-handshake/quiz'
import {
  ARP_META,
  CORS_META,
  DHCP_META,
  DNS_RESOLUTION_META,
  HTTP_CACHING_META,
  HTTP2_META,
  HTTPS_OVERVIEW_META,
  ICMP_META,
  IPV6_ADDRESS_META,
  NAT_META,
  OSI_MODEL_META,
  QUIC_META,
  ROUTE_LOOKUP_META,
  SUBNET_CALCULATOR_META,
  SWITCHING_META,
  TCP_CLOSE_META,
  TCP_CONGESTION_META,
  TCP_HANDSHAKE_META,
  TLS_HANDSHAKE_META,
  VLAN_META,
} from './themeMeta'
import { tlsHandshakeQuiz } from './tls-handshake/quiz'
import { vlanQuiz } from './vlan/quiz'
import type { ThemeModule } from './types'

/**
 * メタ情報とクイズだけの軽い一覧（ホームでクイズの進捗を出すため）。
 * シナリオやパネルを含む registry を import すると、ホームの初回ロードにテーマのページが入ってしまう。
 * 並び順と内容が registry と一致することは registry.test.ts で確かめる
 */
export const THEME_QUIZZES: readonly Pick<ThemeModule, 'meta' | 'quiz'>[] = [
  { meta: OSI_MODEL_META, quiz: osiModelQuiz },
  { meta: SUBNET_CALCULATOR_META, quiz: subnetCalculatorQuiz },
  { meta: IPV6_ADDRESS_META, quiz: ipv6AddressQuiz },
  { meta: ARP_META, quiz: arpQuiz },
  { meta: DHCP_META, quiz: dhcpQuiz },
  { meta: ICMP_META, quiz: icmpQuiz },
  { meta: NAT_META, quiz: natQuiz },
  { meta: ROUTE_LOOKUP_META, quiz: routeLookupQuiz },
  { meta: SWITCHING_META, quiz: switchingQuiz },
  { meta: VLAN_META, quiz: vlanQuiz },
  { meta: DNS_RESOLUTION_META, quiz: dnsResolutionQuiz },
  { meta: TCP_HANDSHAKE_META, quiz: tcpHandshakeQuiz },
  { meta: TLS_HANDSHAKE_META, quiz: tlsHandshakeQuiz },
  { meta: HTTPS_OVERVIEW_META, quiz: httpsOverviewQuiz },
  { meta: TCP_CLOSE_META, quiz: tcpCloseQuiz },
  { meta: TCP_CONGESTION_META, quiz: tcpCongestionQuiz },
  { meta: HTTP_CACHING_META, quiz: httpCachingQuiz },
  { meta: CORS_META, quiz: corsQuiz },
  { meta: HTTP2_META, quiz: http2Quiz },
  { meta: QUIC_META, quiz: quicQuiz },
]
