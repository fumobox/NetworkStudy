import { useEffect, useState } from 'react'
import {
  DARK_MEDIA_QUERY,
  isDark,
  readColorScheme,
  saveColorScheme,
  type ColorScheme,
} from '../colorScheme'
import { useMediaQuery } from './useMediaQuery'

/**
 * 配色の設定（system / light / dark）を持ち、<html> の .dark に反映する。
 * ヘッダーの 1 か所で使う前提で、他のインスタンスや別のタブの変更には追従しない
 */
export function useColorScheme(): readonly [ColorScheme, (scheme: ColorScheme) => void] {
  const [scheme, setScheme] = useState<ColorScheme>(readColorScheme)
  const systemPrefersDark = useMediaQuery(DARK_MEDIA_QUERY)
  const dark = isDark(scheme, systemPrefersDark)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  const update = (next: ColorScheme) => {
    setScheme(next)
    saveColorScheme(next)
  }
  return [scheme, update]
}
