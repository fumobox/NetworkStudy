import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '@/lib/i18n'
import { createPlayerState, type PlayerState } from '../player'
import { StepControls } from './StepControls'

function renderControls(state: PlayerState) {
  const dispatch = vi.fn()
  render(
    <LocaleProvider locale="en">
      <StepControls state={state} dispatch={dispatch} />
    </LocaleProvider>,
  )
  return { dispatch }
}

describe('StepControls', () => {
  it('ステップ番号を表示する（1 始まり）', () => {
    renderControls(createPlayerState(5, 2))
    expect(screen.getByText('Step 3 of 5')).toBeInTheDocument()
  })

  it('各ボタンでアクションを送る', async () => {
    const user = userEvent.setup()
    const { dispatch } = renderControls(createPlayerState(5, 2))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Play' }))
    await user.click(screen.getByRole('button', { name: 'Back to start' }))
    await user.click(screen.getByRole('button', { name: '2×' }))
    expect(dispatch.mock.calls.map(([action]: unknown[]) => action)).toEqual([
      { type: 'next' },
      { type: 'prev' },
      { type: 'togglePlay' },
      { type: 'jump', stepIndex: 0 },
      { type: 'setSpeed', speed: 2 },
    ])
  })

  it('最初のステップでは戻る操作、最後のステップでは次へを無効にする', () => {
    renderControls(createPlayerState(3, 0))
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back to start' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
  })

  it('最後のステップでは次へを無効にする', () => {
    renderControls(createPlayerState(3, 2))
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('再生中は一時停止ボタンになる', () => {
    renderControls({ ...createPlayerState(3), isPlaying: true })
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
  })

  it('現在の速度に aria-pressed を付ける', () => {
    renderControls({ ...createPlayerState(3), speed: 0.5 })
    expect(screen.getByRole('button', { name: '0.5×' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '1×' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('スライダーでステップにジャンプする', async () => {
    const user = userEvent.setup()
    const { dispatch } = renderControls(createPlayerState(5, 1))
    const slider = screen.getByRole('slider', { name: 'Step' })
    expect(slider).toHaveAttribute('aria-valuenow', '1')
    slider.focus()
    await user.keyboard('{ArrowRight}')
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'jump', stepIndex: 2 })
  })

  it('ステップが 1 つなら再生できず、スライダーも出さない', () => {
    renderControls(createPlayerState(1))
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled()
    expect(screen.queryByRole('slider')).toBeNull()
  })
})
