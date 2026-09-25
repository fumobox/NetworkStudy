import type { LocalizedText } from '@/lib/i18n/locale'
import type {
  Actor,
  ActorId,
  ActorStateSlot,
  Message,
  RawOptionValues,
  ScenarioHandle,
  ScenarioOptionDefs,
  ScenarioOptions,
  Step,
  StepEvent,
} from './types'
import { rawValuesOf } from './validate'

/** 合成したシナリオのアクター。状態の枠（stateSlots）は、各パートのアクターの枠を集めて作る */
export type ComposedActorDef = Omit<Actor, 'stateSlots'>

/** 合成するシナリオ 1 本分 */
export interface ScenarioPart {
  /**
   * ステップ・メッセージ・状態のキー・オプションのキーに付ける接頭辞（`tcp` → `tcp.syn`）。
   * パートどうしで id が衝突しないようにする。英小文字・数字・ハイフンのみ
   */
  readonly prefix: string
  readonly handle: ScenarioHandle
  /** パートのアクター id → 合成したシナリオのアクター id（DNS の `stub` を `client` に寄せるなど）。ないものは同じ id */
  readonly actorMap?: Readonly<Record<ActorId, ActorId>>
  /** 指定すると、このパートの全ステップの帯（section）をこの名前にする。なければパートの帯のまま */
  readonly section?: LocalizedText
  /** オプションの値を固定する（パートのキーで指定。URL より優先する） */
  readonly pinned?: RawOptionValues
  /** 合成したシナリオのフォームに出すオプション（パートのキー）。既定は [] で、どれも出さない */
  readonly expose?: readonly string[]
}

export interface ComposeScenariosInput {
  readonly id: string
  readonly title: LocalizedText
  /** 合成したシナリオのアクター（図の左からの順） */
  readonly actors: readonly ComposedActorDef[]
  /** この順にステップをつなげる */
  readonly parts: readonly ScenarioPart[]
}

const PREFIX_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function prefixed(prefix: string, id: string): string {
  return `${prefix}.${id}`
}

/**
 * 複数のシナリオを 1 本につなげる（HTTPS の全体像: DNS → TCP → TLS → HTTP など）。
 * - ステップ・メッセージ（retransmitOf を含む）・状態のキー・オプションのキーに `${prefix}.` を付ける
 * - アクター id は actorMap で合成したシナリオのアクターに寄せる。状態の枠は寄せた先のアクターに集める
 * - オプションは既定では出さない（全部出すと組み合わせが各パートの積になり、フォームも長くなる）
 *
 * 定義の誤り（接頭辞の重複や形式、寄せた先のアクターがない）は、モジュールの読み込み時に気づけるよう例外にする
 */
