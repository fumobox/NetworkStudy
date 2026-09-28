import { Suspense, useRef } from 'react'
import { Outlet, useLocation } from 'react-router'
import { useMessages } from '@/lib/i18n'
import { Footer } from './Footer'
import { Header } from './Header'
import { LoadErrorBoundary } from './LoadErrorBoundary'
import { MAIN_ID } from './mainId'
import { Sidebar } from './Sidebar'
import { useResetScrollOnNavigate } from './useResetScrollOnNavigate'

export function AppLayout() {
  const m = useMessages()
  const { pathname } = useLocation()
  const main = useRef<HTMLElement>(null)
  useResetScrollOnNavigate(main)

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <a
        href={`#${MAIN_ID}`}
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-2 focus:ring-ring"
      >
        {m.layout.skipToContent}
      </a>
      <Header />
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-8 px-4 py-10">
        <aside className="hidden w-56 shrink-0 lg:block">
          <Sidebar />
        </aside>
        {/* スキップリンクとページの移動でフォーカスを受ける。Tab の順には入らず、操作できる要素でもないので枠は描かない */}
        <main ref={main} id={MAIN_ID} tabIndex={-1} className="min-w-0 flex-1 outline-none">
          {/* 遅延読み込みのページ（テーマ）を開くあいだの表示 */}
          {/* 読み込みに失敗したときの表示。別のページに移ったらリセットする（言語の切り替えでページの状態は失わない） */}
          <LoadErrorBoundary resetKey={pathname}>
            <Suspense fallback={<p className="text-sm text-muted-foreground">{m.theme.loading}</p>}>
              <Outlet />
            </Suspense>
          </LoadErrorBoundary>
        </main>
      </div>
      <Footer />
    </div>
  )
}
