import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '@/lib/i18n'
import type { ScenarioOptionDefs, ScenarioOptions } from '../types'
import { ScenarioOptionsForm } from './ScenarioOptionsForm'

const optionDefs: ScenarioOptionDefs<ScenarioOptions> = {
  lost: {
    kind: 'toggle',
    label: { en: 'Lose the first SYN', ja: '最初の SYN をロスさせる' },
    description: { en: 'The SYN never arrives.', ja: 'SYN が届かない。' },
    defaultValue: false,
  },
  port: {
    kind: 'select',
    label: { en: 'Server port', ja: 'サーバーのポート' },
    choices: [
      { value: 'open', label: { en: 'Open', ja: '開いている' } },
      { value: 'closed', label: { en: 'Closed', ja: '閉じている' } },
    ],
    defaultValue: 'open',
  },
}

function renderForm(options: ScenarioOptions, locale: 'en' | 'ja' = 'en') {
  const onChange = vi.fn()
  render(
    <LocaleProvider locale={locale}>
      <ScenarioOptionsForm optionDefs={optionDefs} options={options} onChange={onChange} />
    </LocaleProvider>,
  )
  return { onChange }
}

describe('ScenarioOptionsForm', () => {
  it('toggle はスイッチ、select はラジオボタンで表示する', () => {
    renderForm({ lost: true, port: 'closed' })
    expect(screen.getByRole('region', { name: 'What if…' })).toBeInTheDocument()
    const toggle = screen.getByRole('switch', { name: 'Lose the first SYN' })
    expect(toggle).toBeChecked()
    expect(toggle).toHaveAccessibleDescription('The SYN never arrives.')
    expect(screen.getByRole('group', { name: 'Server port' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Server port' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Closed' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Open' })).not.toBeChecked()
  })

  it('操作すると onChange を呼ぶ', async () => {
    const user = userEvent.setup()
    const { onChange } = renderForm({ lost: false, port: 'open' })
    await user.click(screen.getByRole('switch', { name: 'Lose the first SYN' }))
    expect(onChange).toHaveBeenLastCalledWith('lost', true)
    await user.click(screen.getByRole('radio', { name: 'Closed' }))
    expect(onChange).toHaveBeenLastCalledWith('port', 'closed')
  })

  it('日本語で表示する', () => {
    renderForm({ lost: false, port: 'open' }, 'ja')
    expect(screen.getByRole('region', { name: 'もしも…' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '閉じている' })).toBeInTheDocument()
  })

  it('オプションがなければ何も表示しない', () => {
    const { container } = render(
      <LocaleProvider locale="en">
        <ScenarioOptionsForm optionDefs={{}} options={{}} onChange={vi.fn()} />
      </LocaleProvider>,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
