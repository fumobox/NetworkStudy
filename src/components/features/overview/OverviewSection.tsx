import type { MDXContent } from 'mdx/types'
import { Suspense, useId, type LazyExoticComponent } from 'react'
import { useMessages } from '@/lib/i18n'

interface OverviewSectionProps {
  content: LazyExoticComponent<MDXContent>
}

/** テーマの概要（MDX）を表示する。読み込み中はその旨を表示する */
export function OverviewSection({ content: Content }: OverviewSectionProps) {
  const m = useMessages()
  const titleId = useId()

  return (
    <section aria-labelledby={titleId} className="space-y-3">
      <h2 id={titleId} className="sr-only">
        {m.theme.overview}
      </h2>
      <Suspense fallback={<p className="text-sm text-muted-foreground">{m.theme.loading}</p>}>
        <div className="prose max-w-none prose-neutral dark:prose-invert prose-headings:font-heading prose-a:text-primary">
          <Content />
        </div>
      </Suspense>
    </section>
  )
}
