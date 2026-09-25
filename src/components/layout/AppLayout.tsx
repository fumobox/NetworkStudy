import { Outlet } from 'react-router'
import { useMessages } from '@/lib/i18n'
import { Footer } from './Footer'
import { Header } from './Header'

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
      <main id={MAIN_ID} className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
