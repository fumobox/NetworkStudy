import type { Scenario, ScenarioHandle, ScenarioOptions } from './types'

/**
 * Scenario<TOptions> の TOptions を消去して ScenarioHandle にする。
 * buildSteps の引数は反変なので Scenario<TcpOptions> は Scenario<ScenarioOptions> に代入できない。
 * registry などで異なるテーマを同じ型で並べるため、クロージャで型を閉じ込める。
 */
export function toScenarioHandle<TOptions extends ScenarioOptions>(
  scenario: Scenario<TOptions>,
): ScenarioHandle {
  return {
    id: scenario.id,
    title: scenario.title,
    actors: scenario.actors,
    optionDefs: scenario.optionDefs,
    resolve: (raw) => {
      const options = scenario.parseOptions(raw)
      return { options, steps: scenario.buildSteps(options) }
    },
  }
}
