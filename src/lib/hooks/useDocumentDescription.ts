import { useEffect } from 'react'

/**
 * `<meta name="description">` の内容を設定する。
 * 静的ページ（scripts/）が head に埋め込んだものがあれば書き換え、なければ作る。
 * React 19 の <meta> の巻き上げは既存のタグと重複排除しないため、description はこのフックで扱う
 */
export function useDocumentDescription(content: string): void {
  useEffect(() => {
    let meta = document.head.querySelector<HTMLMetaElement>('meta[name="description"]')
    if (meta === null) {
      meta = document.createElement('meta')
      meta.name = 'description'
      document.head.append(meta)
    }
    meta.content = content
  }, [content])
}
