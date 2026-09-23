import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router'
import { TransactionSelectionProvider } from '../components/transactions/TransactionSelectionProvider'
import { useIsMobile } from '../hooks/useIsMobile'
import { LocationSearch, renderWithProviders } from '../test/renderWithProviders'
import { TransactionsPage } from './TransactionsPage'

vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: vi.fn(() => false) }))

afterEach(() => {
  vi.mocked(useIsMobile).mockReturnValue(false)
  window.history.replaceState({}, '', '/')
})

function renderPage(initialEntry = '/transactions', router: 'memory' | 'browser' = 'memory') {
  if (router === 'browser') window.history.pushState({}, '', initialEntry)
  return renderWithProviders(
    <TransactionSelectionProvider>
      <Routes>
        <Route element={<TransactionsPage />} path="/transactions" />
        <Route element={<TransactionsPage />} path="/transactions/:transaction_id" />
      </Routes>
    </TransactionSelectionProvider>,
    { auth: { scopes: ['read:transactions', 'write:transactions'] }, initialEntries: [initialEntry], probes: <LocationSearch />, router, withGraphql: true, withMobileHeader: true },
  )
}

describe('TransactionsPage', () => {
  it('toggles the summary card from the header switch and the mobile button', async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findAllByText('Target')
    const summary = await screen.findByRole('complementary', { hidden: true, name: 'Transaction summary' })
    expect(summary.parentElement?.parentElement).toHaveClass('grid-rows-[0fr]')

    await user.click(screen.getByRole('switch', { name: 'Summary' }))
    expect(summary.parentElement?.parentElement).toHaveClass('grid-rows-[1fr]')
    expect(within(summary).getByText('Transactions')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Toggle summary' }))
    expect(summary.parentElement?.parentElement).toHaveClass('grid-rows-[0fr]')
  })

  it('shows active pills with the match count and removes filters from them', async () => {
    const user = userEvent.setup()
    renderPage('/transactions?category_ids=2&q=Chipotle')

    expect((await screen.findAllByText('2 of 10 transactions'))[0]).toBeInTheDocument()
    expect(screen.getAllByText('🍽️ Restaurants & Bars')).not.toHaveLength(0)
    expect(screen.getAllByText('“Chipotle”')).not.toHaveLength(0)

    await user.click(screen.getAllByRole('button', { name: 'Remove Category filter: 🍽️ Restaurants & Bars' })[0])
    await waitFor(() => expect(screen.queryByText('🍽️ Restaurants & Bars')).not.toBeInTheDocument())

    await user.click(screen.getAllByRole('button', { name: 'Remove Search filter: “Chipotle”' })[0])
    await waitFor(() => expect(screen.queryByText('“Chipotle”')).not.toBeInTheDocument())
    expect(screen.getByRole('textbox', { name: /search transactions/i })).toHaveValue('')
  })

  it('counts hidden transactions in the total once Show hidden is on', async () => {
    renderPage('/transactions?category_ids=1&is_hidden=1')

    expect((await screen.findAllByText('4 of 11 transactions'))[0]).toBeInTheDocument()
  })

  it('filters by merchant from the detail pane link', async () => {
    const user = userEvent.setup()
    renderPage('/transactions/txn-1', 'browser')

    const pane = (await screen.findAllByRole('region', { name: /details for target/i }))[0]
    expect(pane.closest('[role="dialog"]')).toHaveClass('bg-surface')

    await user.click(within(pane).getByRole('button', { name: 'Show transactions for this merchant →' }))

    await waitFor(() => expect(screen.getByTestId('location-search')).toHaveTextContent('merchant_prefix=Target'))
    expect(screen.queryByRole('region', { name: /details for target/i })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryAllByText('Cloudflare')).toHaveLength(0))
  })

  it('renders the detail pane in a bottom sheet on mobile', async () => {
    vi.mocked(useIsMobile).mockReturnValue(true)
    renderPage('/transactions/txn-1')

    const pane = (await screen.findAllByRole('region', { name: /details for target/i }))[0]
    expect(pane.closest('[role="dialog"]')).toHaveClass('bg-overlay')
    expect(pane.closest('.max-h-\\[84\\%\\]')).not.toBeNull()
  })
})
