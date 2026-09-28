import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { categories } from '../../mocks/fixtures'
import { captureMutation } from '../../test/msw'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import { BudgetAddModal } from './BudgetAddModal'

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }))

describe('BudgetAddModal on mobile', () => {
  it('renders the sheet with category and amount rows', () => {
    render(<BudgetAddModal categories={categories} month="2026-05" onClose={vi.fn()} onSaved={vi.fn()} />, { wrapper: GraphqlTestProvider })

    const sheet = screen.getByRole('dialog', { name: 'Add budget' })
    expect(within(sheet).queryByRole('button', { name: 'Close filters' })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /^category/i })).toHaveTextContent('🍏 Groceries')
    expect(within(sheet).getByRole('button', { name: /^amount/i })).toHaveTextContent('0.00')
    expect(within(sheet).getByRole('button', { name: 'Save budget' })).toBeDisabled()
  })

  it('picks a category, enters an amount and saves the budget', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    const setBudget = captureMutation<{ month: string; categoryId: string; amount: number }>('SetBudget', {
      setBudget: { __typename: 'SetBudgetPayload', budget: { __typename: 'Budget', id: 'b-1', month: '2026-05', amount: 250, category: categories[1] } },
    })
    render(<BudgetAddModal categories={categories} month="2026-05" onClose={vi.fn()} onSaved={onSaved} />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getByRole('button', { name: /^category/i }))
    await user.click(screen.getByRole('radio', { name: 'Restaurants & Bars' }))
    expect(screen.getByRole('button', { name: /^category/i })).toHaveTextContent('🍽️ Restaurants & Bars')
    await user.click(screen.getByRole('button', { name: /^amount/i }))
    await user.type(screen.getByRole('spinbutton', { name: 'Amount' }), '250')
    await user.click(screen.getByRole('button', { name: 'Save budget' }))

    await waitFor(() => expect(setBudget.input).toEqual({ month: '2026-05', categoryId: '2', amount: 250 }))
    expect(onSaved).toHaveBeenCalledOnce()
  })
})
