import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useDocumentDescription } from './useDocumentDescription'

afterEach(() => {
  document.head.querySelectorAll('meta[name="description"]').forEach((meta) => {
    meta.remove()
  })
})

const descriptions = () =>
  [...document.head.querySelectorAll<HTMLMetaElement>('meta[name="description"]')].map(
    (meta) => meta.content,
  )

describe('useDocumentDescription', () => {
  it('既存の description を書き換え、重複させない', () => {
    const meta = document.createElement('meta')
    meta.name = 'description'
    meta.content = 'static'
    document.head.append(meta)
    const { rerender } = renderHook(
      ({ text }) => {
        useDocumentDescription(text)
      },
      { initialProps: { text: 'first' } },
    )
    expect(descriptions()).toEqual(['first'])
    rerender({ text: 'second' })
    expect(descriptions()).toEqual(['second'])
  })

  it('なければ作る', () => {
    renderHook(() => {
      useDocumentDescription('created')
    })
    expect(descriptions()).toEqual(['created'])
  })
})
