import { render, screen, within } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AccountSidebar } from './AccountSidebar'
import { AllocationCard } from './AllocationCard'
import { NetWorthCard } from './NetWorthCard'
import type { Account, Asset, ClassifierBreakdown, HistoricalNetWorthReport, Holding, LiabilityBreakdown, NetWorthPoint, NetWorthReport } from '../../types/graphql'

const tooltipSpy = vi.fn()
const activeTooltip = vi.hoisted(() => ({ label: undefined as string | undefined, active: false }))

vi.mock('recharts', () => ({
  useActiveTooltipLabel: () => activeTooltip.label,
  useIsTooltipActive: () => activeTooltip.active,
  Area: () => null,
  AreaChart: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => <svg data-testid="area-chart" onClick={onClick} tabIndex={0}>{children}</svg>,
  CartesianGrid: () => null,
  Line: () => null,
  ReferenceDot: () => <circle data-testid="focused-dot" />,
  ReferenceLine: () => null,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Tooltip: (props: unknown) => {
    tooltipSpy(props)
    return null
  },
  XAxis: () => null,
  YAxis: () => null,
}))

const usdAsset: Asset = { id: '1', assetType: 'CURRENCY', identifier: 'USD', name: 'US Dollar', classifier: 'CASH', trackingTicker: null, trackingMultiplier: 1, priceConnectivity: 'HEALTHY', investmentConnectivity: 'HEALTHY', adapterSources: [] }
const aaplAsset: Asset = { id: '3', assetType: 'SECURITY', identifier: 'AAPL', name: 'Apple Inc', classifier: 'PUBLIC', trackingTicker: null, trackingMultiplier: 1, priceConnectivity: 'HEALTHY', investmentConnectivity: 'HEALTHY', adapterSources: [] }
const homeAsset: Asset = { id: '4', assetType: 'REAL_ESTATE', identifier: 'HOME', name: 'Primary Home', classifier: 'REAL_ESTATE', trackingTicker: null, trackingMultiplier: 1, priceConnectivity: 'HEALTHY', investmentConnectivity: 'HEALTHY', adapterSources: [] }

const checkingAccount: Account = { id: 'acc', name: 'Checking', type: 'DEPOSITORY', subtype: 'checking', connection: { id: 'connection', name: 'Chase', owner: { id: 'owner', name: 'Alex' }, isActive: true, provider: null }, owner: { id: 'owner', name: 'Alex' }, closed: false, hidden: false, needsReview: false, manual: false, typeLocked: false, createdAt: '', updatedAt: '', latestSnapshot: { id: 'snapshot-acc', accountId: 'acc', date: '2026-06-01', balanceUSD: 1200, netContributionUSD: 1200, holdings: [], flagged: false }, lastSyncedAt: new Date(Date.now() - 4 * 60 * 1000).toISOString() }
const rothAccount: Account = { id: 'invest-tax', name: 'Roth 401k', type: 'INVESTMENT', subtype: 'roth 401k', owner: { id: 'owner', name: 'Alex' }, closed: false, hidden: false, needsReview: false, manual: false, typeLocked: false, createdAt: '', updatedAt: '', latestSnapshot: { id: 'snapshot-invest-tax', accountId: 'invest-tax', date: '2026-06-01', balanceUSD: 300, netContributionUSD: 300, holdings: [], flagged: false } }
const brokerageAccount: Account = { id: 'invest', name: 'Brokerage', type: 'INVESTMENT', subtype: 'brokerage', connection: { id: 'connection-2', name: 'Fidelity', owner: { id: 'owner', name: 'Alex' }, isActive: false, provider: null }, owner: { id: 'owner', name: 'Alex' }, closed: false, hidden: false, needsReview: false, manual: false, typeLocked: false, createdAt: '', updatedAt: '', latestSnapshot: { id: 'snapshot-invest', accountId: 'invest', date: '2026-06-01', balanceUSD: 300, netContributionUSD: 300, holdings: [], flagged: false }, lastSyncedAt: '2025-01-01T00:00:00Z' }

function holdingRow(asset: Asset, account: Account, quantity: number | null, valueUSD: number): Holding {
  return { assetId: asset.id, asset, accountId: account.id, account, quantity, valueUSD, manual: false }
}

