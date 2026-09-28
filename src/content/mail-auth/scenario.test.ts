// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { toScenarioHandle } from '@/engine/scenario'
import type { Message, StateValue, Step } from '@/engine/types'
import { validateScenario } from '@/engine/validate'
import { mailAuthScenario, type MailAuthOptions } from './scenario'

const handle = toScenarioHandle(mailAuthScenario)
const defaults: MailAuthOptions = { path: 'direct', policy: 'reject' }
const PATHS = ['direct', 'spoof', 'forward', 'list'] as const
const POLICIES = ['reject', 'quarantine', 'none'] as const

function build(overrides: Partial<MailAuthOptions> = {}): readonly Step[] {
  return mailAuthScenario.buildSteps({ ...defaults, ...overrides })
}

function messages(steps: readonly Step[]): Message[] {
  return steps.flatMap((step) =>
    step.events.flatMap((event) => (event.kind === 'message' ? [event.message] : [])),
  )
}

function flow(steps: readonly Step[]) {
  return messages(steps).map((m) => `${m.from}→${m.to} ${m.label}`)
}

function field(message: Message | undefined, name: string): string | undefined {
  return message?.fields.find((candidate) => candidate.name === name)?.value
}

function final(steps: readonly Step[]) {
  const values = deriveState(mailAuthScenario.actors, steps, steps.length - 1).actorStates.receiver
    ?.values
  const rows = (value: StateValue | undefined) => (typeof value === 'object' ? value.rows : null)
  return {
    identities: rows(values?.identities),
    dmarc: values?.dmarc,
    action: values?.action,
    results: values?.results,
  }
}

const byId = (steps: readonly Step[], id: string) => messages(steps).find((m) => m.id === id)

