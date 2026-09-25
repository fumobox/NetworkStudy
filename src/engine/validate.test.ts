// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { toScenarioHandle } from './scenario'
import type { Actor, Scenario, ScenarioHandle, Step } from './types'
import { collectLocalizedTexts, enumerateOptionCombinations, validateScenario } from './validate'

const text = (en: string) => ({ en, ja: `${en}（ja）` })

const schema = z.object({
  lost: z.stringbool().catch(false),
  port: z.enum(['open', 'closed']).catch('open'),
})
type Options = z.infer<typeof schema>

const actors: readonly Actor[] = [
  {
    id: 'client',
    kind: 'client',
    name: text('Client'),
    stateSlots: [{ key: 'state', label: text('State'), initial: 'CLOSED' }],
  },
  { id: 'server', kind: 'server', name: text('Server'), stateSlots: [] },
]

function buildSteps(options: Options): Step[] {
  const steps: Step[] = [
    {
      id: 'syn',
      title: text('SYN'),
      description: text('Send SYN'),
      events: [
        { kind: 'stateChange', actorId: 'client', key: 'state', value: 'SYN_SENT' },
        {
          kind: 'message',
          message: {
            id: 'syn',
            from: 'client',
            to: 'server',
            label: 'SYN',
            status: options.lost ? 'lost' : 'delivered',
            fields: [{ name: 'Seq', value: '1000', description: text('Sequence number') }],
          },
        },
      ],
    },
  ]
  if (options.port === 'closed') {
    steps.push({
      id: 'rst',
      title: text('RST'),
      description: text('Reset'),
      events: [
        {
          kind: 'message',
          message: {
            id: 'rst',
            from: 'server',
            to: 'client',
            label: 'RST',
            status: 'delivered',
            fields: [],
          },
        },
      ],
    })
  }
  return steps
}

