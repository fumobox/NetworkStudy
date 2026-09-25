import { Suspense } from 'react'
import { Outlet } from 'react-router'
import { useMessages } from '@/lib/i18n'
import { Footer } from './Footer'
import { Header } from './Header'
import { Sidebar } from './Sidebar'

const MAIN_ID = 'main'

export function AppLayout() {
  const m = useMessages()

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
        <main id={MAIN_ID} tabIndex={-1} className="min-w-0 flex-1">
          {/* 遅延読み込みのページ（テーマ）を開くあいだの表示 */}
          <Suspense fallback={<p className="text-sm text-muted-foreground">{m.theme.loading}</p>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <Footer />
    </div>
  )
}
