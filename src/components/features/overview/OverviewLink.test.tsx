import { render, screen } from '@testing-library/react'
import { BrowserRouter, MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { LocaleProvider } from '@/lib/i18n'
import { OverviewLink } from './OverviewLink'

function links() {
  return (
    <>
      <OverviewLink href="/themes/dns-resolution">internal</OverviewLink>
      <OverviewLink href="https://www.rfc-editor.org/rfc/rfc9293">external</OverviewLink>
      <OverviewLink href="#section">anchor</OverviewLink>
    </>
  )
}

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('OverviewLink', () => {
  it('サイト内のリンクに表示中のロケールを付け、外部リンクとページ内リンクはそのまま', () => {
    render(
      <MemoryRouter initialEntries={['/ja/themes/https-overview']}>
        <LocaleProvider locale="ja">{links()}</LocaleProvider>
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'internal' })).toHaveAttribute(
      'href',
      '/ja/themes/dns-resolution',
    )
    expect(screen.getByRole('link', { name: 'external' })).toHaveAttribute(
      'href',
      'https://www.rfc-editor.org/rfc/rfc9293',
    )
    expect(screen.getByRole('link', { name: 'anchor' })).toHaveAttribute('href', '#section')
  })

  it('basename（/NetworkStudy/）の下でも、サイト内のリンクに basename が付く', () => {
    window.history.replaceState(null, '', '/NetworkStudy/en/themes/https-overview')
    render(
      <BrowserRouter basename="/NetworkStudy/">
        <LocaleProvider locale="en">{links()}</LocaleProvider>
      </BrowserRouter>,
    )
    expect(screen.getByRole('link', { name: 'internal' })).toHaveAttribute(
      'href',
      '/NetworkStudy/en/themes/dns-resolution',
    )
    expect(screen.getByRole('link', { name: 'external' })).toHaveAttribute(
      'href',
      'https://www.rfc-editor.org/rfc/rfc9293',
    )
  })
})
