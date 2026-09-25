import { ThemeCard } from '@/components/features/theme-card/ThemeCard'
import { THEME_META } from '@/content/themeMeta'
import { useMessages } from '@/lib/i18n'

export function HomePage() {
  const m = useMessages()

  return (
    <>
      <title>{m.common.siteName}</title>
      <div className="space-y-10">
        <section className="space-y-3">
          <h1 className="font-heading text-3xl font-bold tracking-tight">{m.common.siteName}</h1>
          <p className="text-lg text-muted-foreground">{m.common.tagline}</p>
        </section>
        <section aria-labelledby="home-themes" className="space-y-4">
          <h2 id="home-themes" className="font-heading text-xl font-semibold">
            {m.nav.themes}
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {THEME_META.map((theme) => (
              <li key={theme.id}>
                <ThemeCard theme={theme} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  )
}
