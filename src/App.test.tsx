import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from '@/App'

describe('App', () => {
  it('サイト名と開始ボタンを表示する', () => {
    render(<App />)
    expect(screen.getByText('NetworkStudy')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Get started' })).toBeEnabled()
  })
})
