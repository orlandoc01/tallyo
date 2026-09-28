import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { accounts, categories, normalizeTransactionForGraphql, transactions } from '../../mocks/fixtures'
import { captureMutation } from '../../test/msw'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import { CreateTransactionModal } from './CreateTransactionModal'

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }))

describe('CreateTransactionSheet', () => {
  it('renders the sheet rows with the first visible account preselected', () => {
    render(<CreateTransactionModal accounts={accounts} categories={categories} onClose={vi.fn()} onCreated={vi.fn()} />, { wrapper: GraphqlTestProvider })

    const sheet = screen.getByRole('dialog', { name: 'New transaction' })
    expect(within(sheet).queryByRole('button', { name: 'Close filters' })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /^account/i })).toHaveTextContent('Checking')
    expect(within(sheet).getByRole('button', { name: /^category/i })).toHaveTextContent('Uncategorized')
    expect(within(sheet).getByRole('switch', { name: 'Hidden' })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Create transaction' })).toBeEnabled()
  })

  it('creates a transaction from the rows', async () => {
    const user = userEvent.setup()
    const onCreated = vi.fn()
    const createTransaction = captureMutation('CreateTransaction', {
      createTransaction: { __typename: 'CreateTransactionPayload', transaction: normalizeTransactionForGraphql({ ...transactions[0], id: 'manual-created' }) },
    })
    render(<CreateTransactionModal accounts={accounts} categories={categories} onClose={vi.fn()} onCreated={onCreated} />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getByRole('button', { name: /^account/i }))
    expect(screen.queryByRole('radio', { name: /secret fund/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /^savings/i }))
    await user.click(screen.getByRole('button', { name: /^date/i }))
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-05-22' } })
    await user.click(screen.getByRole('button', { name: /^amount/i }))
    await user.type(screen.getByRole('spinbutton', { name: 'Amount' }), '12.34')
    await user.click(screen.getByRole('button', { name: /^merchant/i }))
    await user.type(screen.getByRole('textbox', { name: 'Merchant' }), 'Manual Coffee')
    await user.click(screen.getByRole('button', { name: /^category/i }))
    await user.click(screen.getByRole('radio', { name: categories[1].name }))
    expect(screen.getByRole('button', { name: /^category/i })).toHaveTextContent(categories[1].name)
    await user.click(screen.getByRole('switch', { name: 'Recurring' }))
    await user.click(screen.getByRole('button', { name: 'Create transaction' }))

    await waitFor(() => expect(createTransaction.input).toEqual({
      accountId: accounts[1].id,
      date: '2026-05-22',
      amount: 12.34,
      merchantName: 'Manual Coffee',
      originalName: null,
      categoryId: categories[1].id,
      notes: null,
      isRecurring: true,
      isHidden: false,
    }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'manual-created' })))
  })

  it('shows validation errors inline and warns when no account exists', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<CreateTransactionModal accounts={accounts} categories={categories} onClose={vi.fn()} onCreated={vi.fn()} />, { wrapper: GraphqlTestProvider })
    await user.click(screen.getByRole('button', { name: /^date/i }))
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '' } })
    await user.click(screen.getByRole('button', { name: 'Create transaction' }))
    expect(await screen.findByText('Enter a date.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-05-22' } })
    await user.click(screen.getByRole('button', { name: 'Create transaction' }))
    expect(await screen.findByText('Enter a valid amount.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^amount/i }))
    await user.type(screen.getByRole('spinbutton', { name: 'Amount' }), '5')
    await user.click(screen.getByRole('button', { name: 'Create transaction' }))
    expect(await screen.findByText('Enter a merchant or original name.')).toBeInTheDocument()
    unmount()

    render(<CreateTransactionModal accounts={[]} categories={categories} onClose={vi.fn()} onCreated={vi.fn()} />, { wrapper: GraphqlTestProvider })
    expect(screen.getByText('Add an account before creating transactions.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create transaction' })).toBeDisabled()
  })
})
