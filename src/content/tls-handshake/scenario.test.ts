// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { CERT_CHAIN_COLUMNS, tlsHandshakeScenario, type CertProblem } from './scenario'

const handle = toScenarioHandle(tlsHandshakeScenario)

function build(certProblem: CertProblem = 'none'): readonly Step[] {
  return tlsHandshakeScenario.buildSteps({ certProblem })
}

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}

function field(message: Message | undefined, name: string): string | undefined {
  return message?.fields.find((candidate) => candidate.name === name)?.value
}

function stateAt(steps: readonly Step[], index: number) {
  const derived = deriveState(tlsHandshakeScenario.actors, steps, index)
  return {
    client: derived.actorStates.client?.values,
    server: derived.actorStates.server?.values,
  }
}

/** 証明書チェーンの表を、証明書ごとに [Signature, Validity, Name, Trust] の形で取り出す */
function checks(steps: readonly Step[]): Record<string, string[]> {
  const chain = stateAt(steps, steps.length - 1).client?.certChain
  if (typeof chain !== 'object') return {}
  expect(chain.columns).toEqual(CERT_CHAIN_COLUMNS)
  return Object.fromEntries(chain.rows.map((row) => [row[0] ?? '', row.slice(4)]))
}

describe('tlsHandshakeScenario', () => {
  it('すべてのオプションで整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  describe('正常系（RFC 8446 §2 Figure 1）', () => {
    const steps = build()

    it('ClientHello から Finished まで 1 往復で進み、その後アプリケーションデータが流れる', () => {
      expect(messages(steps).map((m) => `${m.from}:${m.label}`)).toEqual([
        'client:ClientHello',
        'server:ServerHello',
        'server:EncryptedExtensions',
        'server:Certificate',
        'server:CertificateVerify',
        'server:Finished',
        'client:Finished',
        'client:Application Data',
      ])
    })

    it('ServerHello より後のメッセージはすべて暗号化され、外側のレコードの型は application_data', () => {
      const all = messages(steps)
      expect(all.map((m) => m.encrypted === true)).toEqual([
        false,
        false,
        true,
        true,
        true,
        true,
        true,
        true,
      ])
      for (const message of all.slice(2)) {
        expect(field(message, 'Record type')).toMatch(/^application_data \(inner: /)
      }
    })

    it('区間（暗号化なし → ハンドシェイク用の鍵 → アプリケーション用の鍵）', () => {
      expect(steps.map((step) => step.section?.en)).toEqual([
        'Not encrypted',
        'Not encrypted',
        ...Array<string>(6).fill('Encrypted with the handshake traffic keys'),
        'Encrypted with the application traffic keys',
      ])
    })

    it('ClientHello は TLS 1.3・key_share・SNI を、ServerHello は選んだ方式を示す', () => {
      const [clientHello, serverHello] = messages(steps)
      expect(field(clientHello, 'legacy_version')).toBe('0x0303 (TLS 1.2)')
      expect(field(clientHello, 'supported_versions')).toBe('TLS 1.3 (0x0304)')
      expect(field(clientHello, 'server_name')).toBe('www.example.com')
      expect(field(clientHello, 'key_share')).toMatch(/^x25519/)
      expect(field(serverHello, 'cipher_suite')).toBe('TLS_AES_128_GCM_SHA256')
      expect(field(serverHello, 'key_share')).toMatch(/^x25519/)
    })

    it('状態は RFC 8446 付録 A の状態機械に沿って進む', () => {
      const client = steps.map((_, i) => stateAt(steps, i).client?.state)
      const server = steps.map((_, i) => stateAt(steps, i).server?.state)
      expect(client).toEqual([
        'WAIT_SH',
        'WAIT_EE',
        'WAIT_CERT_CR',
        'WAIT_CV',
        'WAIT_CV',
        'WAIT_FINISHED',
        'WAIT_FINISHED',
        'CONNECTED',
        'CONNECTED',
      ])
      expect(server.at(1)).toBe('NEGOTIATED')
      expect(server.at(-1)).toBe('CONNECTED')
    })

    it('送信に使う鍵: ServerHello 以降はハンドシェイク用、各自の Finished の後はアプリケーション用', () => {
      const keys = steps.map((_, i) => {
        const state = stateAt(steps, i)
        const text = (value: unknown) => (typeof value === 'string' ? value : '?')
        return `${text(state.client?.sendKeys)}/${text(state.server?.sendKeys)}`
      })
      expect(keys).toEqual([
        'none/none',
        'handshake/handshake',
        'handshake/handshake',
        'handshake/handshake',
        'handshake/handshake',
        'handshake/handshake',
        'handshake/application',
        'application/application',
        'application/application',
      ])
    })

    it('証明書チェーンの検証はすべて合格する（ルートは送られず、信頼ストアにある）', () => {
      expect(
        field(
          messages(steps).find((m) => m.id === 'certificate'),
          'certificate_list',
        ),
      ).toBe('www.example.com\nExample Intermediate CA')
      expect(checks(steps)).toEqual({
        'www.example.com': ['✓', '✓', '✓', '-'],
        'Example Intermediate CA': ['✓', '✓', '-', '-'],
        'Example Root CA': ['-', '✓', '-', '✓'],
      })
    })
  })

  describe('証明書の問題（RFC 5280 §6、RFC 8446 §6.2）', () => {
    it.each([
      ['expired', 'certificate_expired (45)'],
      ['nameMismatch', 'certificate_unknown (46)'],
      ['unknownCa', 'unknown_ca (48)'],
      ['missingIntermediate', 'unknown_ca (48)'],
    ] as const)('%s: クライアントは暗号化されたアラート %s を送って中断する', (problem, alert) => {
      const steps = build(problem)
      const all = messages(steps)
      expect(all.map((m) => m.label)).toEqual([
        'ClientHello',
        'ServerHello',
        'EncryptedExtensions',
        'Certificate',
        `Alert: ${alert.replace(/ \(\d+\)$/, '')}`,
      ])
      expect(all.find((m) => m.id === 'certificate')?.status).toBe('rejected')
      const alertMessage = all.at(-1)
      expect(alertMessage?.encrypted).toBe(true)
      expect(field(alertMessage, 'AlertDescription')).toBe(alert)
      const final = stateAt(steps, steps.length - 1)
      expect(final.client?.state).toBe('CLOSED')
      expect(final.server?.state).toBe('CLOSED')
      expect(final.client?.alert).toBe(alert.replace(/ \(\d+\)$/, ''))
    })

    it('期限切れはサーバー証明書の有効期限だけが不合格', () => {
      expect(checks(build('expired'))['www.example.com']).toEqual(['✓', '✗', '✓', '-'])
    })

    it('名前の不一致はサーバー証明書の名前だけが不合格', () => {
      expect(checks(build('nameMismatch'))['www.example.com']).toEqual(['✓', '✓', '✗', '-'])
    })

    it('未知の CA はルートの信頼だけが不合格', () => {
      expect(checks(build('unknownCa'))['Unknown Root CA']).toEqual(['-', '✓', '-', '✗'])
    })

    it('中間証明書の欠落は、送られた証明書が 1 枚で、サーバー証明書の署名を確かめられない', () => {
      const steps = build('missingIntermediate')
      expect(
        field(
          messages(steps).find((m) => m.id === 'certificate'),
          'certificate_list',
        ),
      ).toBe('www.example.com')
      expect(checks(steps)['www.example.com']).toEqual(['✗', '✓', '✓', '-'])
    })

    it('検証の前は、受け取った証明書の結果は未確認', () => {
      const steps = build('expired')
      const index = steps.findIndex((step) => step.id === 'certificate')
      const chain = stateAt(steps, index).client?.certChain
      expect(
        typeof chain === 'object' ? chain.rows.map((row) => row.slice(4).join('')) : [],
      ).toEqual(['----', '----', '----'])
    })
  })
})
