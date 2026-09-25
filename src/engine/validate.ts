import type { LocalizedText } from '@/lib/i18n/locale'
import { findTextProblems, type LocalizedTextEntry } from '@/lib/i18n/textProblems'
import type {
  Actor,
  RawOptionValues,
  ResolvedScenario,
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

export type { LocalizedTextEntry } from '@/lib/i18n/textProblems'

/** URL（`opt.<key>=<value>`）で指定できる値の一覧（toggle は 1 / 0、select は choices の値） */
export function rawValuesOf(def: ScenarioOptionDef): readonly string[] {
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

/** 不正な値の例。どのオプションでも受け付けないはずの値 */
const INVALID_RAW_VALUE = '\u0000invalid'

/** resolve を呼び、例外は問題として報告する（validateScenario 自体は throw しない） */
function safeResolve(
  handle: ScenarioHandle,
  raw: RawOptionValues,
  problems: ScenarioProblem[],
): ResolvedScenario | null {
  try {
    return handle.resolve(raw)
  } catch (error) {
    problems.push({
      path: `options(${describeOptions(raw)})`,
      message: `resolve threw: ${error instanceof Error ? error.message : String(error)}`,
    })
    return null
  }
}

function checkNotEmpty(path: string, kind: string, id: string, problems: ScenarioProblem[]): void {
  if (id === '') {
    problems.push({ path, message: `${kind} is empty` })
  }
}

function sameColumns(a: StateValue, b: StateValue): boolean {
  if (typeof a === 'string' || typeof b === 'string') {
    return true
  }
  return a.columns.join('\u0000') === b.columns.join('\u0000')
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
    checkNotEmpty(path, 'actor id', actor.id, problems)
    if (seen.has(actor.id)) {
      problems.push({ path, message: `duplicate actor id "${actor.id}"` })
    }
    seen.add(actor.id)
    const keys = new Set<string>()
    actor.stateSlots.forEach((slot, j) => {
      const slotPath = `${path}.stateSlots[${String(j)}]`
      checkNotEmpty(slotPath, 'state key', slot.key, problems)
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
    checkNotEmpty(stepPath, 'step id', step.id, problems)
    if (stepIds.has(step.id)) {
      problems.push({ path: stepPath, message: `duplicate step id "${step.id}"` })
    }
    stepIds.add(step.id)

    step.events.forEach((event, j) => {
      const eventPath = `${stepPath}.events[${String(j)}]`
      switch (event.kind) {
        case 'message': {
          const { message } = event
          checkNotEmpty(eventPath, 'message id', message.id, problems)
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
          } else if (!sameColumns(slot.initial, event.value)) {
            problems.push({
              path: eventPath,
              message: `table "${event.key}" must keep the columns of its initial value`,
            })
          }
          checkTableShape(`${eventPath}.value`, event.value, problems)
          break
        }
        case 'timer':
          if (!actorsById.has(event.actorId)) {
            problems.push({ path: eventPath, message: `unknown actor "${event.actorId}"` })
          }
          if (!Number.isFinite(event.durationMs) || event.durationMs < 0) {
            problems.push({ path: eventPath, message: 'durationMs must be a finite number >= 0' })
          }
          break
      }
    })
  })
}

/** optionDefs と parseOptions（zod スキーマ）が一致しているか */
function checkOptions(handle: ScenarioHandle, problems: ScenarioProblem[]): void {
  const resolved = safeResolve(handle, {}, problems)
  if (resolved === null) {
    return
  }
  const defaults = resolved.options
  for (const key of Object.keys(defaults)) {
    if (!Object.hasOwn(handle.optionDefs, key)) {
      problems.push({
        path: `optionDefs.${key}`,
        message: 'option is returned by parseOptions but not declared in optionDefs',
      })
    }
  }
  for (const [key, def] of Object.entries(handle.optionDefs)) {
    const path = `optionDefs.${key}`
    if (def.kind === 'select') {
      const values = def.choices.map((choice) => choice.value)
      if (!values.includes(def.defaultValue)) {
        problems.push({
          path,
          message: `defaultValue "${def.defaultValue}" is not one of the choices`,
        })
      }
      for (const duplicate of values.filter((value, i) => values.indexOf(value) !== i)) {
        problems.push({ path, message: `duplicate choice "${duplicate}"` })
      }
    }
    const fallback = safeResolve(handle, { [key]: INVALID_RAW_VALUE }, problems)
    if (fallback !== null && fallback.options[key] !== def.defaultValue) {
      problems.push({
        path,
        message: `an invalid value gives ${JSON.stringify(fallback.options[key])} instead of falling back to defaultValue`,
      })
    }
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
      const actual = safeResolve(handle, { [key]: raw }, problems)?.options[key]
      if (actual !== expected) {
        problems.push({
          path,
          message: `parseOptions({ ${key}: "${raw}" }) gives ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
        })
      }
    }
  }
}

/**
 * シナリオに含まれるすべての LocalizedText を、全オプションの組み合わせについて集める。
 * resolve が例外を投げた組み合わせは飛ばす（validateScenario が問題として報告する）
 */
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
    safeResolve(handle, raw, [])?.steps.forEach((step, i) => {
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
  problems.push(...findTextProblems(collectLocalizedTexts(handle)))
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
    const resolved = safeResolve(handle, raw, problems)
    if (resolved !== null) {
      checkSteps(handle.actors, resolved.steps, `options(${describeOptions(raw)})`, problems)
    }
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
