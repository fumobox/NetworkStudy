import type { OptionValue, RawOptionValues, ScenarioOptionDefs, ScenarioOptions } from './types'

/** URL のクエリでのオプションの接頭辞。`?opt.synLost=1` */
const OPTION_PREFIX = 'opt.'
const STEP_PARAM = 'step'
const TOGGLE_ON = '1'
const TOGGLE_OFF = '0'

/** `?step=`（1 始まり）を 0 始まりのステップ番号にする。ないか不正なら null */
export function readStepParam(params: URLSearchParams): number | null {
  const raw = params.get(STEP_PARAM)
  if (raw === null || !/^\d+$/.test(raw)) {
    return null
  }
  return Math.max(Number(raw) - 1, 0)
}

/** `opt.<key>=<value>` を集める。値の検証は Scenario.parseOptions が行う */
export function readOptionParams(params: URLSearchParams): RawOptionValues {
  return Object.fromEntries(
    [...params]
      .filter(([name]) => name.startsWith(OPTION_PREFIX))
      .map(([name, value]) => [name.slice(OPTION_PREFIX.length), value]),
  )
}

/** オプションの部分だけを並べた文字列（同じオプションなら同じ文字列。プレイヤーの key などに使う） */
export function optionParamsKey(params: URLSearchParams): string {
  return new URLSearchParams(
    [...params]
      .filter(([name]) => name.startsWith(OPTION_PREFIX))
      .sort(([a], [b]) => a.localeCompare(b)),
  ).toString()
}

function serializeOption(value: OptionValue): string {
  if (typeof value === 'boolean') {
    return value ? TOGGLE_ON : TOGGLE_OFF
  }
  return value
}

/**
 * オプションとステップを URL のクエリに書き込んだ新しい URLSearchParams を返す。
 * デフォルト値と同じオプション・最初のステップは省く。オプション以外のパラメータは残す。
 */
export function writeScenarioParams(
  params: URLSearchParams,
  update: {
    readonly optionDefs: ScenarioOptionDefs<ScenarioOptions>
    readonly options: ScenarioOptions
    readonly stepIndex: number
  },
): URLSearchParams {
  const next = new URLSearchParams(
    [...params].filter(([name]) => !name.startsWith(OPTION_PREFIX) && name !== STEP_PARAM),
  )
  for (const [key, def] of Object.entries(update.optionDefs)) {
    const value = update.options[key]
    if (value !== undefined && value !== def.defaultValue) {
      next.set(`${OPTION_PREFIX}${key}`, serializeOption(value))
    }
  }
  if (update.stepIndex > 0) {
    next.set(STEP_PARAM, String(update.stepIndex + 1))
  }
  return next
}
