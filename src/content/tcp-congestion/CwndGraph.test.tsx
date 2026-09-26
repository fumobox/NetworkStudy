import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { deriveState } from '@/engine/derive'
import { LocaleProvider, type Locale } from '@/lib/i18n'
import { CwndGraph } from './CwndGraph'
import { tcpCongestionScenario, type LossMode } from './scenario'

function renderGraph(loss: LossMode, stepId: string, locale: Locale = 'en') {
  const steps = tcpCongestionScenario.buildSteps({ loss })
  const index = stepId === 'last' ? steps.length - 1 : steps.findIndex((step) => step.id === stepId)
  const derived = deriveState(tcpCongestionScenario.actors, steps, index)
  render(
    <LocaleProvider locale={locale}>
      <CwndGraph derived={derived} options={{ loss }} />
    </LocaleProvider>,
  )
}

describe('CwndGraph', () => {
  it('まだラウンドがなければ、その旨を表示する', () => {
    renderGraph('none', 'start')
    expect(screen.getByText('No round has been sent yet.')).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('グラフは cwnd の列を読み上げ、同じ数値を表でも読める', () => {
    renderGraph('rto', 'last')
    expect(
      screen.getByRole('img', { name: 'cwnd by round: 1, 2, 4, 8, 1, 2, 4' }),
    ).toBeInTheDocument()
    const rows = within(screen.getByRole('table', { name: 'cwnd and ssthresh in each round' }))
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent)
    expect(rows).toEqual([
      '118Slow start',
      '228Slow start',
      '348Slow start',
      '488RTO expired',
      '514Slow start',
      '624Slow start',
      '744Congestion avoidance',
    ])
  })

  it('ロスを検出したラウンドに印を付ける（日本語）', () => {
    renderGraph('dupack', 'last', 'ja')
    const graph = screen.getByRole('img', { name: 'ラウンドごとの cwnd: 1、2、4、8、3、4' })
    expect(within(graph).getAllByText('✕')).toHaveLength(1)
    expect(screen.getByText('重複 ACK が 3 つ（高速再送）')).toBeInTheDocument()
  })

  it('軸の範囲は、ステップを進めても変わらない（そのシナリオの最後までの値で決める）', () => {
    renderGraph('none', 'round-1')
    const first = screen.getByRole('img')
    // x 軸にはシナリオの最後までの 6 ラウンドの目盛りがある
    expect(
      within(first)
        .getAllByText(/^[1-6]$/)
        .filter((element) => element.getAttribute('text-anchor') === 'middle'),
    ).toHaveLength(6)
  })
})
