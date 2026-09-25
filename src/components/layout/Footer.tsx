import { useMessages } from '@/lib/i18n'

const REPOSITORY_URL = 'https://github.com/fumobox/NetworkStudy'

export function Footer() {
  const m = useMessages()

  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-6 text-sm text-muted-foreground">
        <a href={`${REPOSITORY_URL}/blob/main/LICENSE`} className="hover:text-foreground">
          {m.footer.license}
        </a>
        <a href={REPOSITORY_URL} className="hover:text-foreground">
          {m.footer.source}
        </a>
      </div>
    </footer>
  )
}
