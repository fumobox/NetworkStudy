import { Link } from 'react-router'
import { localePath, useLocale, useMessages } from '@/lib/i18n'
import { ColorSchemeToggle } from './ColorSchemeToggle'
import { LanguageSwitcher } from './LanguageSwitcher'
import { MobileNav } from './MobileNav'

export function Header() {
  const locale = useLocale()
  const m = useMessages()

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-4">
        <div className="flex items-center gap-1">
          <MobileNav />
          <Link to={localePath(locale)} className="font-heading text-lg font-semibold">
            {m.common.siteName}
          </Link>
        </div>
        <div className="flex items-center gap-1">
          <LanguageSwitcher />
          <ColorSchemeToggle />
        </div>
      </div>
    </header>
  )
}
