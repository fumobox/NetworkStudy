import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useHorizontalOverflow } from './useHorizontalOverflow'

function Probe() {
  const { ref, overflowing } = useHorizontalOverflow<HTMLDivElement>()
  return (
    <div ref={ref} data-testid="box">
      <span>{overflowing ? 'overflowing' : 'fits'}</span>
    </div>
  )
}

describe('useHorizontalOverflow', () => {
  it('中身が幅より広いときだけ true', () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(500)
    const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300)
    render(<Probe />)
    expect(screen.getByText('overflowing')).toBeInTheDocument()
    scroll.mockRestore()
    client.mockRestore()
  })

  it('収まっていれば false', () => {
    render(<Probe />)
    expect(screen.getByText('fits')).toBeInTheDocument()
  })
})
