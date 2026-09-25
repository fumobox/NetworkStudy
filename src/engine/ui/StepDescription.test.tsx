import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LocaleProvider } from '@/lib/i18n'
import { StepDescription } from './StepDescription'

describe('StepDescription', () => {
  it('現在のロケールでタイトルと解説を表示し、読み上げ対象にする', () => {
    render(
      <LocaleProvider locale="ja">
        <StepDescription
          step={{
            id: 'syn',
            title: { en: 'Client sends SYN', ja: 'クライアントが SYN を送る' },
            description: { en: 'desc', ja: '接続の開始を要求する。' },
            events: [],
          }}
        />
      </LocaleProvider>,
    )
    expect(screen.getByRole('heading', { name: 'クライアントが SYN を送る' })).toBeInTheDocument()
    expect(screen.getByText('接続の開始を要求する。').closest('section')).toHaveAttribute(
      'aria-live',
      'polite',
    )
  })

  it('ステップがなければ何も表示しない', () => {
    const { container } = render(
      <LocaleProvider locale="en">
        <StepDescription step={undefined} />
      </LocaleProvider>,
    )
    expect(container.querySelector('h2')).toBeNull()
  })
})
