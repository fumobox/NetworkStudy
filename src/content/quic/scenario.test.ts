// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { ackRanges, quicScenario, type QuicOptions } from './scenario'

const handle = toScenarioHandle(quicScenario)
const defaults: QuicOptions = { earlyData: 'none', loss: 'none' }

function build(overrides: Partial<QuicOptions> = {}): readonly Step[] {
  return quicScenario.buildSteps({ ...defaults, ...overrides })
}

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}

/** 各パケットの [from, ラベル, 状態, 暗号化] */
function packets(steps: readonly Step[]) {
  return messages(steps).map((m) => [m.from, m.label, m.status, m.encrypted === true])
}

function clientState(steps: readonly Step[], stepId: string) {
  const index = steps.findIndex((step) => step.id === stepId)
  const values = deriveState(quicScenario.actors, steps, index).actorStates.client?.values
  const table = (key: string) => {
    const value = values?.[key]
    return typeof value === 'object' ? value.rows : null
  }
  return {
    keys: values?.keys,
    handshake: values?.handshake,
    packetNumbers: table('packetNumbers'),
    streams: table('streams'),
  }
}

describe('ackRanges', () => {
  it('空と、並んでいない入力', () => {
    expect(ackRanges([])).toBe('')
    expect(ackRanges([4, 0, 2, 3])).toBe('0, 2-4')
  })

  it('連続した番号をまとめる', () => {
    expect(ackRanges([0, 1, 2])).toBe('0-2')
    expect(ackRanges([0, 2, 3, 4])).toBe('0, 2-4')
    expect(ackRanges([5])).toBe('5')
  })
})

