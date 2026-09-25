/**
 * HTTPS の全体像の最後のパート: TLS で保護された HTTP/2 の応答。
 * 要求（GET /）は TLS のシナリオの最後のステップ（application-data）で送っているので、ここでは応答から始める。
 *
 * 根拠:
 * - RFC 9113 §8.3.2（Response Pseudo-Header Fields）: 応答のステータスは :status 疑似ヘッダーで送る
 * - RFC 9113 §6.1 / §6.2: 本文は DATA フレーム、ヘッダーは HEADERS フレームで送る
 * - RFC 8446 §5.2: 暗号化されたレコードは、外からは application_data に見える
 */
import { z } from 'zod'
import type { Actor, Scenario, Step } from '@/engine/types'

const optionsSchema = z.object({})
type HttpOptions = z.infer<typeof optionsSchema>

const actors: readonly Actor[] = [
  { id: 'client', kind: 'client', name: { en: 'Client', ja: 'クライアント' }, stateSlots: [] },
  { id: 'server', kind: 'server', name: { en: 'Server', ja: 'サーバー' }, stateSlots: [] },
]

const steps: readonly Step[] = [
  {
    id: 'response',
    title: { en: 'The server returns the page', ja: 'サーバーがページを返す' },
    description: {
      en: 'The server answers the request with status 200 (OK) and the HTML of the page, encrypted with application traffic keys from the same handshake (each direction has its own keys).',
      ja: 'サーバーは要求に、ステータス 200（OK）とページの HTML で応える。これも、同じハンドシェイクで導いたアプリケーション用の鍵で暗号化される（鍵は向きごとに別）。',
    },
    events: [
      {
        kind: 'message',
        message: {
          id: 'response',
          from: 'server',
          to: 'client',
          label: 'Application Data',
          status: 'delivered',
          encrypted: true,
          description: {
            en: 'The HTTP/2 response, protected by TLS.',
            ja: 'TLS で保護された HTTP/2 の応答。',
          },
          fields: [
            {
              name: 'Record type',
              value: 'application_data',
              description: {
                en: 'From the outside, this looks like any other encrypted record.',
                ja: '外からは、ほかの暗号化されたレコードと同じに見える。',
              },
            },
            {
              name: 'content',
              value:
                'HTTP/2 HEADERS: :status 200\ncontent-type: text/html\nHTTP/2 DATA: <!doctype html>…',
              highlight: true,
              description: {
                en: 'The status and headers come in a HEADERS frame and the page itself in DATA frames. Only the two endpoints can read them.',
                ja: 'ステータスとヘッダーは HEADERS フレーム、ページの本体は DATA フレームで送られる。読めるのは両端の 2 者だけ。',
              },
            },
          ],
        },
      },
    ],
  },
  {
    id: 'page-shown',
    title: { en: 'The browser shows the page', ja: 'ブラウザーがページを表示する' },
    description: {
      en: 'The browser decrypts the response and displays the page. Images and scripts from the same server are fetched over the same connection, without another DNS lookup or handshake.',
      ja: 'ブラウザーは応答を復号してページを表示する。同じサーバーにある画像やスクリプトは同じ接続で取得するので、名前解決やハンドシェイクをやり直す必要はない。',
    },
    events: [],
  },
]

/** HTTP の応答（HTTPS の全体像の合成にだけ使い、単独のテーマにはしない） */
export const httpResponseScenario: Scenario<HttpOptions> = {
  id: 'http-response',
  title: { en: 'HTTP response', ja: 'HTTP の応答' },
  actors,
  optionDefs: {},
  parseOptions: (raw) => optionsSchema.parse(raw),
  buildSteps: () => steps,
}
