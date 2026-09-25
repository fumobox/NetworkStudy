import { useMessages } from '@/lib/i18n'

export function HomePage() {
  const m = useMessages()

  return (
    <>
      <title>{m.common.siteName}</title>
      <section className="space-y-3">
        <h1 className="font-heading text-3xl font-bold tracking-tight">{m.common.siteName}</h1>
        <p className="text-lg text-muted-foreground">{m.common.tagline}</p>
      </section>
    </>
  )
}
