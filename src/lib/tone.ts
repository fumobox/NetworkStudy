/**
 * 色相（src/index.css の --tone-*）と Tailwind のクラスの対応。
 * Tailwind はソースの文字列を走査してクラスを生成するので、クラス名は組み立てずに完全な形で書く
 */
export const TONES = ['blue', 'violet', 'teal', 'amber', 'green', 'rose'] as const
export type Tone = (typeof TONES)[number]

export interface ToneClasses {
  /** 文字の色 */
  readonly text: string
  /** 塗りつぶしの背景（上の文字は text-background） */
  readonly bg: string
  /** 淡い背景 */
  readonly soft: string
  readonly border: string
  /** SVG の線 */
  readonly stroke: string
  /** SVG の文字・塗り */
  readonly fill: string
  /** SVG の淡い塗り */
  readonly fillSoft: string
}

export const TONE_CLASSES: Readonly<Record<Tone, ToneClasses>> = {
  blue: {
    text: 'text-tone-blue',
    bg: 'bg-tone-blue',
    soft: 'bg-tone-blue-soft',
    border: 'border-tone-blue',
    stroke: 'stroke-tone-blue',
    fill: 'fill-tone-blue',
    fillSoft: 'fill-tone-blue-soft',
  },
  violet: {
    text: 'text-tone-violet',
    bg: 'bg-tone-violet',
    soft: 'bg-tone-violet-soft',
    border: 'border-tone-violet',
    stroke: 'stroke-tone-violet',
    fill: 'fill-tone-violet',
    fillSoft: 'fill-tone-violet-soft',
  },
  teal: {
    text: 'text-tone-teal',
    bg: 'bg-tone-teal',
    soft: 'bg-tone-teal-soft',
    border: 'border-tone-teal',
    stroke: 'stroke-tone-teal',
    fill: 'fill-tone-teal',
    fillSoft: 'fill-tone-teal-soft',
  },
  amber: {
    text: 'text-tone-amber',
    bg: 'bg-tone-amber',
    soft: 'bg-tone-amber-soft',
    border: 'border-tone-amber',
    stroke: 'stroke-tone-amber',
    fill: 'fill-tone-amber',
    fillSoft: 'fill-tone-amber-soft',
  },
  green: {
    text: 'text-tone-green',
    bg: 'bg-tone-green',
    soft: 'bg-tone-green-soft',
    border: 'border-tone-green',
    stroke: 'stroke-tone-green',
    fill: 'fill-tone-green',
    fillSoft: 'fill-tone-green-soft',
  },
  rose: {
    text: 'text-tone-rose',
    bg: 'bg-tone-rose',
    soft: 'bg-tone-rose-soft',
    border: 'border-tone-rose',
    stroke: 'stroke-tone-rose',
    fill: 'fill-tone-rose',
    fillSoft: 'fill-tone-rose-soft',
  },
}