const breakdown: ClassifierBreakdown[] = [
  {
    classifier: 'CASH',
    label: 'Cash & Equivalents',
    valueUSD: 1200,
    percentOfAssets: 60,
    assetCount: 1,
    holdings: [{ asset: usdAsset, totalQuantity: 1200, valueUSD: 1200, percentOfClassifier: 100, holdings: [holdingRow(usdAsset, checkingAccount, 1200, 1200)] }],
  },
  {
    classifier: 'PUBLIC',
    label: 'Public Assets',
    valueUSD: 600,
    percentOfAssets: 33.33,
    assetCount: 2,
    holdings: [{ asset: aaplAsset, totalQuantity: 6, valueUSD: 600, percentOfClassifier: 100, holdings: [holdingRow(aaplAsset, rothAccount, 3, 300), holdingRow(aaplAsset, brokerageAccount, 3, 300)] }],
  },
  {
    classifier: 'REAL_ESTATE',
    label: 'Real Estate',
    valueUSD: 400,
    percentOfAssets: 6.67,
    assetCount: 1,
    holdings: [{ asset: homeAsset, totalQuantity: 1, valueUSD: 400, percentOfClassifier: 100, holdings: [] }],
  },
]

const liabilityBreakdown: LiabilityBreakdown[] = [
  {
    category: 'CARD',
    label: 'Cards',
    valueUSD: 200,
    percentOfLiabilities: 100,
    accountCount: 1,
    balances: [{ balanceUSD: 200, account: { id: 'card', name: 'Credit Card', type: 'CREDIT', owner: { id: 'owner', name: 'Alex' }, closed: false, hidden: false, needsReview: false, manual: false, typeLocked: false, createdAt: '', updatedAt: '', latestSnapshot: { id: 'snapshot-card', accountId: 'card', date: '2026-06-01', balanceUSD: 200, netContributionUSD: -200, holdings: [], flagged: false } } }],
  },
]

const points: NetWorthPoint[] = [
  { date: '2026-05-01', totalAssetsUSD: 1000, totalLiabilitiesUSD: 200, netWorthUSD: 800 },
  { date: '2026-06-01', totalAssetsUSD: 1200, totalLiabilitiesUSD: 200, netWorthUSD: 1000 },
]

const report: NetWorthReport = { asOfDate: '2026-06-01', currentNetWorthUSD: 1000, currentAssetsUSD: 2200, currentLiabilitiesUSD: 200, classifierBreakdown: breakdown, liabilityBreakdown }

const historicalReport: HistoricalNetWorthReport = {
  series: points,
  classifierSeries: [
    { classifier: 'CASH', date: '2026-05-01', label: 'Cash & Equivalents', valueUSD: 1000 },
    { classifier: 'CASH', date: '2026-06-01', label: 'Cash & Equivalents', valueUSD: 1200 },
    { classifier: 'PUBLIC', date: '2026-05-01', label: 'Public Assets', valueUSD: 600 },
    { classifier: 'PUBLIC', date: '2026-06-01', label: 'Public Assets', valueUSD: 600 },
  ],
  liabilitySeries: [
    { category: 'CARD', date: '2026-05-01', label: 'Cards', valueUSD: -250 },
    { category: 'CARD', date: '2026-06-01', label: 'Cards', valueUSD: -200 },
  ],
}

function renderSidebar(overrides: Partial<ComponentProps<typeof AccountSidebar>> = {}) {
  return render(<AccountSidebar breakdown={breakdown} liabilityBreakdown={liabilityBreakdown} netWorth={1000} {...overrides} />)
}

function renderAllocation(overrides: Partial<ComponentProps<typeof AllocationCard>> = {}) {
  return render(
    <AllocationCard
      amountsHidden={false}
      historicalReport={historicalReport}
      range="YTD"
      report={report}
      selectedClassifier={null}
      selectedLiabilityCategory={null}
      view="ASSETS"
      onAssetClick={vi.fn()}
      onSelectClassifier={vi.fn()}
      onSelectLiabilityCategory={vi.fn()}
      onViewChange={vi.fn()}
      {...overrides}
    />,
  )
}

function renderNetWorthCard(overrides: Partial<ComponentProps<typeof NetWorthCard>> = {}) {
  return render(
    <NetWorthCard amountsHidden={false} changePct={25} changeUSD={200} filterCount={0} filters={<div>Filter chips</div>} historicalReport={historicalReport} range="YTD" report={report} onFocusDate={vi.fn()} onToggleAmountsHidden={vi.fn()} {...overrides} />,
  )
}

