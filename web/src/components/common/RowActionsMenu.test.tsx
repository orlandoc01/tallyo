import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RowActionsMenu } from './RowActionsMenu'

const mockViewport = vi.hoisted(() => ({ isMobile: false }))

vi.mock('../../hooks/useIsMobile', () => ({
  useIsMobile: () => mockViewport.isMobile,
}))

afterEach(() => {
  mockViewport.isMobile = false
})

function Harness({ onRename }: { onRename: () => void }) {
  return (
    <RowActionsMenu
      ariaLabel="Open actions for Chase"
      hero={<p>Chase · 3 accounts</p>}
      isOpen
      items={[{ label: 'Rename', onSelect: onRename }, { label: 'Delete', destructive: true, disabled: true, title: 'Delete accounts first', onSelect: vi.fn() }]}
      onToggle={vi.fn()}
      title="Connection"
    />
  )
}

describe('RowActionsMenu', () => {
  it('renders an anchored dropdown on desktop', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    render(<Harness onRename={onRename} />)

    const popover = screen.getByRole('dialog', { name: 'Open actions for Chase' })
    expect(popover).toHaveClass('absolute')
    expect(within(popover).queryByText('Chase · 3 accounts')).not.toBeInTheDocument()
    expect(within(popover).getByRole('button', { name: 'Delete' })).toBeDisabled()
    expect(within(popover).getByRole('button', { name: 'Delete' })).toHaveAttribute('title', 'Delete accounts first')
    await user.click(within(popover).getByRole('button', { name: 'Rename' }))
    expect(onRename).toHaveBeenCalledOnce()
  })

  it('renders a bottom action sheet with a hero on mobile', async () => {
    mockViewport.isMobile = true
    const user = userEvent.setup()
    const onRename = vi.fn()
    render(<Harness onRename={onRename} />)

    const sheet = screen.getByRole('dialog', { name: 'Connection' })
    expect(sheet).toHaveClass('bg-overlay')
    expect(within(sheet).getByText('Chase · 3 accounts')).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Delete' })).toBeDisabled()
    expect(within(sheet).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Rename' }))
    expect(onRename).toHaveBeenCalledOnce()
  })
})
