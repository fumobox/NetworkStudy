import { useEffect, useRef, type RefObject } from 'react'
import { NavigationType, useLocation, useNavigationType } from 'react-router'
import { stripLocaleSegment } from '@/lib/i18n'

/**
 * 別のページに移ったら、スクロールをトップに戻し、フォーカスを main に移す（スクリーンリーダーが新しいページの先頭から読む）。
 * React Router の宣言的モードには ScrollRestoration がないので自前で行う。
 * - 比べるのはロケールを除いたパス。クエリ（?step= やもしものオプション）だけの変化と、言語の切り替えでは動かさない
 * - ブラウザーの戻る・進む（POP）では動かさず、ブラウザーのスクロールの復元に任せる
 */
export function useResetScrollOnNavigate(main: RefObject<HTMLElement | null>) {
  const { pathname } = useLocation()
  const navigationType = useNavigationType()
  const page = stripLocaleSegment(pathname)
  const previous = useRef(page)

  useEffect(() => {
    if (previous.current === page) {
      return
    }
    previous.current = page
    if (navigationType === NavigationType.Pop) {
      return
    }
    window.scrollTo(0, 0)
    main.current?.focus({ preventScroll: true })
  }, [page, navigationType, main])
}