describe('AccountSidebar', () => {
  it('renders expanded groups with abbreviated totals on desktop', async () => {
    renderSidebar()
    expect(screen.getByText('Net Worth')).toBeInTheDocument()
    expect(screen.getByText('$1.0K')).toBeInTheDocument()
    expect(screen.getByText('Cards')).toBeInTheDocument()
    expect(screen.getAllByText('-$200.00')).toHaveLength(2)
    expect(screen.getByText('Deposits')).toBeInTheDocument()
    expect(screen.getByText('Investments')).toBeInTheDocument()
    expect(screen.getByText('Tax Advantaged')).toBeInTheDocument()
    expect(screen.getByText('Checking')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Collapse Deposits accounts' }))
    expect(screen.queryByText('Checking')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Expand Deposits accounts' }))
    expect(screen.getByText('Checking')).toBeInTheDocument()
  })

  it('moves configured subtypes into the tax-advantaged group', async () => {
    renderSidebar()

    await userEvent.click(screen.getByRole('button', { name: 'Collapse Investments accounts' }))
    expect(screen.getByText('Roth 401k')).toBeInTheDocument()
    expect(screen.queryByText('Brokerage')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Expand Investments accounts' }))
    expect(screen.getByText('Brokerage')).toBeInTheDocument()
  })

  it('shows the institution, sync recency and stale reconnect hints', async () => {
    renderSidebar()
    expect(screen.getByText('Chase')).toBeInTheDocument()
    expect(screen.getByText('4m ago')).toHaveClass('text-text-muted')
    expect(screen.getByText(/y ago · Reconnect$/)).toHaveClass('text-warning')
  })

  it('falls back to the subtype or account type for manual accounts', async () => {
    renderSidebar()
    expect(screen.getByText('Credit')).toBeInTheDocument()
  })

  it('filters accounts by search and auto-expands matching groups', async () => {
    renderSidebar()
    await userEvent.type(screen.getByRole('textbox', { name: 'Search accounts' }), 'chase')

    expect(screen.getByText('Checking')).toBeInTheDocument()
    expect(screen.getByText('Deposits')).toBeInTheDocument()
    expect(screen.queryByText('Investments')).not.toBeInTheDocument()
    expect(screen.queryByText('Cards')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Deposits accounts$/ })).not.toBeInTheDocument()

    await userEvent.type(screen.getByRole('textbox', { name: 'Search accounts' }), 'zzz')
    expect(screen.getByText('No accounts match.')).toBeInTheDocument()
  })

  it('invokes onAccountClick from account rows and onClearAccountFilters from the aggregate row', async () => {
    const onAccountClick = vi.fn()
    const onClearAccountFilters = vi.fn()
    renderSidebar({ onAccountClick, onClearAccountFilters, selectedAccountIds: ['acc'] })
    await userEvent.click(screen.getByLabelText('Open details for Checking'))
    expect(onAccountClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'acc', name: 'Checking', subtype: 'checking' }))
    expect(screen.getByLabelText('Open details for Checking')).toHaveClass('bg-raised-nav')
    expect(screen.getByLabelText('Open details for Checking').querySelector('svg')).toBeNull()

    const aggregate = screen.getByRole('button', { name: /Net Worth/ })
    expect(aggregate).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(aggregate)
    expect(onClearAccountFilters).toHaveBeenCalledOnce()
  })

  it('toggles group filters from the row and marks selected groups', async () => {
    const onAccountGroupClick = vi.fn()
    renderSidebar({ onAccountGroupClick, selectedAccountGroupIds: ['DEPOSITS'] })

    const deposits = screen.getByRole('button', { name: /^Deposits/ })
    expect(deposits).toHaveAttribute('aria-pressed', 'true')
    expect(deposits.parentElement).toHaveClass('bg-raised-nav')
    await userEvent.click(deposits)
    expect(onAccountGroupClick).toHaveBeenCalledWith('DEPOSITS', ['acc'])
  })

  it('renders accounts as static rows without an onAccountClick handler', async () => {
    renderSidebar()
    expect(screen.getByText('Checking')).toBeInTheDocument()
    expect(screen.queryByLabelText('Open details for Checking')).not.toBeInTheDocument()
  })

  it('renders the mobile accounts card with a count header', async () => {
    renderSidebar({ variant: 'mobile' })
    expect(screen.getByText('Accounts')).toBeInTheDocument()
    expect(screen.getByText('4 accounts')).toBeInTheDocument()
    expect(screen.queryByText('Net Worth')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Expand Cards accounts' }))
    expect(screen.getByText('Credit Card')).toBeInTheDocument()
  })

  it('renders non-expandable classifier rows without search when the caller lacks read:holdings', () => {
    renderSidebar({ canReadHoldings: false })
    expect(screen.getByText('Cash & Equivalents')).toBeInTheDocument()
    expect(screen.getByText('Public Assets')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Search accounts' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Expand Cash & Equivalents accounts' })).not.toBeInTheDocument()
    expect(screen.queryByText('Checking')).not.toBeInTheDocument()
    // Liabilities are ungated and stay expandable.
    expect(screen.getByRole('button', { name: 'Collapse Cards accounts' })).toBeInTheDocument()
  })

  it('masks amounts', () => {
    renderSidebar({ amountsHidden: true })
    expect(screen.getAllByText(/•/).length).toBeGreaterThan(0)
    expect(screen.queryByText('$1.0K')).not.toBeInTheDocument()
  })
})

