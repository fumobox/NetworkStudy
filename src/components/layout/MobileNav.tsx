import { Menu } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useMessages } from '@/lib/i18n'
import { MAIN_ID } from './mainId'
import { Sidebar } from './Sidebar'

/** 狭い画面でのテーマのナビゲーション（サイドバーの代わりにメニューから開く） */
export function MobileNav() {
  const m = useMessages()
  const [open, setOpen] = useState(false)
  // リンクで閉じたときは、フォーカスをメニューのボタンではなくページの main に移す。今いるページのリンクでも同じ
  // （閉じ終わるまでメニューの外は aria-hidden なので、ここで移すとスクリーンリーダーが読める）
  const navigated = useRef(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={m.nav.menu} className="lg:hidden">
          <Menu aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        closeLabel={m.nav.close}
        className="w-72 overflow-y-auto p-4 pt-12"
        onCloseAutoFocus={(event) => {
          if (navigated.current) {
            navigated.current = false
            event.preventDefault()
            document.getElementById(MAIN_ID)?.focus({ preventScroll: true })
          }
        }}
      >
        <SheetTitle className="sr-only">{m.nav.menu}</SheetTitle>
        {/* テーマの一覧は画面より長いので、メニューの中でスクロールする。リンクを押したら閉じる（今いるページのリンクでも閉じ、戻ったときに開き直さない） */}
        <Sidebar
          onNavigate={() => {
            navigated.current = true
            setOpen(false)
          }}
        />
      </SheetContent>
    </Sheet>
  )
}
