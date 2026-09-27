import type { Tone } from '@/lib/tone'
import type { Difficulty, ThemeCategory } from './themeMeta'

// 分類と難易度の色。themeMeta.ts は scripts からも読むので、表示だけに使う対応はこのファイルに分ける

/** 分類の色（ホームの見出し、テーマのカード、サイドバー） */
export const CATEGORY_TONE: Readonly<Record<ThemeCategory, Tone>> = {
  basics: 'teal',
  ip: 'amber',
  lan: 'green',
  web: 'blue',
  tcp: 'violet',
  http: 'rose',
}

/** 難易度のバッジの色（文字も必ず表示する） */
export const DIFFICULTY_TONE: Readonly<Record<Difficulty, Tone>> = {
  beginner: 'green',
  intermediate: 'violet',
}
