// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { TONE_CLASSES, TONES } from './tone'

describe('TONE_CLASSES', () => {
  it.each(TONES)('%s のクラスは、どれもその色相の変数を使う', (tone) => {
    const classes = TONE_CLASSES[tone]
    expect(classes).toEqual({
      text: `text-tone-${tone}`,
      bg: `bg-tone-${tone}`,
      soft: `bg-tone-${tone}-soft`,
      border: `border-tone-${tone}`,
      stroke: `stroke-tone-${tone}`,
      fill: `fill-tone-${tone}`,
      fillSoft: `fill-tone-${tone}-soft`,
    })
  })
})
