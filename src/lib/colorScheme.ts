import { z } from 'zod'
import { readStorage, writeStorage } from './storage'

export const COLOR_SCHEMES = ['system', 'light', 'dark'] as const
export type ColorScheme = (typeof COLOR_SCHEMES)[number]

/**
 * 保存に使うキー。index.html のインラインスクリプトも同じキーを読んで、描画の前に .dark を付ける
 * （キーや値の形を変えるときは、index.html も合わせて変える）
 */
export const COLOR_SCHEME_STORAGE_KEY = 'ns.colorScheme'
export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)'

const schemeSchema = z.enum(COLOR_SCHEMES)

export function readColorScheme(): ColorScheme {
  return readStorage(COLOR_SCHEME_STORAGE_KEY, schemeSchema) ?? 'system'
}

export function saveColorScheme(scheme: ColorScheme): void {
  writeStorage(COLOR_SCHEME_STORAGE_KEY, scheme)
}

/** 設定と OS の設定から、ダークで表示するかを決める */
export function isDark(scheme: ColorScheme, systemPrefersDark: boolean): boolean {
  return scheme === 'dark' || (scheme === 'system' && systemPrefersDark)
}

/** 次の設定（system → light → dark → system） */
export function nextColorScheme(scheme: ColorScheme): ColorScheme {
  const index = COLOR_SCHEMES.indexOf(scheme)
  return COLOR_SCHEMES[(index + 1) % COLOR_SCHEMES.length] ?? 'system'
}
