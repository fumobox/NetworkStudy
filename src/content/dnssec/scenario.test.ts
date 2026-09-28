// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, StateValue, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { dnssecScenario, FORGED_ADDRESS, WWW_ADDRESS, type DnssecOptions } from './scenario'

const handle = toScenarioHandle(dnssecScenario)
const defaults: DnssecOptions = { zone: 'signed', cd: false }
const ZONES = ['signed', 'unsigned', 'tampered', 'expired'] as const

function build(overrides: Partial<DnssecOptions> = {}): readonly Step[] {
  return dnssecScenario.buildSteps({ ...defaults, ...overrides })
}

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}

function flow(steps: readonly Step[]) {
  return messages(steps).map((m) => `${m.from}→${m.to} ${m.label} ${m.status}`)
}

function field(message: Message | undefined, name: string): string | undefined {
  return message?.fields.find((candidate) => candidate.name === name)?.value
}

function stateAt(steps: readonly Step[], stepId: string) {
  const index = steps.findIndex((step) => step.id === stepId)
  const state = deriveState(dnssecScenario.actors, steps, index).actorStates
  const rows = (value: StateValue | undefined) => (typeof value === 'object' ? value.rows : null)
  return {
    chain: rows(state.resolver?.values.chain),
    answer: state.resolver?.values.answer,
    result: state.stub?.values.result,
  }
}

const final = (steps: readonly Step[]) => stateAt(steps, 'stub-answer')
const stubAnswer = (steps: readonly Step[]) => messages(steps).find((m) => m.id === 'stub-answer')

