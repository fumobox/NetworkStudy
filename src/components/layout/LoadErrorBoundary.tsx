import { Component, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useMessages } from '@/lib/i18n'

interface LoadErrorBoundaryProps {
  readonly children: ReactNode
  /** 変わったらエラーの表示をやめて、子をまた出す（ページを移ったとき） */
  readonly resetKey: string
  /** テストで差し替えるため */
  readonly onReload?: () => void
}

interface LoadErrorBoundaryState {
  readonly failed: boolean
}

/**
 * ページの読み込み（遅延読み込みのチャンクなど）に失敗したとき、空白の代わりに読み込み直しを促す。
 * デプロイで古いチャンクが消えたときは、まず vite:preloadError で自動的に読み込み直すので、ここに来るのはそれでも回復しないとき。
 * 描画の不具合でも同じ表示になる。key ではなく resetKey でリセットするのは、言語の切り替え（パスのロケールだけが変わる）で
 * ページの状態を失わないため。エラーの記録は React の既定（onCaughtError が console.error に出す）に任せる
 */
export class LoadErrorBoundary extends Component<LoadErrorBoundaryProps, LoadErrorBoundaryState> {
  override state: LoadErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): LoadErrorBoundaryState {
    return { failed: true }
  }

  override componentDidUpdate(previous: LoadErrorBoundaryProps) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false })
    }
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
