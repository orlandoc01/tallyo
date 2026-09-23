import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeTransactionForGraphql, recurringCharges } from '../mocks/fixtures'
import { mockQuery } from '../test/msw'
import { LocationDisplay, renderWithProviders } from '../test/renderWithProviders'
import type { RecurringCharge } from '../types/graphql'
import { RecurringPage } from './RecurringPage'

function renderPage() {
  return renderWithProviders(<RecurringPage />, { auth: { scopes: ['read:transactions'] }, probes: <LocationDisplay />, withGraphql: true, withMobileHeader: true })
}

function mockCharges(items: RecurringCharge[]) {
  mockQuery('RecurringCharges', { recurringCharges: { __typename: 'RecurringChargeList', items: items.map((charge) => ({ ...charge, transactions: charge.transactions.map(normalizeTransactionForGraphql) })) } })
}

describe('RecurringPage', () => {
  afterEach(() => vi.useRealTimers())

  it('renders one cadence card per interval with totals, in fixed order', async () => {
    renderPage()

    expect(await screen.findAllByText('Netflix')).toHaveLength(2)
    const cadences = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(cadences).toEqual(['Biweekly', 'Monthly', 'Irregular'])
    expect(screen.getByText('1 item · +$3,100.00 / cycle')).toBeInTheDocument()
    expect(screen.getByText('1 item · $19.99 / cycle')).toBeInTheDocument()
    expect(screen.getByText('Early detection')).toBeInTheDocument()
    expect(screen.getByText('Sep 10, 2026')).toBeInTheDocument()
  })

  it('computes the monthly and next-7-days stats from the fixed clock', async () => {
    vi.useFakeTimers({ now: new Date(2026, 8, 20, 12), toFake: ['Date'] })
    renderPage()

    await screen.findAllByText('Netflix')
    expect(screen.getAllByText('Monthly recurring expenses')).not.toHaveLength(0)
    expect(screen.getAllByText('$19.99')).not.toHaveLength(0)
    expect(screen.getAllByText('+$6,716.67')).not.toHaveLength(0)
    expect(screen.getAllByText('$3,100.00 · 1 item')).not.toHaveLength(0)
  })

  it('links a row to the transactions page filtered by merchant', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click((await screen.findAllByRole('button', { name: 'View transactions for Employer Direct Deposit' }))[0])
    expect(screen.getByTestId('location')).toHaveTextContent('/transactions?merchant_prefix=Employer+Direct+Deposit')
  })

  it('shows placeholders for uncategorised charges and charges without transactions, and skips inactive ones', async () => {
    mockCharges([{ ...recurringCharges[2], isActive: false }, { ...recurringCharges[0], category: null, transactions: [] }])
    renderPage()

    await screen.findAllByText('Netflix')
    expect(screen.queryByText('Cloudflare')).not.toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(3)
  })

  it('nets income and expense rows within one cadence and tones the total by sign', async () => {
    mockCharges([recurringCharges[0], { ...recurringCharges[1], interval: 'MONTHLY' }])
    renderPage()

    await screen.findAllByText('Netflix')
    expect(screen.getByText('2 items · +$3,080.01 / cycle')).toBeInTheDocument()
    expect(within(screen.getAllByRole('button', { name: 'View transactions for Employer Direct Deposit' })[0]).getByText('+$3,100.00')).toHaveClass('text-positive')
    expect(within(screen.getAllByRole('button', { name: 'View transactions for Netflix' })[0]).getByText('$19.99')).toHaveClass('text-text-2')
  })

  it('shows empty state when no recurring groups exist', async () => {
    mockCharges([])
    renderPage()

    expect(await screen.findByText('No recurring charges detected')).toBeInTheDocument()
    expect(screen.queryByText('Netflix')).not.toBeInTheDocument()
  })
})
