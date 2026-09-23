import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { accounts, categories, transactions } from '../../mocks/fixtures'
import { MobileTransactionRow, TransactionRow } from './TransactionRow'

const mockAuth = vi.hoisted(() => ({ hideOwners: false }))

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => mockAuth,
}))

afterEach(() => {
  mockAuth.hideOwners = false
})

describe('TransactionRow', () => {
  it('renders merchant, category, account, and amount', () => {
    render(<TransactionRow transaction={transactions[0]} />)

    expect(screen.getByText('Target')).toBeInTheDocument()
    expect(screen.getByText('Groceries')).toBeInTheDocument()
    expect(screen.getByText('Checking (...9625)')).toBeInTheDocument()
    expect(screen.getByText('· Depository')).toBeInTheDocument()
    expect(screen.getByText('$62.30')).toHaveClass('italic', 'text-text-2')
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
    expect(screen.queryByText('Pending')).not.toBeInTheDocument()
  })

  it('renders credits with a plus prefix and hidden badge', () => {
    render(<TransactionRow transaction={transactions[1]} />)

    expect(screen.getByText('+$52.12')).toHaveClass('text-positive')
    expect(screen.getByText('Hidden')).toBeInTheDocument()
  })

  it('marks pending transactions with a badge', () => {
    render(<TransactionRow transaction={{ ...transactions[0], pending: true }} />)

    expect(screen.getByText('Pending')).toBeInTheDocument()
  })

  it('renders italic amounts in mobile rows', () => {
    render(<MobileTransactionRow transaction={transactions[0]} />)

    expect(screen.getByText('$62.30')).toHaveClass('italic')
    expect(screen.getByText('Checking (...9625)')).toBeInTheDocument()
  })

  it('hides the owner icon when requested', () => {
    mockAuth.hideOwners = true

    render(<TransactionRow transaction={transactions[0]} />)

    expect(screen.getByText('Checking (...9625)')).toBeInTheDocument()
    expect(screen.queryByText(transactions[0].account.owner.name.charAt(0).toUpperCase())).not.toBeInTheDocument()
  })

  it('falls back to merchant initial when logo image fails to load', () => {
    const transaction = { ...transactions[0], logoUrl: 'https://example.com/favicon.ico' }
    render(<TransactionRow transaction={transaction} />)

    fireEvent.error(screen.getByRole('img', { name: 'Target' }))

    expect(screen.queryByRole('img', { name: 'Target' })).not.toBeInTheDocument()
    expect(screen.getByText('T')).toBeInTheDocument()
  })

  it('notifies when the row is clicked', async () => {
    const user = userEvent.setup()
    const onDetailsOpen = vi.fn()

    render(<TransactionRow onDetailsOpen={onDetailsOpen} transaction={transactions[0]} />)

    await user.click(screen.getByText('Target'))

    expect(onDetailsOpen).toHaveBeenCalledWith(transactions[0])
  })

  it('opens details from the keyboard', async () => {
    const user = userEvent.setup()
    const onDetailsOpen = vi.fn()

    render(<TransactionRow onDetailsOpen={onDetailsOpen} transaction={transactions[0]} />)

    screen.getByRole('button', { name: 'View details for Target' }).focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')

    expect(onDetailsOpen).toHaveBeenCalledTimes(2)
  })

  it('toggles selection instead of opening details in bulk mode', async () => {
    const user = userEvent.setup()
    const onDetailsOpen = vi.fn()
    const onToggleSelect = vi.fn()

    render(<TransactionRow isBulkMode onDetailsOpen={onDetailsOpen} onToggleSelect={onToggleSelect} transaction={transactions[0]} />)

    await user.click(screen.getByRole('checkbox', { name: 'Select transaction for Target' }))
    expect(onToggleSelect).toHaveBeenCalledWith('txn-1')
    expect(onDetailsOpen).not.toHaveBeenCalled()
  })

  it('opens category dropdown and notifies on selection', async () => {
    const user = userEvent.setup()
    const onCategoryChange = vi.fn()

    render(<TransactionRow categories={categories} onCategoryChange={onCategoryChange} transaction={transactions[0]} />)

    const categoryButton = screen.getByRole('button', { name: /groceries/i })
    await user.click(categoryButton)

    expect(categoryButton).toHaveClass('whitespace-nowrap')
    expect(screen.getByPlaceholderText(/search categories/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /restaurants/i }))

    expect(onCategoryChange).toHaveBeenCalledWith(transactions[0], categories[1])
  })

  it('renders (CLOSED) suffix for closed accounts', () => {
    const closedTransaction = { ...transactions[0], account: accounts[1] }
    render(<TransactionRow transaction={closedTransaction} />)

    expect(screen.getByText(/\(CLOSED\)/)).toBeInTheDocument()
  })
})
