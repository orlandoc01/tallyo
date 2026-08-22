import { useEffect, type ReactNode } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { cashFlowPeriods, normalizeTransactionForGraphql, recurringCharges, transactionsSummary } from '../../mocks/fixtures'
import { CashFlowPage } from '../../pages/CashFlowPage'
import { buildCashFlowChartData, formatCashFlowAxisValue, getCashFlowChartDomain, getCashFlowPalette } from './cashFlowChart'
import { RecurringPage } from '../../pages/RecurringPage'
import { useSpendingByCategory } from '../../hooks/useSpending'
import { mockQuery } from '../../test/msw'
import { renderWithProviders } from '../../test/renderWithProviders'
import type { RecurringCharge, SpendingFilter } from '../../types/graphql'

import { useMobileHeader } from '../../components/layout/useMobileHeader'

function renderCashFlow(ui: ReactNode) {
  return renderWithProviders(ui, { auth: { scopes: [], masterPasswordStatus: 'DISABLED' }, withGraphql: true, withMobileHeader: true })
}

function normalizeRecurringChargeForGraphql(charge: RecurringCharge): RecurringCharge {
  return {
    ...charge,
    transactions: charge.transactions.map(normalizeTransactionForGraphql),
  }
}

describe('CashFlowPage', () => {
  it('renders income and expenses from cashFlow query', async () => {
    renderCashFlow(<CashFlowPage />)

    expect(await screen.findAllByText('Income')).not.toHaveLength(0)
    expect(await screen.findAllByText('Expenses')).not.toHaveLength(0)
    expect(await screen.findByText('Total savings')).toBeInTheDocument()
    expect(await screen.findByText('Savings rate')).toBeInTheDocument()
  })

  it('shows income and expense category breakdowns', async () => {
    renderCashFlow(<CashFlowPage />)

    expect(await screen.findByText(/Interest/)).toBeInTheDocument()
    expect(await screen.findByText(/Restaurants & Bars/)).toBeInTheDocument()
    expect(await screen.findByText(/Groceries/)).toBeInTheDocument()
  })

  it('changes date range via date range selector', async () => {
    const user = userEvent.setup()
    renderCashFlow(<CashFlowPage />)

    await waitFor(() => expect(screen.getAllByText('Income')).not.toHaveLength(0))

    await user.click(screen.getByRole('radio', { name: /quarterly/i }))

    await waitFor(() => expect(screen.getAllByText('Income')).not.toHaveLength(0))
  })

  it('opens mobile date filter sheet, changes granularity, and applies', async () => {
    const user = userEvent.setup()
    renderCashFlow(<OpenFilterOnMount />)

    expect(await screen.findByRole('heading', { name: 'Date Range' })).toBeInTheDocument()

    // Click granularity in the mobile sheet
    const quarterlyButtons = screen.getAllByRole('button', { name: /quarterly/i })
    await user.click(quarterlyButtons[quarterlyButtons.length - 1])

    await user.click(screen.getByRole('button', { name: /apply/i }))
    expect(screen.queryByRole('heading', { name: 'Date Range' })).not.toBeInTheDocument()
  })

  it('anchors the mobile date filter dropdown below the header action', async () => {
    renderCashFlow(<OpenFilterOnMount />)

    const dialog = await screen.findByRole('dialog', { name: 'Filters' })
    expect(dialog).toHaveClass('fixed', 'inset-x-0', 'bottom-0')
    expect(dialog).toHaveStyle({ top: '48px' })
    expect(dialog.firstElementChild).toHaveClass('absolute', 'right-0', 'top-0')
    expect(dialog.firstElementChild).toHaveClass('w-[min(20rem,100vw)]')
    expect(dialog.firstElementChild).toHaveClass('rounded-b-3xl')
    expect(dialog.firstElementChild).toHaveClass('max-h-full')
  })

  it('closes mobile date filter sheet on cancel without applying', async () => {
    const user = userEvent.setup()
    renderCashFlow(<OpenFilterOnMount />)

    expect(await screen.findByRole('heading', { name: 'Date Range' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByRole('heading', { name: 'Date Range' })).not.toBeInTheDocument()
  })

  it('aggregates breakdowns across multiple periods', async () => {
    const multiPeriod = [
      ...cashFlowPeriods,
      {
        ...cashFlowPeriods[0],
        periodLabel: '2026-04',
        periodStart: '2026-04-01',
        periodEnd: '2026-04-30',
      },
    ]
    mockQuery('CashFlow', { cashFlow: { __typename: 'CashFlowReport', periods: multiPeriod.map(p => ({ __typename: 'CashFlowPeriod', ...p, summary: { __typename: 'CashFlowSummary', ...p.summary }, incomeByCategory: p.incomeByCategory.map((b: unknown) => ({ __typename: 'CashFlowBreakdown', ...(b as object) })), expensesByCategory: p.expensesByCategory.map((b: unknown) => ({ __typename: 'CashFlowBreakdown', ...(b as object) })) })) } })

    renderCashFlow(<CashFlowPage />)

    expect(await screen.findAllByText('Income')).not.toHaveLength(0)
    expect(await screen.findByText(/Interest/)).toBeInTheDocument()
  })

  it('returns the dark-mode palette with fully visible chart bar fills', () => {
    expect(getCashFlowPalette(true)).toEqual({
      axisTickFill: '#a8a29e',
      incomeBarFill: '#30a46c',
      expenseBarFill: '#E5484D',
      incomeBarHoverFill: '#30a46c',
      expenseBarHoverFill: '#E5484D',
      incomeBreakdownFill: '#30a46c26',
      expenseBreakdownFill: '#E5484D26',
      incomeBreakdownHoverFill: '#30a46c4C',
      expenseBreakdownHoverFill: '#E5484D4C',
      gridStroke: '#44403c',
      netLineStroke: '#d6d3d1',
      netDotFill: '#1c1917',
      zeroLineStroke: '#57534e',
    })
  })

  it('builds chart data with income, expenses, and net per period', () => {
    expect(buildCashFlowChartData(cashFlowPeriods)).toEqual(
      cashFlowPeriods.map((p) => ({
        periodLabel: p.periodLabel,
        income: p.summary.income,
        expenses: p.summary.expenses,
        net: p.summary.income - p.summary.expenses,
      })),
    )
  })

  it('uses a chart domain with income as max and negative expenses as min', () => {
    expect(getCashFlowChartDomain([
      { periodLabel: 'Jan', income: 100, expenses: 80, net: 20 },
      { periodLabel: 'Feb', income: 60, expenses: 120, net: -60 },
    ])).toEqual({ min: -120, max: 100 })
  })

  it('formats negative cash flow axis values with a single minus sign', () => {
    expect(formatCashFlowAxisValue(-120, false)).toBe('-$120.00')
    expect(formatCashFlowAxisValue(-1200, true)).toBe('-$1.2K')
  })
})

describe('RecurringPage', () => {
  it('renders recurring groups with next expected date', async () => {
    renderCashFlow(<RecurringPage />)

    expect(await screen.findByText('Netflix')).toBeInTheDocument()
    expect(screen.getByText(/Next expected/)).toBeInTheDocument()
    expect(screen.getByText('Monthly')).toBeInTheDocument()
  })

  it('shows early detection badge when status is EARLY_DETECTION', async () => {
    const earlyGroup = [normalizeRecurringChargeForGraphql({ ...recurringCharges[0], status: 'EARLY_DETECTION' as const })]
    mockQuery('RecurringCharges', { recurringCharges: { __typename: 'RecurringChargeList', items: earlyGroup } })

    renderCashFlow(<RecurringPage />)

    expect(await screen.findByText('Early detection')).toBeInTheDocument()
  })

  it('shows empty state when no recurring groups exist', async () => {
    mockQuery('RecurringCharges', { recurringCharges: { __typename: 'RecurringChargeList', items: [] } })

    renderCashFlow(<RecurringPage />)

    expect(await screen.findByText('No recurring charges detected')).toBeInTheDocument()
    expect(screen.queryByText('Netflix')).not.toBeInTheDocument()
  })

  it('hides next expected date when not available', async () => {
    const groupWithoutDate = [normalizeRecurringChargeForGraphql({ ...recurringCharges[0], nextExpectedDate: null })]
    mockQuery('RecurringCharges', { recurringCharges: { __typename: 'RecurringChargeList', items: groupWithoutDate } })

    renderCashFlow(<RecurringPage />)

    await screen.findByText('Netflix')
    expect(screen.queryByText(/Next expected/)).not.toBeInTheDocument()
  })
})

describe('TransactionsSummary', () => {
  it('is available in test fixtures with expected shape', () => {
    expect(transactionsSummary.totalCount).toBe(2)
    expect(transactionsSummary.largestAmount).toBe(62.3)
    expect(transactionsSummary.firstDate).toBe('2026-05-14')
    expect(transactionsSummary.lastDate).toBe('2026-05-14')
  })
})

function OpenFilterOnMount() {
  const { openFilter } = useMobileHeader()
  useEffect(() => { openFilter() }, [openFilter])
  return <CashFlowPage />
}

function SpendingByCategoryWrapper({ filter }: { filter: SpendingFilter }) {
  const { periods } = useSpendingByCategory(filter)
  return <div data-testid="points">{periods.length}</div>
}

describe('useSpendingByCategory', () => {
  it('fetches zero-filled spending period data points', async () => {
    const filter: SpendingFilter = {
      datetimeRange: { from: '2026-04-01T00:00:00Z', to: '2026-06-01T00:00:00Z' },
      granularity: 'MONTHLY',
    }

    renderCashFlow(<SpendingByCategoryWrapper filter={filter} />)

    await waitFor(() => {
      expect(screen.getByTestId('points').textContent).toBe('2')
    })
  })
})
