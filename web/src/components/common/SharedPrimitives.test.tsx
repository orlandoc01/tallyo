import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { DottedBar } from './DottedBar'
import { PillTabs } from './PillTabs'

describe('DottedBar', () => {
  it('clamps the fill width to 0–100%', () => {
    const { container, rerender } = render(<DottedBar color="#30a46c" percent={140} />)
    const fill = () => (container.firstChild as HTMLDivElement).firstChild as HTMLDivElement
    expect(fill().style.width).toBe('100%')
    rerender(<DottedBar color="#30a46c" percent={-5} />)
    expect(fill().style.width).toBe('0%')
    rerender(<DottedBar color="#30a46c" height={6} percent={42.5} />)
    expect(fill().style.width).toBe('42.5%')
    expect((container.firstChild as HTMLDivElement).style.height).toBe('6px')
  })
})

describe('PillTabs', () => {
  it('renders buttons with badges and reports selection', async () => {
    const onChange = vi.fn()
    render(<PillTabs ariaLabel="Views" tabs={[{ value: 'a', label: 'Alpha', badge: 3 }, { value: 'b', label: 'Beta' }]} value="a" onChange={onChange} />)
    const alpha = screen.getByRole('tab', { name: /Alpha/ })
    expect(alpha).toHaveAttribute('aria-selected', 'true')
    expect(alpha).toHaveTextContent('3')
    await userEvent.click(screen.getByRole('tab', { name: 'Beta' }))
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('renders links inside a track when tabs carry routes', () => {
    render(
      <MemoryRouter initialEntries={['/x/b']}>
        <PillTabs ariaLabel="Views" tabs={[{ value: 'a', label: 'Alpha', to: '/x/a' }, { value: 'b', label: 'Beta', to: '/x/b' }]} value="b" variant="track" />
      </MemoryRouter>,
    )
    const beta = screen.getByRole('tab', { name: 'Beta' })
    expect(beta).toHaveAttribute('href', '/x/b')
    expect(beta).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tablist')).toHaveClass('bg-surface-2')
  })
})
