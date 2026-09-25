import { LOCALES, type LocalizedText } from '@/lib/i18n/locale'
import type {
  Actor,
  RawOptionValues,
  ScenarioHandle,
  ScenarioOptionDef,
  StateValue,
  Step,
} from './types'

/** 開発者向けの問題の報告（テストの失敗メッセージとして表示する） */
export interface ScenarioProblem {
  readonly path: string
  readonly message: string
}

export interface LocalizedTextEntry {
  readonly path: string
  readonly text: LocalizedText
}

/** toggle は '1' / '0'、select は各 choice を URL の値として列挙する */
function rawValuesOf(def: ScenarioOptionDef): readonly string[] {
  return def.kind === 'toggle' ? ['1', '0'] : def.choices.map((choice) => choice.value)
}

/** optionDefs から、URL で指定しうる全オプションの組み合わせを列挙する */
export function enumerateOptionCombinations(handle: ScenarioHandle): RawOptionValues[] {
  return Object.entries(handle.optionDefs).reduce<RawOptionValues[]>(
    (combinations, [key, def]) =>
      combinations.flatMap((combination) =>
        rawValuesOf(def).map((value) => ({ ...combination, [key]: value })),
      ),
    [{}],
  )
}

function describeOptions(raw: RawOptionValues): string {
  const entries = Object.entries(raw)
  return entries.length === 0 ? 'default' : entries.map(([k, v]) => `${k}=${v}`).join('&')
}

function isTable(value: StateValue): boolean {
  return typeof value !== 'string'
}

function checkTableShape(path: string, value: StateValue, problems: ScenarioProblem[]): void {
  if (typeof value === 'string') {
    return
  }
  value.rows.forEach((row, i) => {
    if (row.length !== value.columns.length) {
      problems.push({
        path: `${path}.rows[${String(i)}]`,
        message: `row has ${String(row.length)} cells but table has ${String(value.columns.length)} columns`,
      })
    }
  })
}

function checkActors(actors: readonly Actor[], problems: ScenarioProblem[]): void {
  const seen = new Set<string>()
  actors.forEach((actor, i) => {
    const path = `actors[${String(i)}]`
    if (actor.id === '') {
      problems.push({ path, message: 'actor id is empty' })
    }
    if (seen.has(actor.id)) {
      problems.push({ path, message: `duplicate actor id "${actor.id}"` })
    }
    seen.add(actor.id)
    const keys = new Set<string>()
    actor.stateSlots.forEach((slot, j) => {
      const slotPath = `${path}.stateSlots[${String(j)}]`
      if (keys.has(slot.key)) {
        problems.push({ path: slotPath, message: `duplicate state key "${slot.key}"` })
      }
      keys.add(slot.key)
      checkTableShape(`${slotPath}.initial`, slot.initial, problems)
    })
  })
}

function checkSteps(
  actors: readonly Actor[],
  steps: readonly Step[],
  prefix: string,
  problems: ScenarioProblem[],
): void {
  if (steps.length === 0) {
    problems.push({ path: prefix, message: 'scenario has no steps' })
  }
  const actorsById = new Map(actors.map((actor) => [actor.id, actor]))
  const stepIds = new Set<string>()
  const messageIds = new Set<string>()

  steps.forEach((step, i) => {
    const stepPath = `${prefix}.steps[${String(i)}]`
    if (stepIds.has(step.id)) {
      problems.push({ path: stepPath, message: `duplicate step id "${step.id}"` })
    }
    stepIds.add(step.id)

    step.events.forEach((event, j) => {
      const eventPath = `${stepPath}.events[${String(j)}]`
      switch (event.kind) {
        case 'message': {
          const { message } = event
          if (messageIds.has(message.id)) {
            problems.push({ path: eventPath, message: `duplicate message id "${message.id}"` })
          }
          for (const end of [message.from, message.to]) {
            if (!actorsById.has(end)) {
              problems.push({ path: eventPath, message: `unknown actor "${end}"` })
            }
          }
          if (message.from === message.to) {
            problems.push({ path: eventPath, message: 'message is sent to its sender' })
          }
          if (message.retransmitOf !== undefined && !messageIds.has(message.retransmitOf)) {
            problems.push({
              path: eventPath,
              message: `retransmitOf "${message.retransmitOf}" does not refer to an earlier message`,
            })
          }
          messageIds.add(message.id)
          break
        }
        case 'stateChange': {
          const slot = actorsById
            .get(event.actorId)
            ?.stateSlots.find((candidate) => candidate.key === event.key)
          if (!actorsById.has(event.actorId)) {
            problems.push({ path: eventPath, message: `unknown actor "${event.actorId}"` })
          } else if (slot === undefined) {
            problems.push({
              path: eventPath,
              message: `state key "${event.key}" is not declared for actor "${event.actorId}"`,
            })
          } else if (isTable(slot.initial) !== isTable(event.value)) {
            problems.push({
              path: eventPath,
              message: `state "${event.key}" must be a ${isTable(slot.initial) ? 'table' : 'scalar'}`,
            })
          }
          checkTableShape(`${eventPath}.value`, event.value, problems)
          break
        }
        case 'timer':
          if (!actorsById.has(event.actorId)) {
            problems.push({ path: eventPath, message: `unknown actor "${event.actorId}"` })
          }
          if (!(event.durationMs >= 0)) {
            problems.push({ path: eventPath, message: 'durationMs must be >= 0' })
          }
          break
      }
    })
  })
}

