import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BulkDeleteTransactionsModal } from './BulkDeleteTransactionsModal'

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }))

describe('BulkDeleteTransactionsModal on mobile', () => {
  it('confirms or cancels from the footer', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onConfirm = vi.fn()
    render(<BulkDeleteTransactionsModal onClose={onClose} onConfirm={onConfirm} selectedCount={4} />)

    const sheet = screen.getByRole('dialog', { name: 'Delete transactions' })
    expect(within(sheet).getByText('This will delete 4 selected transactions.')).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
    await user.click(within(sheet).getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('locks the sheet while deleting and shows errors', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<BulkDeleteTransactionsModal error="Nope" onClose={onClose} onConfirm={vi.fn()} selectedCount={4} submitting />)

    expect(screen.getByText('Nope')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled()
    await user.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
