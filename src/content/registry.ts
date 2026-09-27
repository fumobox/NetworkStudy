import { arpTheme } from './arp'
import { corsTheme } from './cors'
import { dhcpTheme } from './dhcp'
import { dnsResolutionTheme } from './dns-resolution'
import { httpCachingTheme } from './http-caching'
import { http2Theme } from './http2'
import { httpsOverviewTheme } from './https-overview'
import { icmpTheme } from './icmp'
import { natTheme } from './nat'
import { osiModelTheme } from './osi-model'
import { routeLookupTheme } from './route-lookup'
import { subnetCalculatorTheme } from './subnet-calculator'
import { tcpCloseTheme } from './tcp-close'
import { tcpCongestionTheme } from './tcp-congestion'
import { tcpHandshakeTheme } from './tcp-handshake'
import { tlsHandshakeTheme } from './tls-handshake'
import type { ThemeModule } from './types'

/** 公開するテーマ（themeMeta.ts の THEME_META と同じ順・同じ id。registry.test.ts で確認する） */
export const THEMES: readonly ThemeModule[] = [
  osiModelTheme,
  subnetCalculatorTheme,
  arpTheme,
  dhcpTheme,
  icmpTheme,
  natTheme,
  routeLookupTheme,
  dnsResolutionTheme,
  tcpHandshakeTheme,
  tlsHandshakeTheme,
  httpsOverviewTheme,
  tcpCloseTheme,
  tcpCongestionTheme,
  httpCachingTheme,
  corsTheme,
  http2Theme,
]

export function findTheme(id: string | undefined): ThemeModule | undefined {
  return THEMES.find((theme) => theme.meta.id === id)
}