/** optionDefs と parseOptions（zod スキーマ）が一致しているか */
function checkOptions(handle: ScenarioHandle, problems: ScenarioProblem[]): void {
  const defaults = handle.resolve({}).options
  for (const [key, def] of Object.entries(handle.optionDefs)) {
    const path = `optionDefs.${key}`
    if (defaults[key] !== def.defaultValue) {
      problems.push({
        path,
        message: `parseOptions({}) gives ${JSON.stringify(defaults[key])} but defaultValue is ${JSON.stringify(def.defaultValue)}`,
      })
    }
    const expectations: readonly (readonly [string, string | boolean])[] =
      def.kind === 'toggle'
        ? [
            ['1', true],
            ['0', false],
          ]
        : def.choices.map((choice) => [choice.value, choice.value] as const)
    for (const [raw, expected] of expectations) {
      const actual = handle.resolve({ [key]: raw }).options[key]
      if (actual !== expected) {
        problems.push({
          path,
          message: `parseOptions({ ${key}: "${raw}" }) gives ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
        })
      }
    }
  }
}

/** シナリオに含まれるすべての LocalizedText を、全オプションの組み合わせについて集める */
export function collectLocalizedTexts(handle: ScenarioHandle): LocalizedTextEntry[] {
  const entries: LocalizedTextEntry[] = [{ path: 'title', text: handle.title }]
  const add = (path: string, text: LocalizedText | undefined) => {
    if (text !== undefined) {
      entries.push({ path, text })
    }
  }

  handle.actors.forEach((actor, i) => {
    add(`actors[${String(i)}].name`, actor.name)
    add(`actors[${String(i)}].shortName`, actor.shortName)
    actor.stateSlots.forEach((slot, j) => {
      add(`actors[${String(i)}].stateSlots[${String(j)}].label`, slot.label)
    })
  })
  for (const [key, def] of Object.entries(handle.optionDefs)) {
    add(`optionDefs.${key}.label`, def.label)
    add(`optionDefs.${key}.description`, def.description)
    if (def.kind === 'select') {
      def.choices.forEach((choice, i) => {
        add(`optionDefs.${key}.choices[${String(i)}].label`, choice.label)
      })
    }
  }
  for (const raw of enumerateOptionCombinations(handle)) {
    const prefix = `options(${describeOptions(raw)})`
    handle.resolve(raw).steps.forEach((step, i) => {
      const stepPath = `${prefix}.steps[${String(i)}]`
      add(`${stepPath}.title`, step.title)
      add(`${stepPath}.description`, step.description)
      add(`${stepPath}.section`, step.section)
      step.events.forEach((event, j) => {
        if (event.kind !== 'message') {
          return
        }
        const eventPath = `${stepPath}.events[${String(j)}].message`
        add(`${eventPath}.description`, event.message.description)
        event.message.fields.forEach((field, k) => {
          add(`${eventPath}.fields[${String(k)}].description`, field.description)
        })
      })
    })
  }
  return entries
}

function checkLocalizedTexts(handle: ScenarioHandle, problems: ScenarioProblem[]): void {
  for (const { path, text } of collectLocalizedTexts(handle)) {
    for (const locale of LOCALES) {
      const value = text[locale].trim()
      if (value === '') {
        problems.push({ path: `${path}.${locale}`, message: 'text is empty' })
      } else if (/\bTODO\b|\bFIXME\b/.test(value)) {
        problems.push({ path: `${path}.${locale}`, message: 'text contains a placeholder' })
      }
    }
  }
}

/**
 * シナリオの整合性を検査する（ID の一意性、参照先の存在、状態の型、オプションと zod の一致、翻訳の空欄）。
 * 全オプションの組み合わせについて検査し、見つかった問題を重複なく返す。問題がなければ []。
 */
export function validateScenario(handle: ScenarioHandle): readonly ScenarioProblem[] {
  const problems: ScenarioProblem[] = []
  if (handle.id === '') {
    problems.push({ path: 'id', message: 'scenario id is empty' })
  }
  checkActors(handle.actors, problems)
  checkOptions(handle, problems)
  for (const raw of enumerateOptionCombinations(handle)) {
    checkSteps(
      handle.actors,
      handle.resolve(raw).steps,
      `options(${describeOptions(raw)})`,
      problems,
    )
  }
  checkLocalizedTexts(handle, problems)

  const seen = new Set<string>()
  return problems.filter((problem) => {
    const key = `${problem.path}\n${problem.message}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}
