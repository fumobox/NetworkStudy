import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { LocaleProvider, type Locale } from '@/lib/i18n'
import { Ipv6Address } from './Ipv6Address'

function Location() {
  return <output data-testid="location">{useLocation().search}</output>
}

function renderAt(search: string, locale: Locale = 'en') {
  render(
    <MemoryRouter initialEntries={[`/${locale}/themes/ipv6-address${search}`]}>
      <LocaleProvider locale={locale}>
        <Ipv6Address />
        <Location />
      </LocaleProvider>
    </MemoryRouter>,
  )
}

/** 結果の表の、見出しに対応する値 */
function value(label: string) {
  const term = screen.getByText(label, { selector: 'dt' })
  return term.nextElementSibling?.textContent
}

describe('Ipv6Address', () => {
  it('既定のアドレスの表記、種類、プレフィックス、要請ノードマルチキャスト、EUI-64 を示す', () => {
    renderAt('')
    expect(value('Recommended form (RFC 5952)')).toBe('2001:db8:1:0:200:5eff:fe00:530a')
    expect(value('Full form')).toBe('2001:0db8:0001:0000:0200:5eff:fe00:530a')
    expect(value('Kind')).toBe('Documentation address (2001:db8::/32)')
    expect(value('Prefix')).toBe('2001:db8:1::/64')
    expect(value('Interface ID')).toBe('::200:5eff:fe00:530a')
    expect(value('Solicited-node multicast address')).toBe('ff02::1:ff00:530a')
    expect(value('Interface ID made from a MAC address')).toMatch(/00:00:5e:00:53:0a/)
  })

  it('入力を正規の表記で読み、URL に書く。不正な入力はエラーを出し、最後の正しい値で計算する', async () => {
    const user = userEvent.setup()
    renderAt('')
    const input = screen.getByRole('textbox', { name: 'IPv6 address' })
    await user.clear(input)
    await user.type(input, 'FE80:0000::0001')
    expect(value('Recommended form (RFC 5952)')).toBe('fe80::1')
    expect(value('Kind')).toBe('Link-local unicast address (fe80::/10)')
    expect(screen.getByTestId('location')).toHaveTextContent('address=FE80%3A0000%3A%3A0001')
    await user.type(input, '::')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(/Not a valid IPv6 address/)).toBeInTheDocument()
    expect(value('Recommended form (RFC 5952)')).toBe('fe80::1')
  })

  it('マルチキャストのアドレスは scope とグループ、送り先の MAC アドレスを示す', async () => {
    const user = userEvent.setup()
    renderAt('')
    await user.click(screen.getByRole('button', { name: 'ff02::1' }))
    expect(screen.getByRole('button', { name: 'ff02::1' })).toHaveAttribute('aria-pressed', 'true')
    expect(value('Multicast scope')).toBe('Link-local (2)')
    expect(value('Well-known group')).toBe('All nodes on the link (ff02::1)')
    expect(value('Ethernet MAC address it is sent to')).toBe('33:33:00:00:00:01')
    expect(screen.queryByText('Prefix', { selector: 'dt' })).toBeNull()
  })

  it('プレフィックス長を変えると、プレフィックスとビットの強調が変わる', async () => {
    const user = userEvent.setup()
    renderAt('?address=2001:db8:abcd:ffff::1&prefix=64')
    const prefix = screen.getByRole('spinbutton', { name: 'Prefix length' })
    await user.clear(prefix)
    await user.type(prefix, '56')
    expect(value('Prefix')).toBe('2001:db8:abcd:ff00::/56')
    const bits = within(screen.getByTestId('ipv6-bits')).getAllByText(/^[01]$/)
    expect(bits).toHaveLength(128)
    expect(bits.filter((bit) => bit.classList.contains('underline'))).toHaveLength(56)
  })

  it('MAC アドレスから EUI-64 のインターフェース ID とリンクローカルアドレスを作り、上に表示できる', async () => {
    const user = userEvent.setup()
    renderAt('')
    const mac = screen.getByRole('textbox', { name: 'MAC address' })
    await user.clear(mac)
    await user.type(mac, '00:00:5e:00:53:14')
    expect(value('Link-local address')).toBe('fe80::200:5eff:fe00:5314')
    await user.click(screen.getByRole('button', { name: 'Show this address above' }))
    expect(value('Recommended form (RFC 5952)')).toBe('fe80::200:5eff:fe00:5314')
    await user.clear(mac)
    await user.type(mac, 'xx')
    expect(screen.getByText(/Not a valid MAC address/)).toBeInTheDocument()
  })

  it('ループバックには、近隣探索と EUI-64 の行を出さない', () => {
    renderAt('?address=::1')
    expect(screen.queryByText('Solicited-node multicast address', { selector: 'dt' })).toBeNull()
    expect(
      screen.queryByText('Interface ID made from a MAC address', { selector: 'dt' }),
    ).toBeNull()
  })

  it('例のアドレスは、どれも推奨の表記（押した例が選ばれた状態になる）', async () => {
    const user = userEvent.setup()
    renderAt('')
    for (const button of within(
      screen.getByText('Try these addresses').parentElement ?? document.body,
    ).getAllByRole('button')) {
      await user.click(button)
      expect(button).toHaveAttribute('aria-pressed', 'true')
    }
  })

  it('日本語の表示', () => {
    renderAt('?address=::1', 'ja')
    expect(value('種類')).toBe('ループバックアドレス（::1/128）')
  })
})
