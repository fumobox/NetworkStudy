import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { MemoryRouter, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useResetScrollOnNavigate } from './useResetScrollOnNavigate'

const TARGETS = [
  '/en/themes/dns-resolution',
  '/en/themes/tcp-handshake?step=3',
  '/ja/themes/tcp-handshake',
] as const

function Harness() {
  const main = useRef<HTMLElement>(null)
  useResetScrollOnNavigate(main)
  const navigate = useNavigate()
  return (
    <main ref={main} tabIndex={-1}>
      {TARGETS.map((to) => (
        <button key={to} type="button" onClick={() => void navigate(to)}>
          {to}
        </button>
      ))}
      <button type="button" onClick={() => void navigate(-1)}>
        {'back'}
      </button>
    </main>
  )
}

const click = (name: string) => {
  fireEvent.click(screen.getByRole('button', { name }))
}

describe('useResetScrollOnNavigate', () => {
  const scrollTo = vi.fn()

  beforeEach(() => {
    scrollTo.mockClear()
    vi.spyOn(window, 'scrollTo').mockImplementation(scrollTo)
    render(
      <MemoryRouter initialEntries={['/en/themes/tcp-handshake']}>
        <Harness />
      </MemoryRouter>,
    )
    screen.getByRole('button', { name: 'back' }).focus()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('最初の表示では動かさない', () => {
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('別のページに移ったらトップに戻し、フォーカスを main に移す', () => {
    click('/en/themes/dns-resolution')
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
    expect(document.activeElement).toBe(screen.getByRole('main'))
  })

  it('クエリだけの変化では動かさない', () => {
    click('/en/themes/tcp-handshake?step=3')
    expect(scrollTo).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'back' }))
  })

  it('言語の切り替えでは動かさない', () => {
    click('/ja/themes/tcp-handshake')
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('戻る・進む（POP）では動かさない', () => {
    click('/en/themes/dns-resolution')
    scrollTo.mockClear()
    click('back')
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
