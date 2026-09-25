import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { LocaleProvider, type Locale } from '@/lib/i18n'
import { OsiWalkthrough } from './OsiWalkthrough'

function Location() {
  return <output data-testid="location">{useLocation().search}</output>
}

function renderAt(search: string, locale: Locale = 'en') {
  render(
    <MemoryRouter initialEntries={[`/${locale}/themes/osi-model${search}`]}>
      <LocaleProvider locale={locale}>
        <OsiWalkthrough />
        <Location />
      </LocaleProvider>
    </MemoryRouter>,
  )
}

const stack = (name: string) => screen.getByRole('region', { name })
const carried = () =>
  within(screen.getByRole('region', { name: /^What is being carried/ }))
    .getAllByRole('listitem')
    .map((item) => [item.dataset.unit, item.dataset.change ?? null])

describe('OsiWalkthrough', () => {
  it('?step= のステップから始め、今の層を aria-current で示す', () => {
    renderAt('?step=3')
    expect(
      screen.getByRole('heading', { level: 2, name: 'Layer 4: TCP adds its header' }),
    ).toBeInTheDocument()
    const current = within(stack('Sender (your PC)')).getByRole('listitem', { current: 'step' })
    expect(current).toHaveTextContent(/Layer 4\s*Transport/)
    expect(
      within(stack('Receiver (web server)')).queryByRole('listitem', { current: 'step' }),
    ).toBeNull()
    // TCP のヘッダーが付いたところ（印とスクリーンリーダー向けの文でも示す）
    expect(carried()).toEqual([
      ['tcp', 'added'],
      ['http', null],
    ])
    expect(screen.getByText('TCP header').parentElement).toHaveTextContent('+TCP header (added)')
  })

  it('次へ進むと URL に書き戻し、第 2 層でヘッダーとトレーラーが付く', async () => {
    const user = userEvent.setup()
    renderAt('?step=4')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByTestId('location')).toHaveTextContent('?step=5')
    expect(carried()).toEqual([
      ['eth', 'added'],
      ['ip', null],
      ['tcp', null],
      ['http', null],
      ['fcs', 'added'],
    ])
  })

  it('受信側では外したものを取り消し線で残す（日本語）', () => {
    renderAt('?step=9', 'ja')
    const current = within(stack('受信側（Web サーバー）')).getByRole('listitem', {
      current: 'step',
    })
    expect(current).toHaveTextContent(/第 3 層\s*ネットワーク層/)
    expect(
      within(screen.getByRole('region', { name: /^運ばれているもの/ }))
        .getAllByRole('listitem')
        .map((item) => [item.dataset.unit, item.dataset.change ?? null]),
    ).toEqual([
      ['ip', 'removed'],
      ['tcp', null],
      ['http', null],
    ])
    expect(screen.getByText('IP のヘッダー').parentElement).toHaveTextContent(
      '−IP のヘッダー（外した）',
    )
  })

  it('物理層では信号として送られることを示す', () => {
    renderAt('?step=6')
    expect(screen.getByText('Sent as electrical signals (bits) on the cable')).toBeInTheDocument()
  })
})