describe('AllocationCard', () => {
  it('renders sorted asset rows with range changes and expands holdings on click', async () => {
    const onSelectClassifier = vi.fn()
    const onAssetClick = vi.fn()
    renderAllocation({ onAssetClick, onSelectClassifier })

    const rows = screen.getAllByRole('button', { name: /Cash & Equivalents|Public Assets|Real Estate/ })
    expect(rows.slice(0, 3).map((row) => row.textContent)).toEqual([
      expect.stringContaining('Cash & Equivalents'),
      expect.stringContaining('Public Assets'),
      expect.stringContaining('Real Estate'),
    ])
    expect(screen.getAllByText('▲ $200.00 (20.0%)')[0]).toHaveClass('text-positive')
    expect(screen.getAllByText('$0 (0%)')[0]).toHaveClass('text-text-muted')
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.getByText('Change · YTD')).toBeInTheDocument()
    expect(screen.getByText('$2.2K')).toBeInTheDocument()
    expect(screen.queryByText('US Dollar')).not.toBeInTheDocument()

    await userEvent.click(rows[0])
    expect(onSelectClassifier).toHaveBeenCalledWith('CASH')
    expect(screen.getAllByText('US Dollar').length).toBe(2)
    expect(screen.getAllByText(/1 account/).length).toBe(2)

    await userEvent.click(screen.getAllByRole('button', { name: /Public Assets/ })[0])
    expect(screen.getAllByText(/6 shares/).length).toBe(2)
    await userEvent.click(screen.getAllByRole('button', { name: /^Edit Apple Inc/ })[0])
    expect(onAssetClick).toHaveBeenCalledWith(expect.objectContaining({ asset: aaplAsset }))
  })

  it('toggles the sort order and reorders the donut slices', async () => {
    renderAllocation()
    const donut = screen.getByRole('img', { name: 'Assets by class' })
    expect(within(donut).getAllByText(/./).map((node) => node.textContent)).toEqual(['Cash & Equivalents', 'Public Assets', 'Real Estate'])

    await userEvent.click(screen.getByRole('button', { name: /Weight H → L/ }))

    expect(screen.getByRole('button', { name: /Weight L → H/ })).toBeInTheDocument()
    expect(within(donut).getAllByText(/./).map((node) => node.textContent)).toEqual(['Real Estate', 'Public Assets', 'Cash & Equivalents'])
  })

  it('links donut hover and selection to the rows', async () => {
    const user = userEvent.setup()
    const onSelectClassifier = vi.fn()
    renderAllocation({ onSelectClassifier, selectedClassifier: 'CASH' })
    const [cashSlice, publicSlice] = screen.getByRole('img', { name: 'Assets by class' }).querySelectorAll('path')

    expect(publicSlice).toHaveStyle({ opacity: '0.35' })
    await user.hover(publicSlice)
    expect(publicSlice).toHaveStyle({ opacity: '1', transform: 'scale(1.04)' })
    expect(cashSlice).toHaveStyle({ opacity: '0.35' })
    expect(onSelectClassifier).not.toHaveBeenCalled()

    await user.click(cashSlice)
    expect(onSelectClassifier).toHaveBeenCalledWith(null)
    expect(publicSlice).not.toHaveStyle({ transform: 'scale(1.04)' })
  })

  it('switches to liabilities with inverted change colouring and account children', async () => {
    const onViewChange = vi.fn()
    const onSelectClassifier = vi.fn()
    const { rerender } = renderAllocation({ onSelectClassifier, onViewChange, selectedClassifier: 'CASH' })

    await userEvent.click(screen.getByRole('radio', { name: 'Liabilities' }))
    expect(onViewChange).toHaveBeenCalledWith('LIABILITIES')
    expect(onSelectClassifier).toHaveBeenCalledWith(null)

    rerender(
      <AllocationCard amountsHidden={false} historicalReport={historicalReport} range="ONE_MONTH" report={report} selectedClassifier={null} selectedLiabilityCategory={null} view="LIABILITIES" onAssetClick={vi.fn()} onSelectClassifier={vi.fn()} onSelectLiabilityCategory={vi.fn()} onViewChange={onViewChange} />,
    )
    expect(screen.getByText('All Liabilities')).toBeInTheDocument()
    expect(screen.getByText('% of Liabilities')).toBeInTheDocument()
    expect(screen.getByText('Change · 1M')).toBeInTheDocument()
    expect(screen.getAllByText('▼ $50.00 (20.0%)')[0]).toHaveClass('text-positive')
    expect(screen.queryByText('Credit Card')).not.toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('button', { name: /Cards/ })[0])
    expect(screen.getAllByText('Credit Card').length).toBe(2)
    expect(screen.getAllByText('CC').length).toBe(2)
  })

  it('shows the focus banner states', async () => {
    const onClearFocus = vi.fn()
    const onRetryFocus = vi.fn()
    const { rerender } = renderAllocation({ focusDate: '2026-06-01', focusState: 'ready', onClearFocus, onRetryFocus })
    expect(screen.getByText('Breakdown as of')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show current' }))
    expect(onClearFocus).toHaveBeenCalledOnce()

    rerender(
      <AllocationCard amountsHidden={false} focusDate="2026-06-01" focusState="error" historicalReport={historicalReport} range="YTD" report={report} selectedClassifier={null} selectedLiabilityCategory={null} view="ASSETS" onAssetClick={vi.fn()} onClearFocus={onClearFocus} onRetryFocus={onRetryFocus} onSelectClassifier={vi.fn()} onSelectLiabilityCategory={vi.fn()} onViewChange={vi.fn()} />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the breakdown as of 2026-06-01')
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetryFocus).toHaveBeenCalledOnce()
  })

  it('keeps rows collapsed without read:holdings and shows an empty state without rows', async () => {
    const onSelectClassifier = vi.fn()
    const { rerender } = renderAllocation({ canReadHoldings: false, onSelectClassifier })
    const row = screen.getAllByRole('button', { name: /Cash & Equivalents/ })[0]
    expect(row.querySelector('.group-hover\\:opacity-0')).toBeNull()
    expect(row.textContent).not.toContain('▶')
    await userEvent.click(row)
    expect(onSelectClassifier).toHaveBeenCalledWith('CASH')
    expect(screen.queryByText('US Dollar')).not.toBeInTheDocument()

    rerender(
      <AllocationCard amountsHidden={false} range="YTD" report={{ ...report, classifierBreakdown: [] }} selectedClassifier={null} selectedLiabilityCategory={null} view="ASSETS" onAssetClick={vi.fn()} onSelectClassifier={vi.fn()} onSelectLiabilityCategory={vi.fn()} onViewChange={vi.fn()} />,
    )
    expect(screen.getByText('No assets yet')).toBeInTheDocument()
  })

  it('masks amounts while leaving percentages visible', () => {
    renderAllocation({ amountsHidden: true })
    expect(screen.getAllByText(/•/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('60.0%').length).toBeGreaterThan(0)
  })
})

