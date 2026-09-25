import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useColorScheme } from '@/lib/hooks/useColorScheme'
import { nextColorScheme } from '@/lib/colorScheme'
import { useMessages } from '@/lib/i18n'

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const

/** 配色の切り替え（システムに従う → ライト → ダーク の順に切り替える） */
export function ColorSchemeToggle() {
  const m = useMessages()
  const [scheme, setScheme] = useColorScheme()
  const next = nextColorScheme(scheme)
  const Icon = ICONS[scheme]

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={m.colorScheme.toggle({
        current: m.colorScheme[scheme],
        next: m.colorScheme[next],
      })}
      onClick={() => {
        setScheme(next)
      }}
    >
      <Icon aria-hidden />
    </Button>
  )
}
