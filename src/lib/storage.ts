import type { z } from 'zod'

/**
 * localStorage から JSON を読み、スキーマで検証して返す。
 * 値がない・壊れている・スキーマに合わない・ストレージが使えない場合は null を返す。
 */
export function readStorage<T>(key: string, schema: z.ZodType<T>): T | null {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(key)
  } catch {
    return null
  }
  if (raw === null) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const result = schema.safeParse(parsed)
  return result.success ? result.data : null
}

/** localStorage に JSON で保存する。保存できない環境（プライベートモードや容量超過など）では何もしない */
export function writeStorage(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 保存は利便性のためだけなので、失敗しても無視する
  }
}
