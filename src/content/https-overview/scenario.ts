/**
 * HTTPS の全体像: ブラウザーが https://www.example.com/ を開くまで（DNS → TCP → TLS → HTTP）。
 * 既存のテーマのシナリオを composeScenarios でつなげる。各パートの根拠は、それぞれのシナリオを参照
 * （DNS: RFC 1034 / 1035、TCP: RFC 9293、TLS 1.3: RFC 8446、証明書: RFC 5280、HTTP/2: RFC 9113）。
 *
 * - DNS のスタブリゾルバー（stub）は、ブラウザーの動いている PC なので client に寄せる
 * - What-if は出さない（出すと組み合わせが各パートの積になる。分岐はそれぞれのテーマで試す）
 * - 帯はパートの名前にする（TLS の暗号化の区間は、メッセージの鍵のマークで見分けられる）
 */
import { composeScenarios } from '@/engine/compose'
import { toScenarioHandle } from '@/engine/scenario'
import { dnsResolutionScenario } from '../dns-resolution/scenario'
import { tcpHandshakeScenario } from '../tcp-handshake/scenario'
import { tlsHandshakeScenario } from '../tls-handshake/scenario'
import { httpResponseScenario } from './http'

export const HTTPS_SECTIONS = {
  dns: { en: '1. Look up the address (DNS)', ja: '1. アドレスを調べる（DNS）' },
  tcp: { en: '2. Connect (TCP)', ja: '2. 接続する（TCP）' },
  tls: { en: '3. Secure the connection (TLS)', ja: '3. 接続を暗号化する（TLS）' },
  http: { en: '4. Get the page (HTTP)', ja: '4. ページを受け取る（HTTP）' },
} as const

/** 証明書チェーンの検証結果の状態のキー（合成で TLS の接頭辞が付く） */
export const HTTPS_CERT_CHAIN = 'tls.certChain'

export const httpsOverviewScenario = composeScenarios({
  id: 'https-overview',
  title: { en: 'HTTPS from start to finish', ja: 'HTTPS の全体像' },
  actors: [
    {
      id: 'client',
      kind: 'client',
      name: { en: 'Browser', ja: 'ブラウザー' },
      shortName: { en: 'Browser', ja: 'ブラウザー' },
    },
    {
      id: 'resolver',
      kind: 'resolver',
      name: { en: 'Full-service resolver', ja: 'フルサービスリゾルバー' },
      shortName: { en: 'Resolver', ja: 'リゾルバー' },
    },
    {
      id: 'root',
      kind: 'nameServer',
      name: { en: 'Root server', ja: 'ルートサーバー' },
      shortName: { en: 'Root', ja: 'ルート' },
    },
    {
      id: 'tld',
      kind: 'nameServer',
      name: { en: '.com TLD server', ja: '.com の TLD サーバー' },
      shortName: { en: '.com', ja: '.com' },
    },
    {
      id: 'auth',
      kind: 'nameServer',
      name: { en: 'example.com authoritative servers', ja: 'example.com の権威サーバー' },
      shortName: { en: 'example.com', ja: 'example.com' },
    },
    {
      id: 'server',
      kind: 'server',
      name: { en: 'Web server (www.example.com)', ja: 'Web サーバー（www.example.com）' },
      shortName: { en: 'Web server', ja: 'Web サーバー' },
    },
  ],
  parts: [
    {
      prefix: 'dns',
      handle: toScenarioHandle(dnsResolutionScenario),
      actorMap: { stub: 'client' },
      section: HTTPS_SECTIONS.dns,
    },
    { prefix: 'tcp', handle: toScenarioHandle(tcpHandshakeScenario), section: HTTPS_SECTIONS.tcp },
    { prefix: 'tls', handle: toScenarioHandle(tlsHandshakeScenario), section: HTTPS_SECTIONS.tls },
    {
      prefix: 'http',
      handle: toScenarioHandle(httpResponseScenario),
      section: HTTPS_SECTIONS.http,
    },
  ],
})