const base: Scenario<Options> = {
  id: 'fixture',
  title: text('Fixture'),
  actors,
  optionDefs: {
    lost: { kind: 'toggle', label: text('Lose SYN'), defaultValue: false },
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
  parseOptions: (raw) => schema.parse(raw),
  buildSteps,
}

function withSteps(build: (options: Options) => Step[]): ScenarioHandle {
  return toScenarioHandle({ ...base, buildSteps: build })
}

/** 型では作れない不整合（choices にない値など）を試すため、TOptions を消した handle を上書きする */
function handleWith(overrides: Partial<ScenarioHandle>): ScenarioHandle {
  return { ...toScenarioHandle(base), ...overrides }
}

function messagesOf(problems: readonly { message: string }[]): string[] {
  return problems.map((problem) => problem.message)
}

describe('toScenarioHandle', () => {
  it('URL の値を検証してからステップを組み立てる', () => {
    const handle = toScenarioHandle(base)
    expect(handle.resolve({}).options).toEqual({ lost: false, port: 'open' })
    expect(handle.resolve({ lost: '1', port: 'closed' }).steps.map((s) => s.id)).toEqual([
      'syn',
      'rst',
    ])
    expect(handle.resolve({ lost: 'maybe', port: 'weird' }).options).toEqual({
      lost: false,
      port: 'open',
    })
  })
})

describe('enumerateOptionCombinations', () => {
  it('toggle と select の全組み合わせを列挙する', () => {
    expect(enumerateOptionCombinations(toScenarioHandle(base))).toEqual([
      { lost: '1', port: 'open' },
      { lost: '1', port: 'closed' },
      { lost: '0', port: 'open' },
      { lost: '0', port: 'closed' },
    ])
  })
})

describe('validateScenario', () => {
  it('整合したシナリオでは問題なし', () => {
    expect(validateScenario(toScenarioHandle(base))).toEqual([])
  })

  it('ID の重複を検出する', () => {
    const handle = withSteps((options) => {
      const [first] = buildSteps(options)
      return first === undefined ? [] : [first, first]
    })
    expect(messagesOf(validateScenario(handle))).toEqual(
      expect.arrayContaining(['duplicate step id "syn"', 'duplicate message id "syn"']),
    )
    expect(
      messagesOf(
        validateScenario(toScenarioHandle({ ...base, actors: [...actors, ...actors.slice(0, 1)] })),
      ),
    ).toContain('duplicate actor id "client"')
  })

  it('特定のオプションの組み合わせでだけ起きる問題も検出する', () => {
    const handle = withSteps((options) =>
      buildSteps(options).map((step) =>
        step.id === 'rst'
          ? { ...step, events: [{ kind: 'timer', actorId: 'ghost', name: 'RTO', durationMs: 1 }] }
          : step,
      ),
    )
    const problems = validateScenario(handle)
    expect(problems.map((p) => p.path)).toEqual([
      'options(lost=1&port=closed).steps[1].events[0]',
      'options(lost=0&port=closed).steps[1].events[0]',
    ])
  })

  it('メッセージの参照（アクター、自分宛て、再送元）を検査する', () => {
    const handle = withSteps(() => [
      {
        id: 's',
        title: text('s'),
        description: text('s'),
        events: [
          {
            kind: 'message',
            message: {
              id: 'a',
              from: 'client',
              to: 'nobody',
              label: 'X',
              status: 'delivered',
              fields: [],
            },
          },
          {
            kind: 'message',
            message: {
              id: 'b',
              from: 'client',
              to: 'client',
              label: 'X',
              status: 'delivered',
              fields: [],
            },
          },
          {
            kind: 'message',
            message: {
              id: 'c',
              from: 'client',
              to: 'server',
              label: 'X',
              status: 'delivered',
              fields: [],
              retransmitOf: 'd',
            },
          },
          {
            kind: 'message',
            message: {
              id: 'd',
              from: 'client',
              to: 'server',
              label: 'X',
              status: 'delivered',
              fields: [],
            },
          },
        ],
      },
    ])
    expect(messagesOf(validateScenario(handle))).toEqual(
      expect.arrayContaining([
        'unknown actor "nobody"',
        'message is sent to its sender',
        'retransmitOf "d" does not refer to an earlier message',
      ]),
    )
  })

  it('状態の変更（未宣言のキー、スカラーと表の不一致、表の形）を検査する', () => {
    const handle = withSteps(() => [
      {
        id: 's',
        title: text('s'),
        description: text('s'),
        events: [
          { kind: 'stateChange', actorId: 'client', key: 'nope', value: 'x' },
          {
            kind: 'stateChange',
            actorId: 'client',
            key: 'state',
            value: { columns: ['A'], rows: [['1', '2']] },
          },
        ],
      },
    ])
    expect(messagesOf(validateScenario(handle))).toEqual(
      expect.arrayContaining([
        'state key "nope" is not declared for actor "client"',
        'state "state" must be a scalar',
        'row has 2 cells but table has 1 columns',
      ]),
    )
  })

  it('ステップがないシナリオを検出する', () => {
    expect(messagesOf(validateScenario(withSteps(() => [])))).toContain('scenario has no steps')
  })

  it('optionDefs と zod スキーマのずれを検出する', () => {
    const handle = toScenarioHandle({
      ...base,
      optionDefs: { ...base.optionDefs, lost: { ...base.optionDefs.lost, defaultValue: true } },
    })
    expect(messagesOf(validateScenario(handle))).toContain(
      'parseOptions({}) gives false but defaultValue is true',
    )
  })

  it('空の翻訳や仮置きの文言を検出する', () => {
    const handle = toScenarioHandle({ ...base, title: { en: 'Fixture', ja: '' } })
    expect(validateScenario(handle)).toContainEqual({ path: 'title.ja', message: 'text is empty' })
    const todo = withSteps((options) =>
      buildSteps(options).map((step) => ({ ...step, description: { en: 'TODO', ja: '説明' } })),
    )
    expect(messagesOf(validateScenario(todo))).toContain('text contains a placeholder')
  })
})

describe('validateScenario: オプション', () => {
  const lostDef = base.optionDefs.lost
  const portDef = base.optionDefs.port

  it('select の defaultValue が choices にない・choices の重複を検出する', () => {
    const handle = handleWith({
      optionDefs: {
        lost: lostDef,
        port: {
          ...portDef,
          choices: [
            { value: 'closed', label: text('Closed') },
            { value: 'closed', label: text('Closed again') },
          ],
        },
      },
    })
    expect(messagesOf(validateScenario(handle))).toEqual(
      expect.arrayContaining([
        'defaultValue "open" is not one of the choices',
        'duplicate choice "closed"',
      ]),
    )
  })

  it('parseOptions が例外を投げても validateScenario は落ちずに問題として報告する', () => {
    const strict = z.object({ lost: z.stringbool(), port: z.enum(['open', 'closed']) })
    const handle = toScenarioHandle({ ...base, parseOptions: (raw) => strict.parse(raw) })
    const problems = validateScenario(handle)
    expect(problems.length).toBeGreaterThan(0)
    expect(
      problems.every(
        (p) => p.message.startsWith('resolve threw:') || p.path.startsWith('optionDefs'),
      ),
    ).toBe(true)
  })

  it('不正な値がデフォルトに戻らないことを検出する', () => {
    const noCatch = z.object({
      lost: z.stringbool().catch(true),
      port: z.enum(['open', 'closed']).catch('open'),
    })
    const handle = toScenarioHandle({
      ...base,
      parseOptions: (raw) => ({
        ...noCatch.parse(raw),
        lost: raw.lost === undefined ? false : noCatch.parse(raw).lost,
      }),
    })
    expect(messagesOf(validateScenario(handle))).toContain(
      'an invalid value gives true instead of falling back to defaultValue',
    )
  })

  it('select の choice が zod で受け付けられないことを検出する', () => {
    const handle = handleWith({
      optionDefs: {
        lost: lostDef,
        port: {
          ...portDef,
          choices: [...portDef.choices, { value: 'filtered', label: text('Filtered') }],
        },
      },
    })
    expect(messagesOf(validateScenario(handle))).toContain(
      'parseOptions({ port: "filtered" }) gives "open", expected "filtered"',
    )
  })

  it('toggle の 1 / 0 が true / false にならないことを検出する', () => {
    const inverted = z.object({
      lost: z
        .string()
        .transform((v) => v === '0')
        .catch(false),
      port: z.enum(['open', 'closed']).catch('open'),
    })
    const handle = toScenarioHandle({ ...base, parseOptions: (raw) => inverted.parse(raw) })
    expect(messagesOf(validateScenario(handle))).toEqual(
      expect.arrayContaining([
        'parseOptions({ lost: "1" }) gives false, expected true',
        'parseOptions({ lost: "0" }) gives true, expected false',
      ]),
    )
  })

  it('parseOptions が返すのに optionDefs にないキーを検出する', () => {
    const handle: ScenarioHandle = {
      ...toScenarioHandle(base),
      resolve: (raw) => {
        const resolved = toScenarioHandle(base).resolve(raw)
        return { ...resolved, options: { ...resolved.options, extra: true } }
      },
    }
    expect(validateScenario(handle)).toContainEqual({
      path: 'optionDefs.extra',
      message: 'option is returned by parseOptions but not declared in optionDefs',
    })
  })
})

describe('validateScenario: ステップ・状態', () => {
  const single = (events: Step['events']): ScenarioHandle =>
    withSteps(() => [{ id: 's', title: text('s'), description: text('s'), events }])

  it.each([[-1], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    'durationMs %d を検出する',
    (durationMs) => {
      const handle = single([{ kind: 'timer', actorId: 'client', name: 'RTO', durationMs }])
      expect(messagesOf(validateScenario(handle))).toContain(
        'durationMs must be a finite number >= 0',
      )
    },
  )

  it('空の step id・message id・state key を検出する', () => {
    const handle = toScenarioHandle({
      ...base,
      actors: [
        {
          id: 'client',
          kind: 'client',
          name: text('C'),
          stateSlots: [{ key: '', label: text('x'), initial: '-' }],
        },
        { id: 'server', kind: 'server', name: text('Server'), stateSlots: [] },
      ],
      buildSteps: () => [
        {
          id: '',
          title: text('s'),
          description: text('s'),
          events: [
            {
              kind: 'message',
              message: {
                id: '',
                from: 'client',
                to: 'server',
                label: 'X',
                status: 'delivered',
                fields: [],
              },
            },
          ],
        },
      ],
    })
    expect(messagesOf(validateScenario(handle))).toEqual(
      expect.arrayContaining(['step id is empty', 'message id is empty', 'state key is empty']),
    )
  })

  it('表の列が初期値と変わったこと・状態の枠の重複や初期値の表の形を検出する', () => {
    const table = { columns: ['NAME', 'TTL'], rows: [] }
    const handle = toScenarioHandle({
      ...base,
      actors: [
        {
          id: 'client',
          kind: 'client',
          name: text('Client'),
          stateSlots: [
            { key: 'cache', label: text('Cache'), initial: table },
            { key: 'cache', label: text('Cache'), initial: { columns: ['A'], rows: [['1', '2']] } },
          ],
        },
        { id: 'server', kind: 'server', name: text('Server'), stateSlots: [] },
      ],
      buildSteps: () => [
        {
          id: 's',
          title: text('s'),
          description: text('s'),
          events: [
            {
              kind: 'stateChange',
              actorId: 'client',
              key: 'cache',
              value: { columns: ['NAME'], rows: [] },
            },
          ],
        },
      ],
    })
    expect(messagesOf(validateScenario(handle))).toEqual(
      expect.arrayContaining([
        'duplicate state key "cache"',
        'row has 2 cells but table has 1 columns',
        'table "cache" must keep the columns of its initial value',
      ]),
    )
  })

  it('同じ問題は 1 件にまとめる', () => {
    const handle = withSteps(() => [])
    const problems = validateScenario(handle).filter((p) => p.message === 'scenario has no steps')
    // 組み合わせごとに path が違うので 4 件、同じ path の重複はない
    expect(problems).toHaveLength(4)
    expect(new Set(problems.map((p) => p.path)).size).toBe(4)
  })
})

describe('collectLocalizedTexts', () => {
  it('タイトル・アクター・オプション・ステップ・フィールドの説明を集める', () => {
    const paths = collectLocalizedTexts(toScenarioHandle(base)).map((entry) => entry.path)
    expect(paths).toEqual(
      expect.arrayContaining([
        'title',
        'actors[0].name',
        'actors[0].stateSlots[0].label',
        'optionDefs.lost.label',
        'optionDefs.port.choices[1].label',
        'options(lost=1&port=closed).steps[1].title',
        'options(lost=0&port=open).steps[0].events[1].message.fields[0].description',
      ]),
    )
  })
})