describe('NetWorthCard', () => {
  it('renders the value with separated cents and the range suffix', () => {
    renderNetWorthCard()
    expect(screen.getByText('$1,000')).toBeInTheDocument()
    expect(screen.getByText('.00')).toHaveClass('text-text-3')
    expect(screen.getByText('+$200.00 (25.0%)')).toHaveTextContent('+$200.00 (25.0%) year to date')
    expect(screen.getByText('Year to date')).toHaveClass('lg:hidden')
    expect(screen.queryByText('Filter chips')).not.toBeInTheDocument()
  })

  it('toggles the filter panel and reflects the active count', async () => {
    renderNetWorthCard({ filterCount: 2 })
    const filters = screen.getByRole('button', { name: 'Filters, 2 active' })
    expect(filters).toHaveClass('border-brand-600')
    await userEvent.click(filters)
    expect(screen.getByText('Filter chips')).toBeInTheDocument()
    expect(filters).toHaveAttribute('aria-expanded', 'true')
  })

  it('masks the value and toggles visibility', async () => {
    const onToggleAmountsHidden = vi.fn()
    renderNetWorthCard({ amountsHidden: true, onToggleAmountsHidden })
    expect(screen.getByText('$•,•••.••')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show amounts' }))
    expect(onToggleAmountsHidden).toHaveBeenCalledOnce()
  })

  it('focuses the active point by click or keyboard and clears the focus on the next activation', async () => {
    const onFocusDate = vi.fn()
    activeTooltip.label = '2026-05-01'
    activeTooltip.active = true
    const { rerender } = renderNetWorthCard({ onFocusDate })
    expect(screen.getByText('$800')).toBeInTheDocument()
    expect(screen.getByText('2026-05-01')).toBeInTheDocument()
    expect(screen.queryByTestId('focused-dot')).not.toBeInTheDocument()

    await userEvent.click(screen.getByTestId('area-chart'))
    expect(onFocusDate).toHaveBeenCalledWith('2026-05-01')

    onFocusDate.mockClear()
    screen.getByTestId('area-chart').focus()
    await userEvent.keyboard('{Enter}')
    expect(onFocusDate).toHaveBeenCalledWith('2026-05-01')
    await userEvent.keyboard(' ')
    expect(onFocusDate).toHaveBeenCalledTimes(2)

    activeTooltip.active = false
    rerender(<NetWorthCard amountsHidden={false} changePct={25} changeUSD={200} filterCount={0} filters={null} historicalReport={historicalReport} range="YTD" report={report} onFocusDate={onFocusDate} onToggleAmountsHidden={vi.fn()} />)
    expect(screen.getByText('$1,000')).toBeInTheDocument()

    rerender(<NetWorthCard amountsHidden={false} changePct={25} changeUSD={200} filterCount={0} filters={null} focusDate="2026-05-01" historicalReport={historicalReport} range="YTD" report={report} onFocusDate={onFocusDate} onToggleAmountsHidden={vi.fn()} />)
    expect(screen.getByText('$800')).toBeInTheDocument()
    expect(screen.getByText('Focused · click chart to clear')).toBeInTheDocument()
    expect(screen.getByTestId('focused-dot')).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('area-chart'))
    expect(onFocusDate).toHaveBeenLastCalledWith(null)

    rerender(<NetWorthCard amountsHidden={false} changePct={25} changeUSD={200} filterCount={0} filters={null} focusDate="2025-01-01" historicalReport={historicalReport} range="YTD" report={report} onFocusDate={onFocusDate} onToggleAmountsHidden={vi.fn()} />)
    expect(screen.getByText('Focused · click chart to clear')).toBeInTheDocument()
    expect(screen.queryByTestId('focused-dot')).not.toBeInTheDocument()
  })

  it('sorts the historical allocation tooltip by descending value', async () => {
    renderNetWorthCard()

    await userEvent.click(screen.getByRole('radio', { name: 'Historical asset allocation chart' }))

    const tooltipProps = tooltipSpy.mock.calls.at(-1)?.[0] as { content?: unknown } | undefined
    const tooltipContent = tooltipProps?.content as ((props: { active: boolean; label: string; payload: Array<{ color: string; dataKey: string; name: string; value: number }> }) => ReactNode) | undefined
    expect(tooltipContent).toBeTypeOf('function')
    if (!tooltipContent) throw new Error('missing tooltip content')

    render(tooltipContent({
      active: true,
      label: '2026-06-01',
      payload: [
        { color: '#10b981', dataKey: 'Cash & Equivalents', name: 'Cash & Equivalents', value: 400 },
        { color: '#3b82f6', dataKey: 'Public Assets', name: 'Public Assets', value: 700 },
        { color: '#f97316', dataKey: 'Cards', name: 'Cards', value: 200 },
      ],
    }))

    expect(screen.getAllByText(/^(Cash & Equivalents|Public Assets|Cards)$/).map((node) => node.textContent)).toEqual([
      'Public Assets',
      'Cash & Equivalents',
      'Cards',
    ])
  })
})
