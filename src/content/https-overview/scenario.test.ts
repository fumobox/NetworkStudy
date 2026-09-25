// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { validateScenario } from '@/engine/validate'
import { HTTPS_CERT_CHAIN, HTTPS_SECTIONS, httpsOverviewScenario } from './scenario'

const { steps } = httpsOverviewScenario.resolve({})

describe('httpsOverviewScenario', () => {
  it('整合している', () => {
    expect(validateScenario(httpsOverviewScenario)).toEqual([])
  })

  it('What-if は出さない', () => {
    expect(httpsOverviewScenario.optionDefs).toEqual({})
  })

  it('DNS → TCP → TLS → HTTP の順に、パートの名前の帯でつながる', () => {
    const sections = steps.map((step) => step.section?.en)
    expect([...new Set(sections)]).toEqual([
      HTTPS_SECTIONS.dns.en,
      HTTPS_SECTIONS.tcp.en,
      HTTPS_SECTIONS.tls.en,
      HTTPS_SECTIONS.http.en,
    ])
    // パートの接頭辞は dns → tcp → tls → http の順に 1 回ずつ現れる
    const prefixes = steps.map((step) => step.id.slice(0, step.id.indexOf('.')))
    expect([...new Set(prefixes)]).toEqual(['dns', 'tcp', 'tls', 'http'])
    expect(prefixes).toEqual([...prefixes].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)))
  })

  it('DNS の問い合わせはブラウザー（client）から始まり、最後はサーバーの応答で終わる', () => {
    const messages = steps.flatMap((step) =>
      step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
    )
    expect(messages[0]).toMatchObject({ id: 'dns.stub-query', from: 'client', to: 'resolver' })
    expect(messages.at(-1)).toMatchObject({
      id: 'http.response',
      from: 'server',
      to: 'client',
      encrypted: true,
    })
    // 要求（GET /）は TLS のパートの最後で送る
    expect(messages.at(-2)).toMatchObject({ id: 'tls.application-data', from: 'client' })
  })

  it('最後には、名前解決・TCP・TLS の状態がそろってブラウザーに残る', () => {
    const derived = deriveState(httpsOverviewScenario.actors, steps, steps.length - 1)
    const client = derived.actorStates.client?.values
    expect(client?.['tcp.state']).toBe('ESTABLISHED')
    expect(client?.['tls.state']).toBe('CONNECTED')
    expect(client?.['dns.result']).not.toBe('-')
    const chain = client?.[HTTPS_CERT_CHAIN]
    expect(typeof chain === 'object' ? chain.rows.length : 0).toBe(3)
  })
})

const ORDER = ['dns', 'tcp', 'tls', 'http']
