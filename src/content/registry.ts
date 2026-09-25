import { tcpHandshakeTheme } from './tcp-handshake'
import type { ThemeModule } from './types'

/** 公開するテーマ（themeMeta.ts の THEME_META と同じ順・同じ id。registry.test.ts で確認する） */
export const THEMES: readonly ThemeModule[] = [tcpHandshakeTheme]

export function findTheme(id: string | undefined): ThemeModule | undefined {
  return THEMES.find((theme) => theme.meta.id === id)
}
