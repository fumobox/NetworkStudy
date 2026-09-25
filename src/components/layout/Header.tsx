import { Link } from 'react-router'
import { localePath, useLocale, useMessages } from '@/lib/i18n'
import { LanguageSwitcher } from './LanguageSwitcher'

export function Header() {
  const locale = useLocale()
  const m = useMessages()

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4">
        <Link to={localePath(locale)} className="font-heading text-lg font-semibold">
          {m.common.siteName}
        </Link>
        <LanguageSwitcher />
      </div>
    </header>
  )
}
