import { useEffect, useRef, useState } from 'react'

/**
 * 要素が横にはみ出してスクロールできるかを返す。スクロールできる領域はキーボードでも操作できるよう
 * tabIndex を付ける必要がある（axe の scrollable-region-focusable）が、はみ出していない表まで Tab で止まらないよう、
 * はみ出しているときだけ付けるために使う。見張るのは要素と、最初に描いたときの最初の子（表）。子を差し替える使い方はしない
 */
export function useHorizontalOverflow<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const update = () => {
      setOverflowing(element.scrollWidth > element.clientWidth)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    const child = element.firstElementChild
    if (child !== null) observer.observe(child)
    return () => {
      observer.disconnect()
    }
  }, [])

  return { ref, overflowing }
}
