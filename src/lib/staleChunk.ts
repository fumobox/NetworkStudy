/**
 * デプロイでチャンクのファイル名（ハッシュ）が変わると、デプロイ前に開いたページは古いチャンクを取りに行って 404 になる。
 * Vite は動的 import に失敗すると vite:preloadError を出すので、ページを読み込み直して新しいバージョンにする。
 * 新しいバージョンでも失敗する（本当に壊れている）ときに読み込み直しを繰り返さないよう、直前に読み込み直した時刻を
 * sessionStorage に残し、その間はエラーをそのまま投げさせる
 */

const KEY = 'network-study:stale-chunk-reload'
/** この時間内に読み込み直したばかりなら、もう読み込み直さない */
export const RELOAD_GUARD_MS = 10_000

/** window のうち、ここで使う部分（テストで差し替えるため） */
export interface ReloadTarget {
  addEventListener(type: 'vite:preloadError', listener: (event: Event) => void): void
  readonly location: { reload(): void }
  readonly sessionStorage: Pick<Storage, 'getItem' | 'setItem'>
}

function lastReload(target: ReloadTarget): number | null {
  try {
    const value = Number(target.sessionStorage.getItem(KEY))
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}

function rememberReload(target: ReloadTarget, now: number): boolean {
  try {
    target.sessionStorage.setItem(KEY, String(now))
    return true
  } catch {
    // 記録できないと繰り返しを止められないので、読み込み直さない
    return false
  }
}

export function reloadOnStaleChunk(target: ReloadTarget = window, now: () => number = Date.now) {
  target.addEventListener('vite:preloadError', (event) => {
    const time = now()
    const last = lastReload(target)
    if (last !== null && time - last < RELOAD_GUARD_MS) return
    if (!rememberReload(target, time)) return
    // エラーを投げさせずに、新しいバージョンを読み込む。preventDefault すると import は undefined で解決し、React.lazy が
    // 読み込み直しの前に TypeError を投げることがあるが、ページはすでに読み込み直しに入っているので害はない
    event.preventDefault()
    target.location.reload()
  })
}
