import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { LocaleProvider, type Locale } from '@/lib/i18n'
import { SubnetCalculator } from './SubnetCalculator'

function Location() {
  const location = useLocation()
  return (
    <>
      <output data-testid="location">{location.search}</output>
      {/* サイドバーと同じく、クエリのないテーマのページへのリンク */}
      <Link to="/en/themes/subnet-calculator">reset</Link>
    </>
  )
}

function renderAt(search: string, locale: Locale = 'en') {
  render(
    <MemoryRouter initialEntries={[`/${locale}/themes/subnet-calculator${search}`]}>
      <LocaleProvider locale={locale}>
        <SubnetCalculator />
        <Location />
      </LocaleProvider>
    </MemoryRouter>,
  )
}

/** 結果の表を { 見出し: 値 } で取り出す */
function results(): Record<string, string> {
  const section = screen.getByRole('heading', { name: /^(Results|計算の結果)$/ }).closest('section')
  if (section === null) throw new Error('no results section')
  return Object.fromEntries(
    [...section.querySelectorAll('dl > div')].map((row) => [
      row.querySelector('dt')?.textContent ?? '',
      row.querySelector('dd')?.textContent ?? '',
    ]),
  )
}

const location = () => screen.getByTestId('location').textContent

describe('SubnetCalculator', () => {
  it('URL のクエリのアドレスとプレフィックス長で計算する（192.168.1.130/26）', () => {
    renderAt('?ip=192.168.1.130&prefix=26')
    expect(screen.getByRole('textbox', { name: 'IPv4 address' })).toHaveValue('192.168.1.130')
    expect(screen.getByRole('spinbutton', { name: 'Prefix length' })).toHaveValue(26)
    expect(screen.getByRole('slider', { name: 'Prefix length' })).toHaveAttribute(
      'aria-valuenow',
      '26',
    )
    expect(results()).toEqual({
      'CIDR notation': '192.168.1.128/26',
      'Subnet mask': '255.255.255.192',
      'Wildcard mask': '0.0.0.63',
      'Network address': '192.168.1.128',
      'Broadcast address': '192.168.1.191',
      'First host': '192.168.1.129',
      'Last host': '192.168.1.190',
      'Usable hosts': '62',
      'Address class (historical)': 'C',
      'Private address (RFC 1918)': 'Yes',
    })
  })

  it('クエリがなければ既定値（192.168.1.10/24）', () => {
    renderAt('')
    expect(results()['Network address']).toBe('192.168.1.0')
    expect(results()['Usable hosts']).toBe('254')
  })

  it('/31 と /32 にはブロードキャストアドレスがない', () => {
    renderAt('?ip=203.0.113.7&prefix=31')
    expect(results()).toMatchObject({
      'Broadcast address': 'None (/31 and /32 have no broadcast address)',
      'First host': '203.0.113.6',
      'Last host': '203.0.113.7',
      'Usable hosts': '2',
      'Private address (RFC 1918)': 'No',
    })
  })

  it('アドレスを入力すると URL に書き戻し、不正な入力ではエラーを出して最後の正しい値で計算する', async () => {
    const user = userEvent.setup()
    renderAt('?ip=192.168.1.10&prefix=24')
    const input = screen.getByRole('textbox', { name: 'IPv4 address' })
    await user.clear(input)
    await user.type(input, '10.1.2.3')
    expect(location()).toBe('?ip=10.1.2.3&prefix=24')
    expect(results()['Network address']).toBe('10.1.2.0')
    expect(input).toHaveAttribute('aria-invalid', 'false')

    await user.type(input, '.4')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription(/Not a valid IPv4 address/)
    // URL と結果は最後の正しいアドレスのまま
    expect(location()).toBe('?ip=10.1.2.3&prefix=24')
    expect(results()['Network address']).toBe('10.1.2.0')
  })

  it('表示したまま URL のクエリが外から変わったら、入力欄も URL の値にそろえる', async () => {
    const user = userEvent.setup()
    renderAt('?ip=10.1.2.3&prefix=26')
    const input = screen.getByRole('textbox', { name: 'IPv4 address' })
    // 入力途中（不正）のまま、クエリのないリンクで移る
    await user.type(input, '.')
    await user.click(screen.getByRole('link', { name: 'reset' }))
    expect(location()).toBe('')
    expect(input).toHaveValue('192.168.1.10')
    expect(input).toHaveAttribute('aria-invalid', 'false')
    expect(screen.getByRole('spinbutton', { name: 'Prefix length' })).toHaveValue(24)
    expect(results()['Network address']).toBe('192.168.1.0')
  })

  it('プレフィックス長の数値入力は、消してから打ち直せる', async () => {
    const user = userEvent.setup()
    renderAt('?ip=10.20.30.40&prefix=24')
    const prefix = screen.getByRole('spinbutton', { name: 'Prefix length' })
    await user.clear(prefix)
    expect(prefix).toHaveValue(null)
    // 空の間は URL と結果を変えない
    expect(location()).toBe('?ip=10.20.30.40&prefix=24')
    await user.type(prefix, '8')
    expect(prefix).toHaveValue(8)
    expect(location()).toBe('?ip=10.20.30.40&prefix=8')
    // 続けて 0 を打つと 80 になるが、範囲外なので 8 のまま
    await user.type(prefix, '0')
    expect(prefix).toHaveValue(8)
    expect(location()).toBe('?ip=10.20.30.40&prefix=8')
    expect(results()['Subnet mask']).toBe('255.0.0.0')
  })

  it('プレフィックス長の数値入力とスライダーは連動し、URL に書き戻す', () => {
    renderAt('?ip=10.20.30.40&prefix=24')
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Prefix length' }), {
      target: { value: '8' },
    })
    expect(location()).toBe('?ip=10.20.30.40&prefix=8')
    expect(screen.getByRole('slider', { name: 'Prefix length' })).toHaveAttribute(
      'aria-valuenow',
      '8',
    )
    expect(results()['Subnet mask']).toBe('255.0.0.0')

    fireEvent.keyDown(screen.getByRole('slider', { name: 'Prefix length' }), { key: 'ArrowRight' })
    expect(location()).toBe('?ip=10.20.30.40&prefix=9')

    // 範囲外の値は無視する
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Prefix length' }), {
      target: { value: '40' },
    })
    expect(location()).toBe('?ip=10.20.30.40&prefix=9')
    // 入力欄とスライダーの表示も、結果と同じ値のまま
    expect(screen.getByRole('spinbutton', { name: 'Prefix length' })).toHaveValue(9)
    expect(screen.getByRole('slider', { name: 'Prefix length' })).toHaveAttribute(
      'aria-valuenow',
      '9',
    )
  })

  it('2 進数の表示で、ネットワーク部とホスト部の境目を文でも伝える', () => {
    renderAt('?ip=192.168.1.130&prefix=26', 'ja')
    const table = screen.getByRole('table')
    expect(table).toHaveAccessibleDescription(
      '先頭の 26 ビットがネットワーク部、残りの 6 ビットがホスト部。',
    )
    const rows = within(table).getAllByRole('row')
    expect(rows.map((row) => row.textContent)).toEqual([
      'アドレス11000000.10101000.00000001.10000010',
      'マスク11111111.11111111.11111111.11000000',
      'ネットワーク11000000.10101000.00000001.10000000',
    ])
  })
})
