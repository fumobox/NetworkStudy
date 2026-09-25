import { Menu } from 'lucide-react'
import { useState } from 'react'
import { useLocation } from 'react-router'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useMessages } from '@/lib/i18n'
import { Sidebar } from './Sidebar'

/** 狭い画面でのテーマのナビゲーション（サイドバーの代わりにメニューから開く） */
export function MobileNav() {
  const m = useMessages()
  const { pathname } = useLocation()
  const [openedAt, setOpenedAt] = useState<string | null>(null)
  // ページを移動したら閉じる（開いたときのパスと違えば閉じている扱いにする）
  const open = openedAt === pathname

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpenedAt(next ? pathname : null)
      }}
    >
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={m.nav.menu} className="lg:hidden">
          <Menu aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" closeLabel={m.nav.close} className="w-72 p-4 pt-12">
        <SheetTitle className="sr-only">{m.nav.menu}</SheetTitle>
        <Sidebar />
      </SheetContent>
    </Sheet>
  )
}
