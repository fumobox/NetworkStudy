import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useMessages } from '@/lib/i18n'

interface LoadErrorBoundaryProps {
  readonly children: ReactNode
  /** テストで差し替えるため */
  readonly onReload?: () => void
}

interface LoadErrorBoundaryState {
  readonly failed: boolean
}

/**
 * ページの読み込み（遅延読み込みのチャンクなど）に失敗したとき、空白の代わりに読み込み直しを促す。
 * 古いチャンクはまず lib/staleChunk.ts が自動で読み込み直すので、ここに来るのはそれでも回復しないとき。
 * 呼び出し側は key にパスを渡し、別のページに移ったらリセットする
 */
export class LoadErrorBoundary extends Component<LoadErrorBoundaryProps, LoadErrorBoundaryState> {
  override state: LoadErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): LoadErrorBoundaryState {
    return { failed: true }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  override render() {
    if (!this.state.failed) return this.props.children
    return <LoadError onReload={this.props.onReload ?? reloadPage} />
  }
}

function reloadPage() {
  window.location.reload()
}

function LoadError({ onReload }: { onReload: () => void }) {
  const m = useMessages()
  return (
    <section role="alert" className="space-y-4">
      <h1 className="font-heading text-2xl font-bold">{m.layout.loadErrorTitle}</h1>
      <p className="text-muted-foreground">{m.layout.loadErrorDescription}</p>
      <Button onClick={onReload}>{m.layout.reload}</Button>
    </section>
  )
}
