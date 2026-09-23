import { useEffect, type ReactNode } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cashFlowPeriods, transactionsSummary } from '../../mocks/fixtures'
import { CashFlowPage } from '../../pages/CashFlowPage'
import { CashFlowBars } from './CashFlowBars'
import { CashFlowBreakdownCard } from './CashFlowBreakdownCard'
import { CashFlowMobileFilters } from './CashFlowMobileFilters'
import { buildCashFlowSeries, cashFlowDatePresets } from './cashFlowStats'
import { useSpendingByCategory } from '../../hooks/useSpending'
import { mockQuery } from '../../test/msw'
import { LocationDisplay, renderWithProviders } from '../../test/renderWithProviders'
import type { CashFlowPeriod, SpendingFilter } from '../../types/graphql'

import { useMobileHeader } from '../../components/layout/useMobileHeader'

function renderCashFlow(ui: ReactNode) {
  return renderWithProviders(ui, { auth: { scopes: [], masterPasswordStatus: 'DISABLED' }, probes: <LocationDisplay />, withGraphql: true, withMobileHeader: true })
}

describe('CashFlowPage', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function pinClockInsideFixtures() {
    // Fixture transactions end 2026-06; the page defaults to the last 3 months from the clock.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-21T12:00:00Z'))
  }

  it('renders the four header stats from the cashFlow query', async () => {
    renderCashFlow(<CashFlowPage />)

    expect(await screen.findAllByText('Income')).not.toHaveLength(0)
    expect(await screen.findAllByText('Expenses')).not.toHaveLength(0)
    expect(await screen.findByText('Total savings')).toBeInTheDocument()
    expect(await screen.findByText('Savings rate')).toBeInTheDocument()
  })

  it('shows the latest bucket, its delta and the category breakdowns', async () => {
    pinClockInsideFixtures()
    renderCashFlow(<CashFlowPage />)

    expect(await screen.findByRole('button', { name: 'View Interest transactions' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View Restaurants & Bars transactions' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View Groceries transactions' })).toBeInTheDocument()
    expect(screen.getAllByText(/^[▲▼] \$[\d.K]+ vs May$/)).toHaveLength(2)
    expect(screen.getByText('Jun 1 – Jun 21')).toBeInTheDocument()
    expect(screen.getByText(/^Avg 3 mo: \d+%$/)).toBeInTheDocument()
  })

  it('selects another bucket when its bar is clicked', async () => {
    pinClockInsideFixtures()
    const user = userEvent.setup()
    renderCashFlow(<CashFlowPage />)

    await user.click(await screen.findByRole('button', { name: 'Select Apr' }))

    expect(screen.getByText('Apr 1 – Apr 30')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select Apr' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('navigates to the transactions list for a breakdown category', async () => {
    pinClockInsideFixtures()
    const user = userEvent.setup()
    renderCashFlow(<CashFlowPage />)

    await user.click(await screen.findByRole('button', { name: 'View Groceries transactions' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/transactions?category_ids=')
    expect(screen.getByTestId('location')).toHaveTextContent('start_date=2026-06-01')
  })

  it('changes granularity via the segmented control', async () => {
    const user = userEvent.setup()
    renderCashFlow(<CashFlowPage />)

    await waitFor(() => expect(screen.getAllByText('Income')).not.toHaveLength(0))
    await user.click(screen.getByRole('radio', { name: /quarterly/i }))

    expect(screen.getByTestId('location')).toHaveTextContent('granularity=QUARTERLY')
  })

  it('applies a date preset from the desktop filter panel and clears it from the active row', async () => {
    const user = userEvent.setup()
    renderCashFlow(<CashFlowPage />)

    await waitFor(() => expect(screen.getAllByText('Income')).not.toHaveLength(0))
    await user.click(screen.getByRole('button', { name: 'Filters' }))
    await user.click(screen.getByRole('button', { name: /^Date range/ }))
    await user.click(screen.getByRole('radio', { name: /^Year to date/ }))

    expect(screen.getByRole('button', { name: 'Filters, 1 active' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove Date filter: Year to date' }))
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument()
  })

  it('opens the mobile filter sheet with the date section expanded and applies a preset', async () => {
    const user = userEvent.setup()
    renderCashFlow(<OpenFilterOnMount />)

    const dialog = await screen.findByRole('dialog', { name: 'Filters' })
    expect(dialog).toHaveClass('fixed', 'inset-0', 'bg-overlay')
    expect(dialog.firstElementChild).toHaveClass('rounded-t-2xl', 'shadow-sheet', 'max-h-[78%]')
    expect(screen.getByRole('button', { name: /^Date range/ })).toHaveAttribute('aria-expanded', 'true')

    await user.click(screen.getByRole('radio', { name: 'Last 6 months' }))
    expect(screen.getByText('Last 6 months')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /apply/i }))

    expect(screen.queryByRole('dialog', { name: 'Filters' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filters, 1 active' })).toBeInTheDocument()
  })

  it('closes the mobile sheet without applying', async () => {
    const user = userEvent.setup()
    renderCashFlow(<OpenFilterOnMount />)

    await screen.findByRole('dialog', { name: 'Filters' })
    await user.click(screen.getByRole('radio', { name: 'Year to date' }))
    await user.click(screen.getByRole('button', { name: 'Close filters' }))

    expect(screen.queryByRole('dialog', { name: 'Filters' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument()
  })

  it('keeps the selected bucket across a refetch that still contains it and falls back to the latest otherwise', async () => {
    pinClockInsideFixtures()
    const user = userEvent.setup()
    renderCashFlow(<CashFlowPage />)

    await user.click(await screen.findByRole('button', { name: 'Select May' }))
    expect(screen.getByText('May 1 – May 31')).toBeInTheDocument()

    mockQuery('CashFlow', { cashFlow: cashFlowReport([...cashFlowPeriods, { ...cashFlowPeriods[0], periodLabel: '2026-07', periodStart: '2026-07-01', periodEnd: '2026-07-31' }]) })
    await user.click(screen.getByRole('radio', { name: /quarterly/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Select Jul' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Select May' })).toHaveAttribute('aria-pressed', 'true')

    mockQuery('CashFlow', { cashFlow: cashFlowReport([cashFlowPeriods[0], cashFlowPeriods[2]]) })
    await user.click(screen.getByRole('radio', { name: /yearly/i }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Select May' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Select Jun' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows the empty state when the range has no buckets', async () => {
    mockQuery('CashFlow', { cashFlow: { __typename: 'CashFlowReport', periods: [] } })

    renderCashFlow(<CashFlowPage />)

    expect(await screen.findByText('No cash flow data for this range')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /monthly/i })).toBeInTheDocument()
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

function cashFlowReport(periods: CashFlowPeriod[]) {
  return {
    __typename: 'CashFlowReport',
    periods: periods.map((p) => ({
      __typename: 'CashFlowPeriod',
      ...p,
      summary: { __typename: 'CashFlowSummary', ...p.summary },
      incomeByCategory: p.incomeByCategory.map((b) => ({ __typename: 'CashFlowBreakdown', ...b })),
      expensesByCategory: p.expensesByCategory.map((b) => ({ __typename: 'CashFlowBreakdown', ...b })),
    })),
  }
}

function bucket(label: string, income: number, expenses: number): CashFlowPeriod {
  return { ...cashFlowPeriods[0], periodLabel: label, summary: { ...cashFlowPeriods[0].summary, income, expenses } }
}

describe('CashFlowBars', () => {
  it('keeps a tall expense bar and its label inside the viewBox', () => {
    const { container } = renderWithProviders(<CashFlowBars series={buildCashFlowSeries([bucket('2026-05', 200, 5000)])} selectedIndex={0} onSelect={() => undefined} />)

    const svg = container.querySelector('svg')!
    const height = Number(svg.getAttribute('viewBox')!.split(' ')[3])
    const rects = [...container.querySelectorAll('g[role="button"] rect')].slice(1).map((rect) => Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')))
    const texts = [...container.querySelectorAll('text')]
    const baseline = (text: Element) => Number(text.getAttribute('y'))
    const valueLabel = texts.find((text) => text.textContent === '$5K')!
    const monthLabel = texts.find((text) => text.textContent === 'May')!
    expect(Math.max(...rects)).toBe(171 + 150)
    expect(baseline(valueLabel)).toBe(171 + 150 + 14)
    // glyph boxes: value label baseline−11…baseline, month label baseline−12…baseline
    expect(baseline(monthLabel) - 12).toBeGreaterThanOrEqual(baseline(valueLabel))
    expect(baseline(monthLabel)).toBeLessThanOrEqual(height)
  })

  it('spreads a short series evenly across the width', () => {
    const periods = Array.from({ length: 3 }, (_, index) => bucket(`2026-0${index + 1}`, 100, 50))
    const { container } = renderWithProviders(<CashFlowBars series={buildCashFlowSeries(periods)} selectedIndex={0} onSelect={() => undefined} />)
    const bars = [...container.querySelectorAll('g[role="button"]')].map((group) => group.querySelectorAll('rect')[1])
    const xs = bars.map((rect) => Number(rect.getAttribute('x')))
    const step = (1000 - 120) / 3
    expect(xs[1] - xs[0]).toBeCloseTo(step)
    expect(xs[0]).toBeCloseTo(60 + (step - 70) / 2)
    expect(Number(bars[0].getAttribute('width'))).toBe(70)
  })

  it('compresses the step beyond six buckets', () => {
    const periods = Array.from({ length: 8 }, (_, index) => bucket(`2026-0${index + 1}`, 100, 50))
    const { container } = renderWithProviders(<CashFlowBars series={buildCashFlowSeries(periods)} selectedIndex={0} onSelect={() => undefined} />)

    const bars = [...container.querySelectorAll('g[role="button"]')].map((group) => group.querySelectorAll('rect')[1])
    const xs = bars.map((rect) => Number(rect.getAttribute('x')))
    expect(xs[1] - xs[0]).toBeCloseTo(110)
    expect(Number(bars[0].getAttribute('width'))).toBeCloseTo(48.4)
    expect(xs[7] + Number(bars[7].getAttribute('width'))).toBeLessThanOrEqual(1000)
  })

  it('renders an all-zero series without value labels or NaN geometry', () => {
    const { container } = renderWithProviders(<CashFlowBars series={buildCashFlowSeries([bucket('2026-05', 0, 0)])} selectedIndex={0} onSelect={() => undefined} />)

    expect(container.querySelectorAll('text')).toHaveLength(1)
    expect(container.innerHTML).not.toContain('NaN')
    expect(container.querySelector('polyline')).toHaveAttribute('points', '500,170')
  })
})

describe('CashFlowBreakdownCard', () => {
  it('shows a net refund row with a signed amount and an empty bar', () => {
    const refund = { ...cashFlowPeriods[0].expensesByCategory[0], total: -24.99, percentOfTotal: -8.8 }
    const { container } = renderWithProviders(<CashFlowBreakdownCard items={[refund]} title="Expenses" tone="expenses" total={100} onItemClick={() => undefined} />)

    expect(screen.getByText('-$24.99')).toBeInTheDocument()
    expect(screen.getByText('-8.8%')).toBeInTheDocument()
    expect(container.querySelector('[aria-hidden] > div')).toHaveStyle({ width: '0%' })
  })
})

describe('CashFlowMobileFilters', () => {
  const now = new Date(2026, 8, 18)
  const defaultRange = { dateFrom: '2026-07-01', dateTo: '2026-09-30' }

  function renderSheet(onApply = vi.fn()) {
    renderWithProviders(
      <CashFlowMobileFilters defaultRange={defaultRange} now={now} ownerIds={[]} presets={cashFlowDatePresets()} range={{ dateFrom: '2026-01-01', dateTo: '2026-09-30' }} onApply={onApply} onClose={() => undefined} />,
      { auth: { scopes: [], masterPasswordStatus: 'DISABLED' }, withGraphql: true },
    )
    return onApply
  }

  it('resets the pending range on Clear filters', async () => {
    const user = userEvent.setup()
    const onApply = renderSheet()

    expect(screen.getByRole('button', { name: /^Date range/ })).toHaveTextContent('Year to date')
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('button', { name: /^Date range/ })).toHaveTextContent('Default')
    await user.click(screen.getByRole('button', { name: /apply/i }))

    expect(onApply).toHaveBeenCalledWith({ ...defaultRange, ownerIds: [] })
  })

  it('merges From/To edits into the pending range', async () => {
    const user = userEvent.setup()
    const onApply = renderSheet()

    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-02-01' } })
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-08-31' } })
    expect(screen.getByText('Feb 1, 2026 – Aug 31, 2026')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /apply/i }))

    expect(onApply).toHaveBeenCalledWith({ dateFrom: '2026-02-01', dateTo: '2026-08-31', ownerIds: [] })
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
