import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { localePath, useLocale, useMessages } from '@/lib/i18n'

export function NotFoundPage() {
  const locale = useLocale()
  const m = useMessages()

  return (
    <>
      <title>{m.common.pageTitle({ page: m.notFound.title })}</title>
      <meta name="robots" content="noindex" />
      <section className="space-y-4">
        <h1 className="font-heading text-2xl font-bold">{m.notFound.title}</h1>
        <p className="text-muted-foreground">{m.notFound.description}</p>
        <Button asChild>
          <Link to={localePath(locale)}>{m.notFound.backHome}</Link>
        </Button>
      </section>
    </>
  )
}
