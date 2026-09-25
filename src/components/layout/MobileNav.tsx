import { Menu } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useMessages } from '@/lib/i18n'
import { Sidebar } from './Sidebar'

/** 狭い画面でのテーマのナビゲーション（サイドバーの代わりにメニューから開く） */
export function MobileNav() {
  const m = useMessages()
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={m.nav.menu} className="lg:hidden">
          <Menu aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" closeLabel={m.nav.close} className="w-72 p-4 pt-12">
        <SheetTitle className="sr-only">{m.nav.menu}</SheetTitle>
        {/* リンクを押したら閉じる（今いるページのリンクでも閉じ、戻ったときに開き直さない） */}
        <Sidebar
          onNavigate={() => {
            setOpen(false)
          }}
        />
      </SheetContent>
    </Sheet>
  )
}