describe('quicScenario', () => {
  it('図のラベルは短くし、フレームの全体はインスペクタの Frames に出す', () => {
    const handshake = messages(build()).find((m) => m.id === 'server-handshake')
    expect(handshake?.label).toBe('Handshake[0]: CRYPTO (… Finished)')
    expect(handshake?.fields.find((f) => f.name === 'Frames')?.value).toBe(
      'CRYPTO (EncryptedExtensions, Certificate, CertificateVerify, Finished)',
    )
    for (const combination of [build(), build({ earlyData: 'accepted', loss: 'stream' })]) {
      expect(Math.max(...messages(combination).map((m) => m.label.length))).toBeLessThanOrEqual(40)
    }
  })

  it('すべてのオプションの組み合わせ（9 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ earlyData: 'rejected', loss: 'stream' }).options).toEqual({
      earlyData: 'rejected',
      loss: 'stream',
    })
    expect(handle.resolve({ earlyData: 'yes', loss: 'all' }).options).toEqual(defaults)
  })

  describe('1-RTT のハンドシェイク（RFC 9000 §7、RFC 9001 §4.1）', () => {
    it('1 往復で要求を送る。Initial だけが暗号化されていない', () => {
      expect(packets(build())).toEqual([
        ['client', 'Initial[0]: CRYPTO (ClientHello)', 'delivered', false],
        ['server', 'Initial[0]: ACK 0, CRYPTO (ServerHello)', 'delivered', false],
        ['server', 'Handshake[0]: CRYPTO (… Finished)', 'delivered', true],
        ['client', 'Initial[1]: ACK 0', 'delivered', false],
        ['client', 'Handshake[0]: ACK 0, CRYPTO (Finished)', 'delivered', true],
        ['client', '1-RTT[0]: STREAM 0, 4 (GET)', 'delivered', true],
        ['server', '1-RTT[0]: HANDSHAKE_DONE, ACK 0', 'delivered', true],
        ['server', '1-RTT[1]: STREAM 0 (200, 1/3)', 'delivered', true],
        ['server', '1-RTT[2]: STREAM 4 (200, FIN)', 'delivered', true],
        ['server', '1-RTT[3]: STREAM 0 (2/3)', 'delivered', true],
        ['server', '1-RTT[4]: STREAM 0 (3/3, FIN)', 'delivered', true],
        ['client', '1-RTT[1]: ACK 0-4', 'delivered', true],
      ])
    })

    it('Initial を運ぶデータグラムは 1,200 バイト以上（RFC 9000 §14.1）', () => {
      const initial = messages(build())[0]
      expect(initial?.fields.find((f) => f.name === 'Datagram size')?.value).toBe('1,200 bytes')
    })

    it('鍵とハンドシェイクの状態: complete のあと HANDSHAKE_DONE で confirmed。Initial の空間は捨てる', () => {
      const steps = build()
      expect(clientState(steps, 'client-initial')).toMatchObject({
        keys: 'Initial',
        handshake: 'in progress',
      })
      expect(clientState(steps, 'client-finished')).toMatchObject({
        keys: 'Handshake, 1-RTT',
        handshake: 'complete',
        packetNumbers: [
          ['Initial', 'discarded'],
          ['Handshake', '0'],
          ['Application', '0'],
        ],
      })
      expect(clientState(steps, 'server-response')).toMatchObject({
        keys: '1-RTT',
        handshake: 'confirmed',
        packetNumbers: [
          ['Initial', 'discarded'],
          ['Handshake', 'discarded'],
          ['Application', '0'],
        ],
      })
    })

    it('DCID はクライアントの最初の Initial だけに示す（Initial の鍵のもと）', () => {
      const withDcid = messages(build()).filter((m) =>
        m.fields.some((f) => f.name === 'Destination Connection ID'),
      )
      expect(withDcid.map((m) => m.id)).toEqual(['client-initial'])
    })

    it('サーバーは Finished を受け取るとハンドシェイクを確定し、Initial と Handshake の鍵を捨てる', () => {
      const steps = build()
      const server = (id: string) => {
        const index = steps.findIndex((step) => step.id === id)
        return deriveState(quicScenario.actors, steps, index).actorStates.server?.values
      }
      expect(server('server-flight')).toMatchObject({
        keys: 'Initial, Handshake, 1-RTT',
        handshake: 'in progress',
      })
      expect(server('client-finished')).toMatchObject({ keys: '1-RTT', handshake: 'confirmed' })
    })

    it('Initial 以外は暗号化され、1-RTT だけが短いヘッダー', () => {
      const header = (m: Message) => m.fields.find((f) => f.name === 'Header')?.value
      for (const m of messages(build({ earlyData: 'accepted' }))) {
        expect(m.encrypted === true).toBe(!m.label.startsWith('Initial'))
        expect(header(m)?.startsWith('short')).toBe(m.label.startsWith('1-RTT'))
      }
    })
  })

  describe('0-RTT（RFC 9001 §4.6）', () => {
    it('受け付けられれば、要求は最初のデータグラムで出ていき、応答は最初の往復で返る', () => {
      const steps = build({ earlyData: 'accepted' })
      const labels = messages(steps).map((m) => m.label)
      expect(labels.slice(0, 2)).toEqual([
        'Initial[0]: CRYPTO (ClientHello)',
        '0-RTT[0]: STREAM 0, 4 (GET)',
      ])
      const flight = steps.find((step) => step.id === 'server-flight')
      const flightLabels = (flight?.events ?? []).flatMap((e) =>
        e.kind === 'message' ? [e.message.label] : [],
      )
      expect(flightLabels).toContain('1-RTT[0]: ACK 0, STREAM 0 (200, 1/3)')
      // クライアントも 0.5-RTT の応答をすぐに確認応答する
      expect(labels).toContain('1-RTT[1]: ACK 0-3')
      // 1-RTT の要求は送らない（0-RTT で送り済み）
      expect(labels.some((label) => label.includes('GET') && label.startsWith('1-RTT'))).toBe(false)
      expect(labels).toContain('1-RTT[4]: HANDSHAKE_DONE, ACK 0')
    })

    it('断られれば 0-RTT のパケットは捨てられ、要求は 1-RTT で送り直す。番号はアプリケーションの空間で続く', () => {
      const steps = build({ earlyData: 'rejected' })
      const zeroRtt = messages(steps).find((m) => m.label.startsWith('0-RTT'))
      expect(zeroRtt?.status).toBe('rejected')
      expect(messages(steps).map((m) => m.label)).toContain('1-RTT[1]: STREAM 0, 4 (GET)')
      expect(clientState(steps, 'server-flight').streams).toEqual([
        ['0', 'GET /', '0-RTT rejected'],
        ['4', 'GET /style.css', '0-RTT rejected'],
      ])
      // 捨てた 0-RTT のパケット（0 番）は確認応答しない
      expect(messages(steps).map((m) => m.label)).toContain('1-RTT[0]: HANDSHAKE_DONE, ACK 1')
    })
  })

  describe('組み合わせ', () => {
    it('0-RTT の受理 + ストリームのロス: 最初の応答のパケット（ACK 付き）が失われ、HANDSHAKE_DONE で ACK をもう一度送る', () => {
      const labels = messages(build({ earlyData: 'accepted', loss: 'stream' })).map((m) => m.label)
      expect(labels).toContain('1-RTT[1]: ACK 1-3')
      expect(labels).toContain('1-RTT[4]: HANDSHAKE_DONE, ACK 0')
      expect(labels.slice(-2)).toEqual(['1-RTT[5]: STREAM 0 (200, 1/3)', '1-RTT[3]: ACK 1-5'])
    })

    it('0-RTT の拒否 + 最初のデータグラムのロス: 送り直した 0-RTT も捨てられ、要求は 1-RTT[2] で送る', () => {
      const steps = build({ earlyData: 'rejected', loss: 'handshake' })
      const retried = messages(steps).find((m) => m.id === 'client-0rtt-rtx')
      expect([retried?.label.slice(0, 8), retried?.status, retried?.retransmitOf]).toEqual([
        '0-RTT[1]',
        'rejected',
        'client-0rtt',
      ])
      const labels = messages(steps).map((m) => m.label)
      expect(labels.some((label) => label.startsWith('1-RTT[2]: STREAM 0'))).toBe(true)
      expect(labels).toContain('1-RTT[0]: HANDSHAKE_DONE, ACK 2')
    })

    it('0-RTT の受理 + 最初のデータグラムのロス: 受け取った 0-RTT[1] を確認応答する', () => {
      const labels = messages(build({ earlyData: 'accepted', loss: 'handshake' })).map(
        (m) => m.label,
      )
      expect(labels).toContain('1-RTT[0]: ACK 1, STREAM 0 (200, 1/3)')
    })
  })

  describe('ロス（RFC 9002）', () => {
    it('最初のデータグラムが失われると、PTO（約 1 秒）のあと新しいパケット番号で ClientHello を送り直す', () => {
      const steps = build({ loss: 'handshake' })
      const [first, second] = messages(steps)
      expect([first?.label, first?.status]).toEqual(['Initial[0]: CRYPTO (ClientHello)', 'lost'])
      expect([second?.label, second?.retransmitOf]).toEqual([
        'Initial[1]: CRYPTO (ClientHello)',
        'client-initial',
      ])
      expect(messages(steps).map((m) => m.label)).toContain(
        'Initial[0]: ACK 1, CRYPTO (ServerHello)',
      )
      expect(deriveState(quicScenario.actors, steps, steps.length - 1).elapsedMs).toBe(999)
    })

    it('ストリーム 0 のパケットが失われても、ストリーム 4 はすぐに閉じる。3 つ後のパケットが確認されてから送り直す', () => {
      const steps = build({ loss: 'stream' })
      expect(clientState(steps, 'server-response').streams).toEqual([
        ['0', 'GET /', '1 packet missing'],
        ['4', 'GET /style.css', 'closed'],
      ])
      const labels = messages(steps).map((m) => m.label)
      expect(labels.slice(-3)).toEqual([
        '1-RTT[1]: ACK 0, 2-4',
        '1-RTT[5]: STREAM 0 (200, 1/3)',
        // 1 番は届かないまま（データは 5 番で送り直した）なので、確認応答にも入らない
        '1-RTT[2]: ACK 0, 2-5',
      ])
      const retransmit = messages(steps).find((m) => m.retransmitOf !== undefined)
      expect(retransmit?.retransmitOf).toBe('response-0-1')
      expect(clientState(steps, 'stream-retransmit').streams).toEqual([
        ['0', 'GET /', 'closed'],
        ['4', 'GET /style.css', 'closed'],
      ])
    })
  })
})
