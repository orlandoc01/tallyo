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
    render(<table><tbody><TransactionRow transaction={transactions[0]} /></tbody></table>)

    expect(screen.getByText('Target')).toBeInTheDocument()
    expect(screen.getByText('🍏 Groceries')).toBeInTheDocument()
    expect(screen.getByText('Checking (...9625)')).toBeInTheDocument()
    expect(screen.getByText('$62.30')).toBeInTheDocument()
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
  })

  it('renders credits with a plus prefix and hidden badge', () => {
    render(<table><tbody><TransactionRow transaction={transactions[1]} /></tbody></table>)

    expect(screen.getByText('+$52.12')).toBeInTheDocument()
    expect(screen.getByText('Hidden')).toBeInTheDocument()
  })

  it('italicizes pending amounts but leaves posted amounts upright', () => {
    const pendingTransaction = { ...transactions[0], pending: true }
    const { rerender } = render(<table><tbody><TransactionRow transaction={pendingTransaction} /></tbody></table>)

    expect(screen.getByText('$62.30')).toHaveClass('italic')

    rerender(<table><tbody><TransactionRow transaction={transactions[0]} /></tbody></table>)
    expect(screen.getByText('$62.30')).not.toHaveClass('italic')
  })

  it('italicizes pending amounts in mobile rows', () => {
    render(<MobileTransactionRow transaction={{ ...transactions[0], pending: true }} />)

    expect(screen.getByText('$62.30')).toHaveClass('italic')
  })

  it('hides the owner icon when requested', () => {
    mockAuth.hideOwners = true

    render(<table><tbody><TransactionRow transaction={transactions[0]} /></tbody></table>)

    expect(screen.getByText('Checking (...9625)')).toBeInTheDocument()
    expect(screen.queryByText(transactions[0].account.owner.name.charAt(0))).not.toBeInTheDocument()
  })

  it('falls back to merchant initial when logo image fails to load', () => {
    const transaction = { ...transactions[0], logoUrl: 'https://example.com/favicon.ico' }
    render(<table><tbody><TransactionRow transaction={transaction} /></tbody></table>)

    fireEvent.error(screen.getByRole('img', { name: 'Target' }))

    expect(screen.queryByRole('img', { name: 'Target' })).not.toBeInTheDocument()
    expect(screen.getByText('T')).toBeInTheDocument()
  })

  it('notifies when the row is clicked', async () => {
    const user = userEvent.setup()
    const onDetailsOpen = vi.fn()

    render(<table><tbody><TransactionRow onDetailsOpen={onDetailsOpen} transaction={transactions[0]} /></tbody></table>)

    await user.click(screen.getByText('Target'))

    expect(onDetailsOpen).toHaveBeenCalledWith(transactions[0])
  })

  it('opens category dropdown and notifies on selection', async () => {
    const user = userEvent.setup()
    const onCategoryChange = vi.fn()

    render(
      <table>
        <tbody>
          <TransactionRow categories={categories} onCategoryChange={onCategoryChange} transaction={transactions[0]} />
        </tbody>
      </table>,
    )

    const categoryButton = screen.getByRole('button', { name: /groceries/i })
    await user.click(categoryButton)

    expect(categoryButton).toHaveClass('whitespace-nowrap')
    expect(screen.getByPlaceholderText(/search categories/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /restaurants/i }))

    expect(onCategoryChange).toHaveBeenCalledWith(transactions[0], categories[1])
  })

  it('renders (CLOSED) suffix for closed accounts', () => {
    const closedTransaction = { ...transactions[0], account: accounts[1] }
    render(<table><tbody><TransactionRow transaction={closedTransaction} /></tbody></table>)

    expect(screen.getByText(/\(CLOSED\)/)).toBeInTheDocument()
  })
})