describe('mailAuthScenario', () => {
  it('すべてのオプションの組み合わせ（12 通り）で整合している', () => {
    expect(validateScenario(handle)).toEqual([])
  })

  it('URL のオプションを検証し、不正な値はデフォルトに戻す', () => {
    expect(handle.resolve({ path: 'list', policy: 'none' }).options).toEqual({
      path: 'list',
      policy: 'none',
    })
    expect(handle.resolve({ path: 'relay', policy: 'drop' }).options).toEqual(defaults)
  })

  describe('直接届くメール', () => {
    it('SPF → DKIM → DMARC の順に DNS を引き、250 で受け入れる', () => {
      expect(flow(build())).toEqual([
        'sender→receiver MAIL FROM:<alice@example.com>',
        'receiver→dns Query TXT example.com',
        'dns→receiver TXT: v=spf1 ip4:192.0.2.25 -all',
        'sender→receiver DATA: From: alice@example.com',
        'receiver→dns Query TXT s1._domainkey.example.com',
        'dns→receiver TXT: v=DKIM1; k=rsa; p=MIIBIjANBg…',
        'receiver→dns Query TXT _dmarc.example.com',
        'dns→receiver TXT: v=DMARC1; p=reject',
        'receiver→sender 250 2.0.0 OK',
      ])
    })

    it('SPF は MAIL FROM のドメイン、DKIM は d= の鍵、DMARC は From のドメインを使う', () => {
      const steps = build()
      expect(field(byId(steps, 'envelope'), 'MAIL FROM')).toBe('<alice@example.com>')
      expect(field(byId(steps, 'data'), 'DKIM-Signature')).toContain('d=example.com; s=s1')
      expect(field(byId(steps, 'data'), 'DKIM-Signature')).toContain('h=from:')
      expect(final(steps)).toEqual({
        identities: [
          ['SPF (MAIL FROM)', 'example.com', 'pass', 'yes'],
          ['DKIM (d=)', 'example.com', 'pass', 'yes'],
          ['From (header)', 'example.com', '-', '-'],
        ],
        dmarc: 'pass',
        action: 'accept',
        results:
          'spf=pass smtp.mailfrom=example.com; dkim=pass header.d=example.com; dmarc=pass header.from=example.com',
      })
    })

    it('DMARC が pass なら、ポリシー（p=）は結果を変えない', () => {
      for (const path of ['direct', 'forward'] as const) {
        const outcomes = POLICIES.map((policy) => final(build({ path, policy })))
        expect(new Set(outcomes.map((o) => JSON.stringify(o))).size).toBe(1)
      }
    })
  })

  describe('もしも', () => {
    it('なりすまし: SPF は fail、DKIM は none で、DMARC は fail', () => {
      const steps = build({ path: 'spoof' })
      expect(field(byId(steps, 'envelope'), 'Client IP')).toBe('203.0.113.66')
      expect(field(byId(steps, 'data'), 'DKIM-Signature')).toBe('(none)')
      expect(messages(steps).some((m) => m.id === 'dkim-query')).toBe(false)
      expect(final(steps)).toMatchObject({
        identities: [
          ['SPF (MAIL FROM)', 'example.com', 'fail', '-'],
          ['DKIM (d=)', '-', 'none', '-'],
          ['From (header)', 'example.com', '-', '-'],
        ],
        dmarc: 'fail',
      })
    })

    it('転送: エンベロープは変わらず SPF は fail、DKIM は pass のままで DMARC は pass', () => {
      const steps = build({ path: 'forward' })
      expect(flow(steps).slice(0, 3)).toEqual([
        'sender→other MAIL FROM:<alice@example.com>',
        'sender→other DATA: From: alice@example.com',
        'other→receiver MAIL FROM:<alice@example.com>',
      ])
      expect(final(steps)).toMatchObject({
        identities: [
          ['SPF (MAIL FROM)', 'example.com', 'fail', '-'],
          ['DKIM (d=)', 'example.com', 'pass', 'yes'],
          ['From (header)', 'example.com', '-', '-'],
        ],
        dmarc: 'pass',
        action: 'accept',
        results:
          'spf=fail smtp.mailfrom=example.com; dkim=pass header.d=example.com; dmarc=pass header.from=example.com',
      })
    })

    it('メーリングリスト: SPF は example.org で pass だがアラインせず、改変で DKIM は fail', () => {
      const steps = build({ path: 'list' })
      expect(field(byId(steps, 'envelope'), 'MAIL FROM')).toBe('<list-bounces@example.org>')
      expect(byId(steps, 'spf-query')?.label).toBe('Query TXT example.org')
      expect(field(byId(steps, 'data'), 'Subject')).toBe('[team] Invoice for September')
      expect(final(steps)).toMatchObject({
        identities: [
          ['SPF (MAIL FROM)', 'example.org', 'pass', 'no'],
          ['DKIM (d=)', 'example.com', 'fail', '-'],
          ['From (header)', 'example.com', '-', '-'],
        ],
        dmarc: 'fail',
      })
    })

    it('DMARC が fail のときの扱いは p= で決まり、reject は DATA の後の 550 5.7.1', () => {
      for (const path of ['spoof', 'list'] as const) {
        expect(POLICIES.map((policy) => final(build({ path, policy })).action)).toEqual([
          'reject (550 5.7.1)',
          'quarantine',
          'accept (p=none)',
        ])
        const reply = byId(build({ path }), 'reply')
        expect([reply?.from, reply?.to, reply?.label]).toEqual([
          'receiver',
          'other',
          '550 5.7.1 Rejected per DMARC policy',
        ])
        expect(final(build({ path })).results).toBe('-')
        for (const policy of ['quarantine', 'none'] as const) {
          const accepted = byId(build({ path, policy }), 'reply')
          expect([accepted?.to, accepted?.label]).toEqual(['other', '250 2.0.0 OK'])
        }
      }
      expect(final(build({ path: 'spoof', policy: 'none' })).results).toBe(
        'spf=fail smtp.mailfrom=example.com; dkim=none; dmarc=fail header.from=example.com',
      )
      expect(final(build({ path: 'list', policy: 'none' })).results).toBe(
        'spf=pass smtp.mailfrom=example.org; dkim=fail header.d=example.com; dmarc=fail header.from=example.com',
      )
    })

    it('転送とリストのときだけ、先に example.org に届くステップがある', () => {
      for (const path of PATHS) {
        expect(build({ path }).some((step) => step.id === 'handoff')).toBe(
          path === 'forward' || path === 'list',
        )
      }
    })

    it('DNS のレコードの p= と、転送・リストのときの example.org の SPF', () => {
      const records = (options: Partial<MailAuthOptions>) => {
        const steps = build(options)
        const value = deriveState(mailAuthScenario.actors, steps, 0).actorStates.dns?.values.records
        return typeof value === 'object' ? value.rows.map((row) => row[0]) : null
      }
      expect(records({})).toEqual([
        'example.com',
        's1._domainkey.example.com',
        '_dmarc.example.com',
      ])
      expect(records({ path: 'list' })).toContain('example.org')
      expect(byId(build({ policy: 'none' }), 'dmarc-answer')?.label).toBe('TXT: v=DMARC1; p=none')
      expect(field(byId(build({ policy: 'none' }), 'dmarc-answer'), 'Answer')).toBe(
        'v=DMARC1; p=none; rua=mailto:dmarc@example.com',
      )
    })
  })

  it('ラベルは短い', () => {
    for (const path of PATHS) {
      for (const policy of POLICIES) {
        expect(
          Math.max(...messages(build({ path, policy })).map((m) => m.label.length)),
        ).toBeLessThanOrEqual(40)
      }
    }
  })
})
