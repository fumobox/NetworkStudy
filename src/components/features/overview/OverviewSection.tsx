import type { MDXContent } from 'mdx/types'
import { Suspense, type LazyExoticComponent } from 'react'
import { useMessages } from '@/lib/i18n'

interface OverviewSectionProps {
  content: LazyExoticComponent<MDXContent>
}

/** テーマの概要（MDX）を表示する。読み込み中はその旨を表示する */
export function OverviewSection({ content: Content }: OverviewSectionProps) {
  const m = useMessages()

  // MDX の各節の見出し（h2）を束ねる見出しはなく、ランドマークの名前だけを付ける
  return (
    <section aria-label={m.theme.overview} className="space-y-3">
      <Suspense fallback={<p className="text-sm text-muted-foreground">{m.theme.loading}</p>}>
        {/* typography の既定はインラインコードの前後に ` を付け足すので、それを消す */}
        <div className="prose max-w-none prose-headings:font-heading prose-code:before:content-none prose-code:after:content-none">
          <Content />
        </div>
      </Suspense>
    </section>
  )
}
