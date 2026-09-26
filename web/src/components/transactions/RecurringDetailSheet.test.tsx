import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { recurringCharges } from '../../mocks/fixtures'
import { mockQuery } from '../../test/msw'
import { LocationDisplay, renderWithProviders } from '../../test/renderWithProviders'
import { RecurringPage } from '../../pages/RecurringPage'
import { RecurringDetailSheet } from './RecurringDetailSheet'

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }))

describe('RecurringDetailSheet', () => {
  it('renders the recurring stream as static rows', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onViewTransactions = vi.fn()
    renderWithProviders(<RecurringDetailSheet charge={recurringCharges[1]} onClose={onClose} onViewTransactions={onViewTransactions} />)

    const sheet = screen.getByRole('dialog', { name: 'Recurring' })
    expect(within(sheet).getByRole('region', { name: 'Details for Employer Direct Deposit' })).toBeInTheDocument()
    expect(within(sheet).getByText('+$3,100.00')).toHaveClass('text-positive')
    expect(within(sheet).getByText('Biweekly')).toBeInTheDocument()
    expect(within(sheet).getByText('Sep 10, 2026')).toBeInTheDocument()
    expect(within(sheet).getByText(recurringCharges[1].category!.name)).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'View transactions' }))
    expect(onViewTransactions).toHaveBeenCalledWith(recurringCharges[1])
    await user.click(within(sheet).getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('opens from a recurring row on mobile and links to the merchant transactions', async () => {
    const user = userEvent.setup()
    mockQuery('RecurringCharges', { recurringCharges: { __typename: 'RecurringChargeList', items: [{ ...recurringCharges[0], transactions: [] }] } })
    renderWithProviders(<RecurringPage />, { auth: { scopes: ['read:transactions'] }, probes: <LocationDisplay />, withGraphql: true, withMobileHeader: true })

    await user.click((await screen.findAllByRole('button', { name: 'View details for Netflix' }))[0])
    const sheet = await screen.findByRole('dialog', { name: 'Recurring' })
    expect(within(sheet).getByText('Monthly')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/')

    await user.click(within(sheet).getByRole('button', { name: 'View transactions' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/transactions?merchant_prefix=Netflix')
  })
})
