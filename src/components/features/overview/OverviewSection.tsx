import type { MDXContent } from 'mdx/types'
import { Suspense, type ComponentProps, type LazyExoticComponent } from 'react'
import { useMessages } from '@/lib/i18n'
import { OverviewLink } from './OverviewLink'

interface OverviewSectionProps {
  content: LazyExoticComponent<MDXContent>
}

/**
 * MDX の要素を置き換えるコンポーネント。MDX は h2 から書く決まりだが、ページでは「概要」の見出し（h2）の下に入るので、
 * 見出しを 1 段ずつ下げて表示する
 */
const MDX_COMPONENTS = {
  a: OverviewLink,
  h2: (props: ComponentProps<'h2'>) => <h3 {...props} />,
  h3: (props: ComponentProps<'h3'>) => <h4 {...props} />,
  h4: (props: ComponentProps<'h4'>) => <h5 {...props} />,
  // コマンドの出力は長い行が横にスクロールするので、キーボードでもスクロールできるようフォーカスできるようにする
  pre: (props: ComponentProps<'pre'>) => <pre tabIndex={0} {...props} />,
}

/** テーマの概要（MDX）を表示する。読み込み中はその旨を表示する */
export function OverviewSection({ content: Content }: OverviewSectionProps) {
  const m = useMessages()

  // 束ねる見出し（h2 の「概要」）と区切りはテーマのページが付ける
  return (
    <div className="space-y-3">
      <Suspense fallback={<p className="text-sm text-muted-foreground">{m.theme.loading}</p>}>
        {/* typography の既定はインラインコードの前後に ` を付け足すので、それを消す。インラインコードと表の見出しには淡い背景を付ける */}
        <div className="prose max-w-none prose-headings:font-heading prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-medium prose-code:before:content-none prose-code:after:content-none prose-th:bg-muted prose-th:px-2 prose-td:px-2">
          <Content components={MDX_COMPONENTS} />
        </div>
      </Suspense>
    </div>
  )
}
