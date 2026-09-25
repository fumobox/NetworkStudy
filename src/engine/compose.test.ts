// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { composeScenarios, type ComposedActorDef } from './compose'
import { deriveState } from './derive'
import { toScenarioHandle } from './scenario'
import type { Actor, Scenario, Step } from './types'
import { validateScenario } from './validate'

const text = (en: string) => ({ en, ja: `${en}（ja）` })

// 名前解決のパート: stub → resolver。クライアントの id は stub
const lookupSchema = z.object({ cached: z.stringbool().catch(false) })
const lookupActors: readonly Actor[] = [
  {
    id: 'stub',
    kind: 'client',
    name: text('Stub'),
    stateSlots: [{ key: 'state', label: text('Lookup state'), initial: 'idle' }],
  },
  { id: 'resolver', kind: 'resolver', name: text('Resolver'), stateSlots: [] },
]
const lookup: Scenario<z.infer<typeof lookupSchema>> = {
  id: 'lookup',
  title: text('Lookup'),
  actors: lookupActors,
  optionDefs: { cached: { kind: 'toggle', label: text('Cached'), defaultValue: false } },
  parseOptions: (raw) => lookupSchema.parse(raw),
  buildSteps: (options): Step[] => [
    {
      id: 'query',
      title: text('Query'),
      description: text('Ask the resolver'),
      section: text('Lookup section'),
      events: [
        { kind: 'stateChange', actorId: 'stub', key: 'state', value: 'waiting' },
        {
          kind: 'message',
          message: {
            id: 'q',
            from: 'stub',
            to: 'resolver',
            label: 'Q',
            status: 'delivered',
            fields: [],
          },
        },
      ],
    },
    {
      id: 'answer',
      title: text('Answer'),
      description: text(options.cached ? 'From cache' : 'Resolved'),
      events: [
        { kind: 'stateChange', actorId: 'stub', key: 'state', value: 'done' },
        {
          kind: 'message',
          message: {
            id: 'a',
            from: 'resolver',
            to: 'stub',
            label: 'A',
            status: 'delivered',
            fields: [],
          },
        },
      ],
    },
  ],
}

// 接続のパート: client → server。SYN のロスと再送、タイマー
const connectSchema = z.object({
  loss: z.enum(['none', 'once']).catch('none'),
  port: z.enum(['open', 'closed']).catch('open'),
})
const connect: Scenario<z.infer<typeof connectSchema>> = {
  id: 'connect',
  title: text('Connect'),
  actors: [
    {
      id: 'client',
      kind: 'client',
      name: text('Client'),
      stateSlots: [{ key: 'state', label: text('TCP state'), initial: 'CLOSED' }],
    },
    { id: 'server', kind: 'server', name: text('Server'), stateSlots: [] },
  ],
  optionDefs: {
    loss: {
      kind: 'select',
      label: text('Loss'),
      choices: [
        { value: 'none', label: text('None') },
        { value: 'once', label: text('Once') },
      ],
      defaultValue: 'none',
    },
    port: {
      kind: 'select',
      label: text('Port'),
      choices: [
        { value: 'open', label: text('Open') },
        { value: 'closed', label: text('Closed') },
      ],
      defaultValue: 'open',
    },
  },
  parseOptions: (raw) => connectSchema.parse(raw),
  buildSteps: (options): Step[] => [
    {
      id: 'syn',
      title: text('SYN'),
      description: text('Send SYN'),
      events: [
        { kind: 'stateChange', actorId: 'client', key: 'state', value: 'SYN-SENT' },
        {
          kind: 'message',
          message: {
            id: 'syn',
            from: 'client',
            to: 'server',
            label: 'SYN',
            status: options.loss === 'once' ? 'lost' : 'delivered',
            fields: [],
          },
        },
      ],
    },
    ...(options.loss === 'once'
      ? [
          {
            id: 'syn-rtx',
            title: text('Retransmit'),
            description: text('RTO expired'),
            events: [
              { kind: 'timer', actorId: 'client', name: 'RTO', durationMs: 1000 },
              {
                kind: 'message',
                message: {
                  id: 'syn-rtx',
                  from: 'client',
                  to: 'server',
                  label: 'SYN',
                  status: 'delivered',
                  retransmitOf: 'syn',
                  fields: [],
                },
              },
            ],
          } satisfies Step,
        ]
      : []),
    {
      id: 'done',
      title: text('Done'),
      description: text(options.port === 'open' ? 'Connected' : 'Reset'),
      events: [
        {
          kind: 'stateChange',
          actorId: 'client',
          key: 'state',
          value: options.port === 'open' ? 'ESTABLISHED' : 'CLOSED',
        },
      ],
    },
  ],
}

const actors: readonly ComposedActorDef[] = [
  { id: 'client', kind: 'client', name: text('Browser') },
  { id: 'resolver', kind: 'resolver', name: text('Resolver') },
  { id: 'server', kind: 'server', name: text('Server') },
]