export function composeScenarios(input: ComposeScenariosInput): ScenarioHandle {
  const actorIds = new Set(input.actors.map((actor) => actor.id))
  const prefixes = new Set<string>()
  for (const part of input.parts) {
    if (!PREFIX_PATTERN.test(part.prefix) || prefixes.has(part.prefix)) {
      throw new Error(
        `composeScenarios(${input.id}): invalid or duplicated prefix "${part.prefix}"`,
      )
    }
    prefixes.add(part.prefix)
    for (const actor of part.handle.actors) {
      const target = mapActor(part, actor.id)
      if (!actorIds.has(target)) {
        throw new Error(
          `composeScenarios(${input.id}): actor "${actor.id}" of part "${part.prefix}" maps to unknown actor "${target}"`,
        )
      }
    }
    for (const key of part.expose ?? []) {
      if (!Object.hasOwn(part.handle.optionDefs, key)) {
        throw new Error(
          `composeScenarios(${input.id}): part "${part.prefix}" has no option "${key}"`,
        )
      }
    }
    // pinned の誤りは、パートの parseOptions（zod の catch）が黙って既定値に戻してしまうので、ここで確かめる
    for (const [key, value] of Object.entries(part.pinned ?? {})) {
      const def = Object.hasOwn(part.handle.optionDefs, key)
        ? part.handle.optionDefs[key]
        : undefined
      if (def === undefined) {
        throw new Error(
          `composeScenarios(${input.id}): part "${part.prefix}" has no option "${key}"`,
        )
      }
      if (!rawValuesOf(def).includes(value)) {
        throw new Error(
          `composeScenarios(${input.id}): option "${key}" of part "${part.prefix}" does not accept "${value}"`,
        )
      }
      if (part.expose?.includes(key) === true) {
        throw new Error(
          `composeScenarios(${input.id}): option "${key}" of part "${part.prefix}" is both pinned and exposed`,
        )
      }
    }
  }

  const actors: readonly Actor[] = input.actors.map((actor) => ({
    ...actor,
    stateSlots: input.parts.flatMap((part) =>
      part.handle.actors
        .filter((partActor) => mapActor(part, partActor.id) === actor.id)
        .flatMap((partActor) =>
          partActor.stateSlots.map((slot): ActorStateSlot => ({
            ...slot,
            key: prefixed(part.prefix, slot.key),
          })),
        ),
    ),
  }))

  const optionDefs: ScenarioOptionDefs<ScenarioOptions> = Object.fromEntries(
    input.parts.flatMap((part) =>
      (part.expose ?? []).flatMap((key) => {
        const def = part.handle.optionDefs[key]
        return def === undefined ? [] : [[prefixed(part.prefix, key), def] as const]
      }),
    ),
  )

  return {
    id: input.id,
    title: input.title,
    actors,
    optionDefs,
    resolve: (raw) => {
      const resolvedParts = input.parts.map((part) => ({
        part,
        resolved: part.handle.resolve(partRawOptions(part, raw)),
      }))
      return {
        options: Object.fromEntries(
          resolvedParts.flatMap(({ part, resolved }) =>
            (part.expose ?? []).flatMap((key) => {
              const value = resolved.options[key]
              return value === undefined ? [] : [[prefixed(part.prefix, key), value] as const]
            }),
          ),
        ),
        steps: resolvedParts.flatMap(({ part, resolved }) =>
          resolved.steps.map((step) => composeStep(part, step)),
        ),
      }
    },
  }
}

function mapActor(part: ScenarioPart, actorId: ActorId): ActorId {
  return part.actorMap?.[actorId] ?? actorId
}

/** URL のオプション（`tcp.synLoss` など）から、このパートに渡す値を取り出す。出していないキーは無視し、pinned を優先する */
function partRawOptions(part: ScenarioPart, raw: RawOptionValues): RawOptionValues {
  const exposed = new Set(part.expose ?? [])
  const fromUrl = Object.entries(raw).flatMap(([key, value]) => {
    const partKey = key.startsWith(`${part.prefix}.`) ? key.slice(part.prefix.length + 1) : null
    return partKey !== null && exposed.has(partKey) ? [[partKey, value] as const] : []
  })
  return { ...Object.fromEntries(fromUrl), ...part.pinned }
}

function composeMessage(part: ScenarioPart, message: Message): Message {
  return {
    ...message,
    id: prefixed(part.prefix, message.id),
    from: mapActor(part, message.from),
    to: mapActor(part, message.to),
    ...(message.retransmitOf === undefined
      ? {}
      : { retransmitOf: prefixed(part.prefix, message.retransmitOf) }),
  }
}

function composeEvent(part: ScenarioPart, event: StepEvent): StepEvent {
  switch (event.kind) {
    case 'message':
      return { ...event, message: composeMessage(part, event.message) }
    case 'stateChange':
      return {
        ...event,
        actorId: mapActor(part, event.actorId),
        key: prefixed(part.prefix, event.key),
      }
    case 'timer':
      return { ...event, actorId: mapActor(part, event.actorId) }
  }
}

function composeStep(part: ScenarioPart, step: Step): Step {
  // Step に項目が増えても落とさないよう、元のステップを広げてから置き換える
  return {
    ...step,
    id: prefixed(part.prefix, step.id),
    events: step.events.map((event) => composeEvent(part, event)),
    ...(part.section === undefined ? {} : { section: part.section }),
  }
}
