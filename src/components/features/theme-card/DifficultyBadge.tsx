import type { Difficulty } from '@/content/themeMeta'
import { DIFFICULTY_TONE } from '@/content/themeTone'
import { useMessages } from '@/lib/i18n'
import { TONE_CLASSES } from '@/lib/tone'
import { cn } from '@/lib/utils'

/** 難易度のバッジ（色と文字の両方で示す） */
export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  const m = useMessages()
  const tone = TONE_CLASSES[DIFFICULTY_TONE[difficulty]]
  return (
    <span
      data-difficulty={difficulty}
      className={cn('rounded-md px-1.5 py-0.5 font-medium', tone.soft, tone.text)}
    >
      {m.theme.difficulty[difficulty]}
    </span>
  )
}