describe('dnssecScenario', () => {
  it('すべてのオプションの組み合わせ（8 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ zone: 'expired', cd: 'true' }).options).toEqual({
      zone: 'expired',
      cd: true,
    })
    expect(handle.resolve({ zone: 'broken', cd: '?' }).options).toEqual(defaults)
  })

  describe('信頼の連鎖（RFC 4035 §5）', () => {
    it('ルート → com. → example.com. の順に、委任と DNSKEY を取り、AD 付きで答える', () => {
      expect(flow(build())).toEqual([
        'stub→resolver Query A www.example.com delivered',
        'resolver→root Query A www.example.com (DO) delivered',
        'root→resolver Referral: com. NS + DS delivered',
        'resolver→root Query DNSKEY . (DO) delivered',
        'root→resolver DNSKEY . (KSK 1001, ZSK 1002) delivered',
        'resolver→tld Query A www.example.com (DO) delivered',
        'tld→resolver Referral: example.com. NS + DS delivered',
        'resolver→tld Query DNSKEY com. (DO) delivered',
        'tld→resolver DNSKEY com. (KSK 2001, ZSK 2002) delivered',
        'resolver→auth Query A www.example.com (DO) delivered',
        'auth→resolver Answer: A 192.0.2.10 + RRSIG delivered',
        'resolver→auth Query DNSKEY example.com. (DO) delivered',
        'auth→resolver DNSKEY example.com. (KSK 3001, ZSK 3002) delivered',
        'resolver→stub Answer: A 192.0.2.10 (AD) delivered',
      ])
    })

    it('DS は親のゾーンの委任に入り、子の DNSKEY で確かめられる', () => {
      const steps = build()
      expect(
        field(
          messages(steps).find((m) => m.id === 'root-referral'),
          'Authority',
        ),
      ).toContain('com. DS 2001 13 2')
      expect(stateAt(steps, 'root').chain).toEqual([
        ['.', 'trust anchor (KSK 1001)', '-', 'pending'],
        ['com.', 'DS 2001 (from .)', '-', 'DS pending'],
      ])
      expect(stateAt(steps, 'root-keys').chain).toEqual([
        ['.', 'trust anchor (KSK 1001)', 'KSK 1001, ZSK 1002', 'Secure'],
        ['com.', 'DS 2001 (from .)', '-', 'DS verified'],
      ])
      expect(stateAt(steps, 'auth-keys')).toMatchObject({
        chain: [
          ['.', 'trust anchor (KSK 1001)', 'KSK 1001, ZSK 1002', 'Secure'],
          ['com.', 'DS 2001 (from .)', 'KSK 2001, ZSK 2002', 'Secure'],
          ['example.com.', 'DS 3001 (from com.)', 'KSK 3001, ZSK 3002', 'Secure'],
        ],
        answer: 'Secure',
      })
    })

    it('上流への問い合わせには DO と CD を立て、RRSIG は KSK が DNSKEY に、ZSK が A に署名する', () => {
      const all = messages(build())
      for (const m of all.filter((x) => x.from === 'resolver' && x.to !== 'stub')) {
        expect([field(m, 'Flags'), field(m, 'EDNS')]).toEqual(['CD', 'OPT, DO=1'])
      }
      expect(
        field(
          all.find((m) => m.id === 'auth-keys'),
          'Answer',
        ),
      ).toContain('RRSIG DNSKEY 13 2 3600 20261015000000 20260925000000 3001 example.com.')
      expect(
        field(
          all.find((m) => m.id === 'auth-answer'),
          'Answer',
        ),
      ).toContain('RRSIG A 13 3 300 20261015000000 20260925000000 3002 example.com.')
    })

    it('AD は、問い合わせに AD があるときに立てる', () => {
      const steps = build()
      expect(
        field(
          messages(steps).find((m) => m.id === 'stub-query'),
          'Flags',
        ),
      ).toBe('RD AD')
      expect(field(stubAnswer(steps), 'Flags')).toBe('QR RD RA AD')
      expect(final(steps).result).toBe(`${WWW_ADDRESS} (AD)`)
    })
  })

  describe('もしも', () => {
    it('署名のないゾーン: DS がないことを NSEC3 で証明し、Insecure で AD なしに答える', () => {
      const steps = build({ zone: 'unsigned' })
      expect(steps.some((step) => step.id === 'auth-keys')).toBe(false)
      expect(
        field(
          messages(steps).find((m) => m.id === 'tld-referral'),
          'Authority',
        ),
      ).toContain('NSEC3')
      expect(stateAt(steps, 'tld-keys').chain?.[2]).toEqual([
        'example.com.',
        'no DS (NSEC3, Opt-Out)',
        '-',
        'Insecure',
      ])
      expect(final(steps)).toMatchObject({ answer: 'Insecure', result: `${WWW_ADDRESS} (no AD)` })
      expect(field(stubAnswer(steps), 'Flags')).toBe('QR RD RA')
    })

    it('書き換えられた答えと期限切れの署名: Bogus で SERVFAIL（NXDOMAIN ではない）', () => {
      for (const zone of ['tampered', 'expired'] as const) {
        const steps = build({ zone })
        expect(final(steps)).toMatchObject({ result: 'SERVFAIL' })
        expect(field(stubAnswer(steps), 'RCODE')).toBe('SERVFAIL')
        expect(stateAt(steps, 'auth-keys').chain?.[2]?.[3]).toBe('Bogus')
      }
      expect(final(build({ zone: 'tampered' })).answer).toBe('Bogus (signature invalid)')
      expect(final(build({ zone: 'expired' })).answer).toBe('Bogus (RRSIG expired)')
      expect(
        field(
          messages(build({ zone: 'tampered' })).find((m) => m.id === 'auth-answer'),
          'Answer',
        ),
      ).toContain(`A ${FORGED_ADDRESS}`)
      expect(
        field(
          messages(build({ zone: 'expired' })).find((m) => m.id === 'auth-answer'),
          'Answer',
        ),
      ).toContain('20260920000000')
      expect(
        field(
          messages(build({ zone: 'expired' })).find((m) => m.id === 'auth-keys'),
          'Answer',
        ),
      ).toContain('RRSIG DNSKEY 13 2 3600 20260920000000 20260830000000 3001 example.com.')
    })

    it('CD: 検証に失敗したデータも AD なしで返す。検証できたときの答えは変わらない', () => {
      const tampered = build({ zone: 'tampered', cd: true })
      expect(final(tampered).result).toBe(`${FORGED_ADDRESS} (CD, no AD)`)
      expect(field(stubAnswer(tampered), 'Flags')).toBe('QR RD RA CD')
      expect(messages(tampered).filter((m) => m.status === 'rejected')).toEqual([])
      expect(final(build({ cd: true })).result).toBe(final(build()).result)
      const signedCd = build({ cd: true })
      expect(field(stubAnswer(signedCd), 'Flags')).toBe('QR RD RA AD CD')
      expect(field(stubAnswer(signedCd), 'Answer')).toContain('RRSIG A')
      expect(
        field(
          messages(signedCd).find((m) => m.id === 'stub-query'),
          'EDNS',
        ),
      ).toBe('OPT, DO=1')
      expect(final(build({ zone: 'unsigned', cd: true })).result).toBe(`${WWW_ADDRESS} (no AD)`)
    })

    it('rejected は、CD なしで検証に失敗するメッセージだけ', () => {
      for (const zone of ZONES) {
        for (const cd of [false, true]) {
          const rejected = messages(build({ zone, cd }))
            .filter((m) => m.status === 'rejected')
            .map((m) => m.id)
          const expected =
            cd || zone === 'signed' || zone === 'unsigned'
              ? []
              : zone === 'tampered'
                ? ['auth-answer']
                : ['auth-answer', 'auth-keys']
          expect(rejected).toEqual(expected)
        }
      }
    })

    it('DNSSEC は暗号化しない', () => {
      for (const zone of ZONES) {
        expect(messages(build({ zone })).some((m) => m.encrypted === true)).toBe(false)
      }
    })
  })

  it('ラベルは短い', () => {
    for (const zone of ZONES) {
      for (const cd of [false, true]) {
        expect(
          Math.max(...messages(build({ zone, cd })).map((m) => m.label.length)),
        ).toBeLessThanOrEqual(40)
      }
    }
  })
})
