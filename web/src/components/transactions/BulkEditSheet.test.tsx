import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { categories, tags } from '../../mocks/fixtures'
import { BulkEditTransactionsModal } from './BulkEditTransactionsModal'

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }))

describe('BulkEditSheet', () => {
  it('activates sections with toggles and confirms only the active values', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<BulkEditTransactionsModal categories={categories} onClose={vi.fn()} onConfirm={onConfirm} selectedCount={3} tags={tags} />)

    const sheet = screen.getByRole('dialog', { name: 'Edit multiple' })
    expect(within(sheet).getByText('Update 3 selected transactions.')).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Close filters' })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Confirm' })).toBeDisabled()
    expect(within(sheet).queryByRole('radio', { name: 'Yes' })).not.toBeInTheDocument()

    await user.click(within(sheet).getByRole('switch', { name: 'Set hidden' }))
    await user.click(within(sheet).getByRole('radio', { name: 'Yes' }))
    await user.click(within(sheet).getByRole('switch', { name: 'Set tags' }))
    await user.click(within(sheet).getByRole('checkbox', { name: 'Travel' }))
    await user.click(within(sheet).getByRole('switch', { name: 'Replace notes' }))
    await user.type(within(sheet).getByPlaceholderText('Replace notes'), 'Shared memo')
    await user.click(within(sheet).getByRole('button', { name: 'Confirm' }))

    expect(onConfirm).toHaveBeenCalledWith({ notes: 'Shared memo', isHidden: true, tagIds: ['tag-2'] })
  })

  it('requires a category once the category section is active', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<BulkEditTransactionsModal categories={categories} onClose={vi.fn()} onConfirm={onConfirm} selectedCount={2} tags={tags} />)

    await user.click(screen.getByRole('switch', { name: 'Set category' }))
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: 'Groceries' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(onConfirm).toHaveBeenCalledWith({ categoryId: '1' })
  })

  it('cannot be dismissed while submitting', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<BulkEditTransactionsModal categories={categories} error="Boom" onClose={onClose} onConfirm={vi.fn()} selectedCount={2} submitting tags={tags} />)

    expect(screen.getByText('Boom')).toBeInTheDocument()
    await user.click(screen.getByRole('dialog'))
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })
})
