import { dnsResolutionTheme } from './dns-resolution'
import { httpsOverviewTheme } from './https-overview'
import { osiModelTheme } from './osi-model'
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
  dnsResolutionTheme,
  tcpHandshakeTheme,
  tlsHandshakeTheme,
  httpsOverviewTheme,
  tcpCloseTheme,
  tcpCongestionTheme,
]

export function findTheme(id: string | undefined): ThemeModule | undefined {
  return THEMES.find((theme) => theme.meta.id === id)
}
