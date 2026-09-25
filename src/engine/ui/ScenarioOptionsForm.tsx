import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { useMessages, useText } from '@/lib/i18n'
import type { OptionValue, ScenarioOptionDefs, ScenarioOptions } from '../types'

interface ScenarioOptionsFormProps {
  optionDefs: ScenarioOptionDefs<ScenarioOptions>
  options: ScenarioOptions
  onChange: (key: string, value: OptionValue) => void
}

/** What-if 分岐のフォーム。toggle は Switch、select は RadioGroup で表示する */
export function ScenarioOptionsForm({ optionDefs, options, onChange }: ScenarioOptionsFormProps) {
  const m = useMessages()
  const t = useText()
  const baseId = useId()
  const entries = Object.entries(optionDefs)
  if (entries.length === 0) {
    return null
  }

  return (
    <section aria-labelledby={`${baseId}-title`} className="space-y-3">
      <h2 id={`${baseId}-title`} className="font-heading text-base font-semibold">
        {m.options.title}
      </h2>
      <div className="space-y-4">
        {entries.map(([key, def]) => {
          const id = `${baseId}-${key}`
          const descriptionId = `${id}-description`
          const description =
            def.description === undefined ? null : (
              <p id={descriptionId} className="text-xs text-muted-foreground">
                {t(def.description)}
              </p>
            )
          if (def.kind === 'toggle') {
            const value = options[key]
            return (
              <div key={key} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Switch
                    id={id}
                    checked={value === true}
                    aria-describedby={def.description === undefined ? undefined : descriptionId}
                    onCheckedChange={(checked) => {
                      onChange(key, checked)
                    }}
                  />
                  <Label htmlFor={id}>{t(def.label)}</Label>
                </div>
                {description}
              </div>
            )
          }
          const value = options[key]
          return (
            <fieldset key={key} className="space-y-2">
              <legend id={`${id}-legend`} className="text-sm font-medium">
                {t(def.label)}
              </legend>
              {description}
              <RadioGroup
                aria-labelledby={`${id}-legend`}
                value={typeof value === 'string' ? value : def.defaultValue}
                aria-describedby={def.description === undefined ? undefined : descriptionId}
                onValueChange={(next) => {
                  onChange(key, next)
                }}
              >
                {def.choices.map((choice) => {
                  const choiceId = `${id}-${choice.value}`
                  return (
                    <div key={choice.value} className="flex items-center gap-2">
                      <RadioGroupItem id={choiceId} value={choice.value} />
                      <Label htmlFor={choiceId} className="font-normal">
                        {t(choice.label)}
                      </Label>
                    </div>
                  )
                })}
              </RadioGroup>
            </fieldset>
          )
        })}
      </div>
    </section>
  )
}
