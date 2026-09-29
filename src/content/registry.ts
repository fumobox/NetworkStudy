import { arpTheme } from './arp'
import { corsTheme } from './cors'
import { csrfTheme } from './csrf'
import { dhcpTheme } from './dhcp'
import { dnsResolutionTheme } from './dns-resolution'
import { dnssecTheme } from './dnssec'
import { firewallTheme } from './firewall'
import { hstsTheme } from './hsts'
import { httpCachingTheme } from './http-caching'
import { http2Theme } from './http2'
import { httpsOverviewTheme } from './https-overview'
import { icmpTheme } from './icmp'
import { ipv6AddressTheme } from './ipv6-address'
import { ipv6NdTheme } from './ipv6-nd'
import { mailAuthTheme } from './mail-auth'
import { natTheme } from './nat'
import { natTraversalTheme } from './nat-traversal'
import { pmtudTheme } from './pmtud'
import { osiModelTheme } from './osi-model'
import { quicTheme } from './quic'
import { reverseProxyTheme } from './reverse-proxy'
import { routeLookupTheme } from './route-lookup'
import { serverSentEventsTheme } from './server-sent-events'
import { subnetCalculatorTheme } from './subnet-calculator'
import { switchingTheme } from './switching'
import { tcpCloseTheme } from './tcp-close'
import { tcpCongestionTheme } from './tcp-congestion'
import { tcpFlowControlTheme } from './tcp-flow-control'
import { tcpSackTheme } from './tcp-sack'
import { tcpHandshakeTheme } from './tcp-handshake'
import { tlsHandshakeTheme } from './tls-handshake'
import { vlanTheme } from './vlan'
import { webSocketTheme } from './websocket'
import { wifiTheme } from './wifi'
import type { ThemeModule } from './types'

/** 公開するテーマ（themeMeta.ts の THEME_META と同じ順・同じ id。registry.test.ts で確認する） */
export const THEMES: readonly ThemeModule[] = [
  osiModelTheme,
  subnetCalculatorTheme,
  ipv6AddressTheme,
  arpTheme,
  dhcpTheme,
  icmpTheme,
  pmtudTheme,
  natTheme,
  natTraversalTheme,
  routeLookupTheme,
  switchingTheme,
  vlanTheme,
  wifiTheme,
  ipv6NdTheme,
  dnsResolutionTheme,
  tcpHandshakeTheme,
  tlsHandshakeTheme,
  httpsOverviewTheme,
  tcpCloseTheme,
  tcpCongestionTheme,
  tcpFlowControlTheme,
  tcpSackTheme,
  httpCachingTheme,
  corsTheme,
  http2Theme,
  quicTheme,
  webSocketTheme,
  serverSentEventsTheme,
  reverseProxyTheme,
  firewallTheme,
  dnssecTheme,
  mailAuthTheme,
  hstsTheme,
  csrfTheme,
]

export function findTheme(id: string | undefined): ThemeModule | undefined {
  return THEMES.find((theme) => theme.meta.id === id)
}