function compose(
  connectPart: { expose?: readonly string[]; pinned?: Record<string, string> } = {},
) {
  return composeScenarios({
    id: 'overview',
    title: text('Overview'),
    actors,
    parts: [
      {
        prefix: 'dns',
        handle: toScenarioHandle(lookup),
        actorMap: { stub: 'client' },
        section: text('1. Lookup'),
      },
      { prefix: 'tcp', handle: toScenarioHandle(connect), ...connectPart },
    ],
  })
}

describe('composeScenarios', () => {
  it('ステップを順につなげ、id に接頭辞を付ける', () => {
    const { steps } = compose().resolve({})
    expect(steps.map((step) => step.id)).toEqual(['dns.query', 'dns.answer', 'tcp.syn', 'tcp.done'])
  })

  it('アクターを寄せ、状態の枠を寄せた先のアクターに集める（同じキーでも衝突しない）', () => {
    const handle = compose()
    expect(
      handle.actors.map((actor) => [actor.id, actor.stateSlots.map((slot) => slot.key)]),
    ).toEqual([
      ['client', ['dns.state', 'tcp.state']],
      ['resolver', []],
      ['server', []],
    ])
    const { steps } = handle.resolve({})
    const derived = deriveState(handle.actors, steps, steps.length - 1)
    expect(derived.actorStates.client?.values).toEqual({
      'dns.state': 'done',
      'tcp.state': 'ESTABLISHED',
    })
    // stub のメッセージは client から送られる
    expect(derived.messages.map((message) => [message.id, message.from, message.to])).toEqual([
      ['dns.q', 'client', 'resolver'],
      ['dns.a', 'resolver', 'client'],
      ['tcp.syn', 'client', 'server'],
    ])
  })

  it('パートの帯を指定すると上書きし、指定しなければ元のまま', () => {
    const { steps } = compose().resolve({})
    expect(steps.map((step) => step.section?.en)).toEqual([
      '1. Lookup',
      '1. Lookup',
      undefined,
      undefined,
    ])
  })

  it('既定ではオプションを出さず、URL の値も無視する', () => {
    const handle = compose()
    expect(handle.optionDefs).toEqual({})
    const resolved = handle.resolve({ 'tcp.loss': 'once', 'dns.cached': '1' })
    expect(resolved.options).toEqual({})
    expect(resolved.steps.map((step) => step.id)).toEqual([
      'dns.query',
      'dns.answer',
      'tcp.syn',
      'tcp.done',
    ])
  })

  it('expose したオプションはフォームに出し、URL の値をパートに渡す。再送の参照も付け替える', () => {
    const handle = compose({ expose: ['loss'] })
    expect(Object.keys(handle.optionDefs)).toEqual(['tcp.loss'])
    const resolved = handle.resolve({ 'tcp.loss': 'once', 'tcp.port': 'closed' })
    expect(resolved.options).toEqual({ 'tcp.loss': 'once' })
    const retransmission = resolved.steps
      .flatMap((step) => step.events)
      .flatMap((event) => (event.kind === 'message' ? [event.message] : []))
      .find((message) => message.id === 'tcp.syn-rtx')
    expect(retransmission?.retransmitOf).toBe('tcp.syn')
    // port は expose していないので、URL の closed は無視して既定の open のまま
    expect(resolved.steps.at(-1)?.description.en).toBe('Connected')
  })

  it('pinned の値は URL より優先する', () => {
    const handle = compose({ expose: ['loss'], pinned: { port: 'closed', loss: 'none' } })
    const resolved = handle.resolve({ 'tcp.loss': 'once' })
    expect(resolved.options).toEqual({ 'tcp.loss': 'none' })
    expect(resolved.steps.at(-1)?.description.en).toBe('Reset')
  })

  it('合成したシナリオは validateScenario を通る（オプションを出した場合も）', () => {
    expect(validateScenario(compose())).toEqual([])
    expect(validateScenario(compose({ expose: ['loss', 'port'] }))).toEqual([])
  })

  it('定義の誤りは例外にする', () => {
    const lookupHandle = toScenarioHandle(lookup)
    const base = { id: 'x', title: text('X'), actors }
    expect(() =>
      composeScenarios({ ...base, parts: [{ prefix: 'dns', handle: lookupHandle }] }),
    ).toThrow(/actor "stub" of part "dns" maps to unknown actor "stub"/)
    expect(() =>
      composeScenarios({
        ...base,
        parts: [
          { prefix: 'a', handle: lookupHandle, actorMap: { stub: 'client' } },
          { prefix: 'a', handle: lookupHandle, actorMap: { stub: 'client' } },
        ],
      }),
    ).toThrow(/duplicated prefix "a"/)
    expect(() =>
      composeScenarios({
        ...base,
        parts: [{ prefix: 'DNS.x', handle: lookupHandle, actorMap: { stub: 'client' } }],
      }),
    ).toThrow(/invalid or duplicated prefix/)
    expect(() =>
      composeScenarios({
        ...base,
        parts: [
          { prefix: 'dns', handle: lookupHandle, actorMap: { stub: 'client' }, expose: ['nope'] },
        ],
      }),
    ).toThrow(/has no option "nope"/)
  })
})
