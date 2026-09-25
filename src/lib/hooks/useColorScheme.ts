import { useEffect, useState } from 'react'
import {
  DARK_MEDIA_QUERY,
  isDark,
  readColorScheme,
  saveColorScheme,
  type ColorScheme,
} from '../colorScheme'
import { useMediaQuery } from './useMediaQuery'

/** 配色の設定（system / light / dark）を持ち、<html> の .dark と color-scheme に反映する */
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
