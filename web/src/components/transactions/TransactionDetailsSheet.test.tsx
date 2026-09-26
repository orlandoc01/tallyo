import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { categories, normalizeTransactionForGraphql, transactions } from '../../mocks/fixtures'
import { usePermissions } from '../../hooks/usePermissions'
import { allowAllPermissionResult } from '../../test/permissions'
import { captureMutation, mockGraphqlError, mockMutation } from '../../test/msw'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import { TransactionDetailsSheet } from './TransactionDetailsSheet'

vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

afterEach(() => {
  vi.mocked(usePermissions).mockReturnValue(allowAllPermissionResult)
  vi.restoreAllMocks()
})

const transaction = normalizeTransactionForGraphql(transactions[0])

function renderSheet(overrides: Partial<Parameters<typeof TransactionDetailsSheet>[0]> = {}) {
  const onClose = vi.fn()
  const onUpdate = vi.fn()
  render(<TransactionDetailsSheet categories={categories} onClose={onClose} onUpdate={onUpdate} titleId="txn-title" transaction={transaction} {...overrides} />, { wrapper: GraphqlTestProvider })
  return { onClose, onUpdate }
}

describe('TransactionDetailsSheet', () => {
  it('renders the hero, rows and foot for a transaction', () => {
    renderSheet()

    const region = screen.getByRole('region', { name: /details for target/i })
    expect(screen.getByRole('dialog', { name: 'Details' })).toHaveClass('bg-overlay')
    expect(within(region).getAllByText('Target').length).toBeGreaterThan(0)
    expect(within(region).getByText('Owner')).toBeInTheDocument()
    expect(within(region).getByText('Reviewed')).toBeInTheDocument()
    expect(within(region).getByText(transaction.id)).toHaveClass('font-mono')
    expect(screen.getByRole('button', { name: 'Create rule' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close filters' })).not.toBeInTheDocument()
  })

  it('stages merchant, category, tags and toggles and saves them in one mutation', async () => {
    const user = userEvent.setup()
    const updateTransaction = captureMutation<{ id: string; updates: Record<string, unknown> }>('UpdateTransaction', {
      updateTransaction: { __typename: 'UpdateTransactionPayload', transaction: { ...transaction, merchantName: 'Target Express', isHidden: true } },
    })
    const { onClose, onUpdate } = renderSheet()

    await user.click(screen.getByRole('button', { name: /^merchant/i }))
    const merchantInput = screen.getByRole('textbox', { name: 'Merchant' })
    await user.clear(merchantInput)
    await user.type(merchantInput, 'Target Express')
    expect(screen.getByRole('button', { name: /^merchant/i })).toHaveTextContent('Target Express')

    await user.click(screen.getByRole('button', { name: /^category/i }))
    await user.click(screen.getByRole('radio', { name: categories[1].name }))
    expect(screen.queryByRole('radio', { name: categories[1].name })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^tags/i }))
    await user.click(await screen.findByRole('checkbox', { name: 'Travel' }))
    await user.click(screen.getByRole('switch', { name: 'Hidden' }))
    expect(updateTransaction.called).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateTransaction.calls).toBe(1))
    expect(updateTransaction.input).toEqual({
      id: transaction.id,
      updates: { merchantName: 'Target Express', categoryId: categories[1].id, tagIds: [...transaction.tags.map((tag) => tag.id), 'tag-2'], isHidden: true },
    })
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ merchantName: 'Target Express' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes without a mutation when nothing changed', async () => {
    const user = userEvent.setup()
    const updateTransaction = captureMutation('UpdateTransaction', { updateTransaction: { __typename: 'UpdateTransactionPayload', transaction } })
    const { onClose } = renderSheet()

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(updateTransaction.called).toBe(false)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('deletes after confirmation', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const deleteTransaction = captureMutation('DeleteTransaction', { deleteTransaction: { __typename: 'DeleteTransactionPayload', success: true } })
    const onDelete = vi.fn()
    renderSheet({ onDelete })

    await user.click(screen.getByRole('button', { name: 'Delete transaction' }))

    await waitFor(() => expect(deleteTransaction.called).toBe(true))
    expect(onDelete).toHaveBeenCalledWith(transaction.id)
  })

  it('hides editing affordances without write access', () => {
    vi.mocked(usePermissions).mockReturnValue({ canRead: () => true, canWrite: () => false, hasScope: () => true })
    renderSheet()

    expect(screen.queryByRole('button', { name: 'Create rule' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete transaction' })).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Hidden' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
  })

  it('keeps the sheet open and shows the error when saving fails', async () => {
    const user = userEvent.setup()
    mockGraphqlError('UpdateTransaction', 'Could not update transaction', { kind: 'mutation' })
    const { onClose } = renderSheet()

    await user.click(screen.getByRole('switch', { name: 'Hidden' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/Could not update transaction/)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('surfaces delete failures and a not-found result', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onDelete = vi.fn()
    mockGraphqlError('DeleteTransaction', 'Could not delete', { kind: 'mutation' })
    const { unmount } = render(<TransactionDetailsSheet categories={categories} onClose={vi.fn()} onDelete={onDelete} titleId="txn-title" transaction={transaction} />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getByRole('button', { name: 'Delete transaction' }))
    expect(await screen.findByText(/Could not delete/)).toBeInTheDocument()
    expect(onDelete).not.toHaveBeenCalled()
    unmount()

    mockMutation('DeleteTransaction', { deleteTransaction: { __typename: 'DeleteTransactionPayload', success: false } })
    render(<TransactionDetailsSheet categories={categories} onClose={vi.fn()} onDelete={onDelete} titleId="txn-title" transaction={transaction} />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getByRole('button', { name: 'Delete transaction' }))
    expect(await screen.findByText('Transaction was not found.')).toBeInTheDocument()
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('shows a Posted row when the posted datetime differs and offers the merchant link', async () => {
    const user = userEvent.setup()
    const onShowMerchant = vi.fn()
    renderSheet({ onShowMerchant, transaction: { ...transaction, postedDatetime: '2026-05-16T12:00:00Z' } })

    expect(screen.getByText('Posted', { selector: 'span.shrink-0' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show transactions for this merchant →' }))
    expect(onShowMerchant).toHaveBeenCalledWith('Target')
  })

  it('does not offer the merchant link when there is no merchant name', () => {
    renderSheet({ onShowMerchant: vi.fn(), transaction: { ...transaction, merchantName: null } })
    expect(screen.queryByRole('button', { name: /show transactions for this merchant/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Posted', { selector: 'span.shrink-0' })).not.toBeInTheDocument()
  })

  it('shows a read-only category panel without write access', async () => {
    vi.mocked(usePermissions).mockReturnValue({ canRead: () => true, canWrite: () => false, hasScope: () => true })
    const user = userEvent.setup()
    renderSheet()

    await user.click(screen.getByRole('button', { name: /^category/i }))
    expect(screen.getByText('Read only.')).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })
})
