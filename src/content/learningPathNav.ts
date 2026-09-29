import { z } from 'zod'
import {
  LEARNING_PATH_IDS,
  LEARNING_PATHS,
  type LearningPath,
  type LearningPathId,
} from './learningPaths'
import { THEME_META, type ThemeId } from './themeMeta'

// テーマのページで、道筋の中の位置と前後のテーマを求める（#243）。
// learningPaths.ts は scripts と e2e からも読むので import なしに保ち、zod を使う処理はこちらに置く

/** テーマのページで、どの道筋から来たかを表すクエリ */
export const PATH_PARAM = 'path'

const pathParamSchema = z.enum(LEARNING_PATH_IDS)

/** ?path= を検証して読む。ないか、知らない値なら null（同じ名前が複数あれば最初のもの） */
export function readPathParam(params: URLSearchParams): LearningPathId | null {
  const parsed = pathParamSchema.safeParse(params.get(PATH_PARAM))
  return parsed.success ? parsed.data : null
}

/** 道筋の合計の目安の時間（分） */
export function pathMinutes(path: LearningPath): number {
  return path.themeIds.reduce(
    (sum, id) => sum + (THEME_META.find((meta) => meta.id === id)?.minutes ?? 0),
    0,
  )
}

/** テーマのページへのリンクに付けるクエリ */
export function themeSearch(pathId: LearningPathId): string {
  return `?${PATH_PARAM}=${pathId}`
}

export interface PathPosition {
  readonly path: LearningPath
  /** 0 から数える */
  readonly index: number
  readonly total: number
  readonly previous: ThemeId | null
  readonly next: ThemeId | null
}

/** 道筋の中でのテーマの位置。道筋にないテーマなら null */
export function pathPosition(path: LearningPath, themeId: string): PathPosition | null {
  const index = path.themeIds.findIndex((id) => id === themeId)
  if (index < 0) {
    return null
  }
  return {
    path,
    index,
    total: path.themeIds.length,
    previous: path.themeIds[index - 1] ?? null,
    next: path.themeIds[index + 1] ?? null,
  }
}

/** テーマを含む道筋での位置（LEARNING_PATHS の順） */
export function pathsContaining(themeId: string): readonly PathPosition[] {
  return LEARNING_PATHS.flatMap((path) => {
    const position = pathPosition(path, themeId)
    return position === null ? [] : [position]
  })
}

export type PathContext =
  | { readonly kind: 'single'; readonly position: PathPosition }
  | { readonly kind: 'several'; readonly positions: readonly PathPosition[] }
  | { readonly kind: 'none' }

/**
 * テーマのページに出す道筋を決める。?path= の道筋がテーマを含めばそれを出す。
 * ないか、テーマを含まない道筋なら無視して（404 にも URL の書き換えにもしない）、テーマを含む道筋をすべて出す
 */
export function resolvePathContext(themeId: string, requested: LearningPathId | null): PathContext {
  const positions = pathsContaining(themeId)
  const chosen = positions.find((position) => position.path.id === requested)
  if (chosen !== undefined) {
    return { kind: 'single', position: chosen }
  }
  const [only, ...rest] = positions
  if (only === undefined) {
    return { kind: 'none' }
  }
  return rest.length === 0 ? { kind: 'single', position: only } : { kind: 'several', positions }
}
