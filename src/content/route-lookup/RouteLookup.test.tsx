import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { LocaleProvider, type Locale } from '@/lib/i18n'
import { RouteLookup } from './RouteLookup'

function Location() {
  return <output data-testid="location">{useLocation().search}</output>
}

function renderAt(search: string, locale: Locale = 'en') {
  render(
    <MemoryRouter initialEntries={[`/${locale}/themes/route-lookup${search}`]}>
      <LocaleProvider locale={locale}>
        <RouteLookup />
        <Location />
      </LocaleProvider>
    </MemoryRouter>,
  )
}

/** 選ばれた経路の id */
const selected = () =>
  document.querySelector('tr[data-selected="true"]')?.getAttribute('data-route') ?? null
const result = () =>
  within(screen.getByRole('region', { name: /^(Result|結果)$/ })).getAllByRole('paragraph')

describe('RouteLookup', () => {
  it('既定では、ホスト経路（/32）がデフォルト経路に勝つ', () => {
    renderAt('')
    expect(screen.getByRole('textbox', { name: 'Destination IP address' })).toHaveValue(
      '192.0.2.10',
    )
    expect(selected()).toBe('host')
    // 選ばれた行は、色だけでなく印と読み上げ用の文でも示す
    expect(document.querySelector('tr[data-selected="true"]')?.textContent).toContain(
      '▶192.0.2.10/32 (selected)',
    )
    expect(result().map((p) => p.textContent)).toEqual([
      'The longest matching prefix wins.',
      'The packet goes to the next hop 203.0.113.254 (ARP for 203.0.113.254); the IP destination does not change.',
      'The first 32 bits of the destination must equal the route’s prefix.',
    ])
  })

  it('試す宛先のボタンで宛先を変え、URL に書き戻す', async () => {
    const user = userEvent.setup()
    renderAt('?dst=192.0.2.10&table=router')
    await user.click(screen.getByRole('button', { name: '10.1.2.3' }))
    expect(screen.getByTestId('location')).toHaveTextContent('?dst=10.1.2.3&table=router')
    expect(selected()).toBe('ten-b')
    expect(result()[0]?.textContent).toMatch(/smallest metric/)
  })

  it('直接接続のネットワークなら、宛先そのものに送る', () => {
    renderAt('?dst=192.168.1.20')
    expect(selected()).toBe('lan')
    expect(result()[1]?.textContent).toMatch(/goes to 192\.168\.1\.20 itself/)
  })

  it('経路を無効にすると選び直し、デフォルト経路もなければ経路なし', async () => {
    const user = userEvent.setup()
    renderAt('?dst=192.0.2.10')
    await user.click(screen.getByRole('checkbox', { name: 'Use the route 192.0.2.10/32' }))
    expect(selected()).toBe('default')
    expect(result()[0]?.textContent).toMatch(/Only the default route/)
    await user.click(screen.getByRole('checkbox', { name: 'Use the route 0.0.0.0/0' }))
    expect(selected()).toBeNull()
    expect(result().map((p) => p.textContent)).toEqual([
      'No route matches, so the packet cannot be forwarded. The router drops it and sends back ICMP Destination Unreachable (network unreachable, 3/0).',
    ])
  })

  it('PC の経路表で経路がなければ、PC はパケットを送り出せない（ICMP は生まれない）', async () => {
    const user = userEvent.setup()
    renderAt('?dst=192.0.2.10&table=pc')
    await user.click(screen.getByRole('checkbox', { name: 'Use the route 0.0.0.0/0' }))
    expect(selected()).toBeNull()
    expect(result().map((p) => p.textContent)).toEqual([
      'No route matches, so the PC cannot even send the packet. Nothing leaves the PC; the application gets an error (network unreachable).',
    ])
  })

  it('比べるビットは、プレフィックス長の分だけ強調する', () => {
    renderAt('?dst=192.168.1.20&table=pc')
    const bits = within(screen.getByRole('region', { name: 'Result' })).getAllByText(/^[01]$/)
    expect(bits).toHaveLength(64)
    const emphasized = bits.filter((bit) => bit.classList.contains('underline'))
    // 宛先とプレフィックスの 2 行 × 先頭の 24 ビット
    expect(emphasized).toHaveLength(48)
  })

  it('経路表を切り替えると、無効にした行は元に戻る', async () => {
    const user = userEvent.setup()
    renderAt('?dst=192.0.2.10')
    await user.click(screen.getByRole('checkbox', { name: 'Use the route 192.0.2.10/32' }))
    await user.click(screen.getByRole('radio', { name: 'Your PC (192.168.1.10)' }))
    expect(screen.getByTestId('location')).toHaveTextContent('?dst=192.0.2.10&table=pc')
    expect(selected()).toBe('pc-default')
    await user.click(screen.getByRole('radio', { name: /^Home router/ }))
    expect(selected()).toBe('host')
  })

  it('不正な宛先はエラーを出し、最後の正しい値で計算する', async () => {
    const user = userEvent.setup()
    renderAt('?dst=192.168.2.5')
    const input = screen.getByRole('textbox', { name: 'Destination IP address' })
    await user.type(input, '.9')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(selected()).toBe('branch')
  })

  it('2 進数でプレフィックスの長さの分を比べる（日本語）', () => {
    renderAt('?dst=192.168.2.5', 'ja')
    expect(
      screen.getByText('宛先の先頭の 24 ビットが、経路のプレフィックスと同じでなければならない。'),
    ).toBeInTheDocument()
  })
})
