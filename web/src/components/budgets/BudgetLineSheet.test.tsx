import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { categories } from '../../mocks/fixtures'
import { captureMutation, mockGraphqlError } from '../../test/msw'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import type { BudgetLine } from '../../types/graphql'
import { BudgetLineRow } from './BudgetLineRow'
import { BudgetLineSheet } from './BudgetLineSheet'

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }))

const line: BudgetLine = { __typename: 'BudgetLine', id: 'budget-1', category: categories[0], budgeted: 400, actual: 250, remaining: 150 }

describe('BudgetLineSheet', () => {
  it('shows the line and saves a changed planned amount', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onClose = vi.fn()
    render(<BudgetLineSheet line={line} monthLabel="June 2026" onClose={onClose} onSave={onSave} />, { wrapper: GraphqlTestProvider })

    const sheet = screen.getByRole('dialog', { name: 'Budget' })
    expect(within(sheet).getByText(`${categories[0].groupName} · June 2026`)).toBeInTheDocument()
    expect(within(sheet).getByText('63% of $400.00')).toBeInTheDocument()
    within(sheet).getAllByText('$250.00').forEach((amount) => expect(amount).toHaveClass('text-positive'))

    await user.click(within(sheet).getByRole('button', { name: /^planned/i }))
    const input = within(sheet).getByRole('spinbutton', { name: 'Planned' })
    await user.clear(input)
    await user.type(input, '500')
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledWith(500)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('removes the budget from the title action', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const deleteBudget = captureMutation<{ id: string }>('DeleteBudget', { deleteBudget: { __typename: 'DeleteBudgetPayload', success: true } })
    render(<BudgetLineSheet line={line} monthLabel="June 2026" onClose={onClose} onSave={vi.fn()} />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getByRole('button', { name: 'Remove budget' }))

    await waitFor(() => expect(deleteBudget.input).toEqual({ id: 'budget-1' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('opens from the planned amount on a mobile budget row', async () => {
    const user = userEvent.setup()
    render(<BudgetLineRow editable line={line} monthLabel="June 2026" onSave={vi.fn()} saving={false} transactionLinkTo="/transactions" />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getByRole('button', { name: `Edit budget for ${categories[0].name}` }))

    expect(screen.getByRole('dialog', { name: 'Budget' })).toBeInTheDocument()
    expect(screen.queryByLabelText(`Budget amount for ${categories[0].name}`)).not.toBeInTheDocument()
  })

  it('keeps Save disabled for invalid or negative amounts and hides Remove without a budget id', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<BudgetLineSheet line={{ ...line, id: null }} monthLabel="June 2026" onClose={vi.fn()} onSave={onSave} />, { wrapper: GraphqlTestProvider })

    expect(screen.queryByRole('button', { name: 'Remove budget' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^planned/i }))
    const input = screen.getByRole('spinbutton', { name: 'Planned' })
    await user.clear(input)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.type(input, '-5')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('shows the delete error and stays open', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    mockGraphqlError('DeleteBudget', 'Budget is locked', { kind: 'mutation' })
    render(<BudgetLineSheet line={line} monthLabel="June 2026" onClose={onClose} onSave={vi.fn()} />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getByRole('button', { name: 'Remove budget' }))

    expect(await screen.findByText(/Budget is locked/)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})
