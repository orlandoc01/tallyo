import { render, screen } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountSidebar } from './AccountSidebar'
import { AssetClassTable } from './AssetClassTable'
import { AssetsDonut } from './AssetsDonut'
import { NetWorthChart } from './NetWorthChart'
import type { Account, Asset, ClassifierBreakdown, Holding, LiabilityBreakdown, NetWorthPoint } from '../../types/graphql'

const tooltipSpy = vi.fn()

vi.mock('recharts', () => ({
  Area: () => null,
  AreaChart: ({ children }: { children: ReactNode }) => <svg>{children}</svg>,
  Cell: ({ onClick, onMouseEnter }: { onClick?: () => void; onMouseEnter?: () => void }) => <button data-testid="pie-cell" onClick={onClick} onMouseEnter={onMouseEnter} type="button" />,
  Line: () => null,
  Pie: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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

const checkingAccount: Account = { id: 'acc', name: 'Checking', type: 'DEPOSITORY', subtype: 'checking', connection: { id: 'connection', name: 'Chase', owner: { id: 'owner', name: 'Alex' }, isActive: true, provider: null }, owner: { id: 'owner', name: 'Alex' }, closed: false, hidden: false, needsReview: false, manual: false, typeLocked: false, createdAt: '', updatedAt: '', latestSnapshot: { id: 'snapshot-acc', accountId: 'acc', date: '2026-06-01', balanceUSD: 1200, netContributionUSD: 1200, holdings: [], flagged: false }, lastSyncedAt: '2026-06-01T20:00:00Z' }
const rothAccount: Account = { id: 'invest-tax', name: 'Roth 401k', type: 'INVESTMENT', subtype: 'roth 401k', owner: { id: 'owner', name: 'Alex' }, closed: false, hidden: false, needsReview: false, manual: false, typeLocked: false, createdAt: '', updatedAt: '', latestSnapshot: { id: 'snapshot-invest-tax', accountId: 'invest-tax', date: '2026-06-01', balanceUSD: 300, netContributionUSD: 300, holdings: [], flagged: false } }
const brokerageAccount: Account = { id: 'invest', name: 'Brokerage', type: 'INVESTMENT', subtype: 'brokerage', owner: { id: 'owner', name: 'Alex' }, closed: false, hidden: false, needsReview: false, manual: false, typeLocked: false, createdAt: '', updatedAt: '', latestSnapshot: { id: 'snapshot-invest', accountId: 'invest', date: '2026-06-01', balanceUSD: 300, netContributionUSD: 300, holdings: [], flagged: false } }

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
    holdings: [
      {
        asset: usdAsset,
        totalQuantity: 1200,
        valueUSD: 1200,
        percentOfClassifier: 100,
        holdings: [holdingRow(usdAsset, checkingAccount, 1200, 1200)],
      },
    ],
  },
  {
    classifier: 'PUBLIC',
    label: 'Public Assets',
    valueUSD: 600,
    percentOfAssets: 33.33,
    assetCount: 2,
    holdings: [
      {
        asset: aaplAsset,
        totalQuantity: 6,
        valueUSD: 600,
        percentOfClassifier: 100,
        holdings: [holdingRow(aaplAsset, rothAccount, 3, 300), holdingRow(aaplAsset, brokerageAccount, 3, 300)],
      },
    ],
  },
  {
    classifier: 'REAL_ESTATE',
    label: 'Real Estate',
    valueUSD: 400,
    percentOfAssets: 6.67,
    assetCount: 1,
    holdings: [
      {
        asset: homeAsset,
        totalQuantity: 1,
        valueUSD: 400,
        percentOfClassifier: 100,
        holdings: [],
      },
    ],
  },
]

const liabilityBreakdown: LiabilityBreakdown[] = [
  {
    category: 'CARD',
    label: 'Cards',
    valueUSD: 200,
    percentOfLiabilities: 100,
    accountCount: 1,
    accounts: [{ id: 'card', name: 'Credit Card', type: 'CREDIT', owner: { id: 'owner', name: 'Alex' }, closed: false, hidden: false, needsReview: false, manual: false, typeLocked: false, createdAt: '', updatedAt: '', latestSnapshot: { id: 'snapshot-card', accountId: 'card', date: '2026-06-01', balanceUSD: 200, netContributionUSD: -200, holdings: [], flagged: false } }],
  },
]

const points: NetWorthPoint[] = [
  { date: '2026-05-01', totalAssetsUSD: 1000, totalLiabilitiesUSD: 200, netWorthUSD: 800 },
  { date: '2026-06-01', totalAssetsUSD: 1200, totalLiabilitiesUSD: 200, netWorthUSD: 1000 },
]

function renderSidebar(overrides: Partial<ComponentProps<typeof AccountSidebar>> = {}) {
  return render(<AccountSidebar breakdown={breakdown} liabilityBreakdown={liabilityBreakdown} netWorth={1000} {...overrides} />)
}

describe('wealth components', () => {
  beforeEach(() => {
    tooltipSpy.mockClear()
  })

  it('renders collapsed account sidebar groups', async () => {
    renderSidebar()
    expect(screen.getByText('Net Worth')).toBeInTheDocument()
    expect(screen.getByText('Cards')).toBeInTheDocument()
    expect(screen.getByText('Deposits')).toBeInTheDocument()
    expect(screen.getByText('Investments')).toBeInTheDocument()
    expect(screen.getByText('Tax Advantaged')).toBeInTheDocument()
    expect(screen.queryByText('Checking')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Expand Deposits accounts' }))
    expect(screen.getByText('Checking')).toBeInTheDocument()
  })

  it('moves configured subtypes into the tax-advantaged group', async () => {
    renderSidebar()

    await userEvent.click(screen.getByRole('button', { name: 'Expand Tax Advantaged accounts' }))
    expect(screen.getByText('Roth 401k')).toBeInTheDocument()
    expect(screen.queryByText('Brokerage')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Expand Investments accounts' }))
    expect(screen.getByText('Brokerage')).toBeInTheDocument()
  })

  it('shows the account institution and sync recency under the amount', async () => {
    renderSidebar()
    await userEvent.click(screen.getByRole('button', { name: 'Expand Deposits accounts' }))
    expect(screen.getByText('Chase')).toBeInTheDocument()
    expect(screen.getByText(/^\d+[mhd] ago$|^just now$/)).toBeInTheDocument()
  })

  it('does not render an icon in account rows', async () => {
    renderSidebar({ onAccountClick: vi.fn() })
    await userEvent.click(screen.getByRole('button', { name: 'Expand Deposits accounts' }))

    expect(screen.getByLabelText('Open details for Checking').querySelector('svg')).toBeNull()
  })

  it('falls back to account type when subtype is missing', async () => {
    renderSidebar()
    await userEvent.click(screen.getByRole('button', { name: 'Expand Cards accounts' }))
    expect(screen.getByText('Credit')).toBeInTheDocument()
  })

  it('invokes onAccountClick when an account row is clicked', async () => {
    const onAccountClick = vi.fn()
    renderSidebar({ onAccountClick })
    await userEvent.click(screen.getByRole('button', { name: 'Expand Deposits accounts' }))
    await userEvent.click(screen.getByLabelText('Open details for Checking'))
    expect(onAccountClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'acc', name: 'Checking', subtype: 'checking' }))
  })

  it('renders selected account groups with the same active state as account rows', () => {
    renderSidebar({ selectedAccountGroupIds: ['DEPOSITS'] })

    const section = screen.getByText('Deposits').closest('section')
    expect(section).toHaveClass('border-neutral-100')
    expect(section).not.toHaveClass('border-brand-300')
    expect(section?.firstElementChild).toHaveClass('bg-brand-50', 'ring-brand-200')
    expect(section?.firstElementChild?.className).not.toContain('hover:bg-neutral-100')
    expect(screen.getByRole('button', { name: 'Expand Deposits accounts' }).className).not.toContain('ring-brand-200')
  })

  it('keeps inactive account rows on the group background and shades on hover', async () => {
    renderSidebar({ onAccountClick: vi.fn() })

    await userEvent.click(screen.getByRole('button', { name: 'Expand Deposits accounts' }))

    const row = screen.getByLabelText('Open details for Checking')
    expect(row).toHaveClass('bg-neutral-50')
    expect(row).toHaveClass('border-transparent')
    expect(row.className).toContain('hover:bg-neutral-100')
    expect(row.className).not.toContain('hover:border-brand-300')
  })

  it('keeps selected account rows on the active filter background', async () => {
    renderSidebar({ onAccountClick: vi.fn(), selectedAccountIds: ['acc'] })

    await userEvent.click(screen.getByRole('button', { name: 'Expand Deposits accounts' }))

    expect(screen.getByLabelText('Open details for Checking')).toHaveClass('bg-brand-50')
  })

  it('renders accounts as static rows without an onAccountClick handler', async () => {
    renderSidebar()
    await userEvent.click(screen.getByRole('button', { name: 'Expand Deposits accounts' }))
    expect(screen.queryByLabelText('Open details for Checking')).not.toBeInTheDocument()
  })

  it('shows credit accounts in the liability section of the sidebar', async () => {
    renderSidebar()
    await userEvent.click(screen.getByRole('button', { name: 'Expand Cards accounts' }))
    expect(screen.getByText('Credit Card')).toBeInTheDocument()
  })

  it('renders account groupings without the summary header when requested', () => {
    renderSidebar({ heading: 'Accounts', showSummary: false })
    expect(screen.getByText('Accounts')).toBeInTheDocument()
    expect(screen.queryByText('$1,000.00')).not.toBeInTheDocument()
  })

  it('renders non-expandable classifier bars with no account rows when the caller lacks read:holdings', () => {
    renderSidebar({ canReadHoldings: false })
    expect(screen.getByText('Cash & Equivalents')).toBeInTheDocument()
    expect(screen.getByText('Public Assets')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Expand Cash & Equivalents accounts' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Expand Public Assets accounts' })).not.toBeInTheDocument()
    expect(screen.queryByText('Checking')).not.toBeInTheDocument()
    // Liabilities are ungated and stay expandable.
    expect(screen.getByRole('button', { name: 'Expand Cards accounts' })).toBeInTheDocument()
  })

  it('renders asset class table rows collapsed by default', async () => {
    render(<AssetClassTable breakdown={breakdown} liabilityBreakdown={liabilityBreakdown} view="ASSETS" />)
    expect(screen.getAllByText('1 holdings')).toHaveLength(2)
    expect(screen.getByText('2 holdings')).toBeInTheDocument()
    expect(screen.getByText('Cash & Equivalents')).toBeInTheDocument()
    expect(screen.queryByText('US Dollar')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Expand Cash & Equivalents holdings' }))
    expect(screen.getAllByText('US Dollar').length).toBeGreaterThan(0)
    expect(screen.queryByText('Qty 1,200')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Expand Public Assets holdings' }))
    expect(screen.getByText('Qty 6')).toBeInTheDocument()
    expect(screen.getByText('Apple Inc')).toHaveAttribute('title', 'Apple Inc')

    await userEvent.click(screen.getByRole('button', { name: 'Expand Real Estate holdings' }))
    expect(screen.getByText('Primary Home')).toBeInTheDocument()
    expect(screen.queryByText('Qty 1')).not.toBeInTheDocument()
  })

  it('omits unavailable aggregate quantities while keeping valuations', async () => {
    const valueOnlyBreakdown: ClassifierBreakdown[] = [{
      classifier: 'STABLECOIN',
      label: 'Stablecoins',
      valueUSD: 76_714.93,
      percentOfAssets: 100,
      assetCount: 1,
      holdings: [{
        asset: { id: 'value-only', assetType: 'CRYPTO', identifier: 'MOO', name: 'Moo Aero msUSD-USDC', classifier: 'STABLECOIN', trackingTicker: null, trackingMultiplier: 1, priceConnectivity: 'HEALTHY', investmentConnectivity: 'HEALTHY', adapterSources: [] },
        totalQuantity: null,
        valueUSD: 76_714.93,
        percentOfClassifier: 100,
        holdings: [],
      }],
    }]

    render(<AssetClassTable breakdown={valueOnlyBreakdown} liabilityBreakdown={[]} view="ASSETS" />)
    await userEvent.click(screen.getByRole('button', { name: 'Expand Stablecoins holdings' }))

    expect(screen.getByText('Moo Aero msUSD-USDC')).toBeInTheDocument()
    expect(screen.getAllByText('$76,714.93')).toHaveLength(2)
    expect(screen.queryByText(/^Qty /)).not.toBeInTheDocument()
  })

  it('selects asset class table groups from header clicks without expanding them', async () => {
    const onSelectClassifier = vi.fn()
    render(<AssetClassTable breakdown={breakdown} liabilityBreakdown={liabilityBreakdown} onSelectClassifier={onSelectClassifier} view="ASSETS" />)

    await userEvent.click(screen.getByText('Cash & Equivalents'))

    expect(onSelectClassifier).toHaveBeenCalledWith('CASH')
    expect(screen.queryByText('US Dollar')).not.toBeInTheDocument()
  })

  it('masks wealth amounts while leaving percentages visible', async () => {
    render(
      <>
        <AccountSidebar amountsHidden breakdown={breakdown} liabilityBreakdown={liabilityBreakdown} netWorth={1000} />
        <AssetClassTable amountsHidden breakdown={breakdown} liabilityBreakdown={liabilityBreakdown} view="ASSETS" />
        <AssetsDonut amountsHidden breakdown={breakdown} liabilityBreakdown={liabilityBreakdown} totalAssets={1200} totalLiabilities={200} view="ASSETS" />
        <NetWorthChart amountsHidden onRangeChange={vi.fn()} points={points} positive range="YTD" />
      </>,
    )

    expect(screen.getAllByText('....').length).toBeGreaterThan(0)
    expect(screen.getAllByText('60.0%').length).toBeGreaterThan(0)
  })

  it('renders liability rows collapsed by default when view is LIABILITIES', async () => {
    render(<AssetClassTable breakdown={breakdown} liabilityBreakdown={liabilityBreakdown} view="LIABILITIES" />)
    expect(screen.getByText('Cards')).toBeInTheDocument()
    expect(screen.queryByText('Credit Card')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Expand Cards liabilities' }))
    expect(screen.getByText('Credit Card')).toBeInTheDocument()
  })

  it('selects liability table groups from header clicks without expanding them', async () => {
    const onSelectLiabilityCategory = vi.fn()
    render(<AssetClassTable breakdown={breakdown} liabilityBreakdown={liabilityBreakdown} onSelectLiabilityCategory={onSelectLiabilityCategory} view="LIABILITIES" />)

    await userEvent.click(screen.getByText('Cards'))

    expect(onSelectLiabilityCategory).toHaveBeenCalledWith('CARD')
    expect(screen.queryByText('Credit Card')).not.toBeInTheDocument()
  })

  it('expands the selected classifier row', () => {
    render(<AssetClassTable breakdown={breakdown} liabilityBreakdown={liabilityBreakdown} selectedClassifier="CASH" view="ASSETS" />)
    const section = screen.getByText('Cash & Equivalents').closest('section')
    expect(section?.firstElementChild).toHaveClass('bg-brand-50', 'ring-brand-200')
    expect(section?.firstElementChild?.className).not.toContain('hover:bg-neutral-100')
    expect(screen.getAllByText('US Dollar').length).toBeGreaterThan(0)
  })

  it('renders donut and chart controls', async () => {
    const onRangeChange = vi.fn()
    const onSelectClassifier = vi.fn()
    render(
      <>
        <AssetsDonut breakdown={breakdown} liabilityBreakdown={liabilityBreakdown} onSelectClassifier={onSelectClassifier} selectedClassifier="CASH" totalAssets={1200} totalLiabilities={200} view="ASSETS" />
        <NetWorthChart onRangeChange={onRangeChange} points={points} positive range="YTD" />
      </>,
    )
    expect(screen.getByText('Breakdown')).toBeInTheDocument()
    expect(screen.getByText('Cash & Equivalents')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Cash & Equivalents'))
    expect(onSelectClassifier).toHaveBeenCalledWith(null)
    await userEvent.click(screen.getAllByTestId('pie-cell')[0])
    expect(onSelectClassifier).toHaveBeenLastCalledWith(null)
    const rangeControl = screen.getByRole('radio', { name: '1Y' })
    expect(rangeControl.closest('section')).toContainElement(screen.getByText('Wealth history'))
    await userEvent.click(rangeControl)
    expect(onRangeChange).toHaveBeenCalledWith('ONE_YEAR')
  })

  it('sorts the historical allocation tooltip by descending value', async () => {
    render(
      <NetWorthChart
        classifierSeries={[
          { classifier: 'CASH', date: '2026-06-01', label: 'Cash & Equivalents', valueUSD: 400 },
          { classifier: 'PUBLIC', date: '2026-06-01', label: 'Public Assets', valueUSD: 700 },
        ]}
        liabilitySeries={[{ category: 'CARD', date: '2026-06-01', label: 'Cards', valueUSD: 200 }]}
        onRangeChange={vi.fn()}
        points={points}
        positive
        range="YTD"
      />,
    )

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

    expect(screen.getAllByText(/Cash & Equivalents|Public Assets|Cards/).map((node) => node.textContent)).toEqual([
      'Public Assets',
      'Cash & Equivalents',
      'Cards',
    ])
  })

  it('toggles an already selected classifier off', async () => {
    const onSelectClassifier = vi.fn()
    render(
      <AssetsDonut breakdown={breakdown} liabilityBreakdown={liabilityBreakdown} onSelectClassifier={onSelectClassifier} selectedClassifier="CASH" totalAssets={1200} totalLiabilities={200} view="ASSETS" />,
    )

    await userEvent.click(screen.getByText('Cash & Equivalents'))
    expect(onSelectClassifier).toHaveBeenCalledWith(null)

    await userEvent.click(screen.getAllByTestId('pie-cell')[0])
    expect(onSelectClassifier).toHaveBeenLastCalledWith(null)
  })

  it('selects asset donut slices only on click, not hover', async () => {
    const user = userEvent.setup()
    const onSelectClassifier = vi.fn()
    render(
      <AssetsDonut breakdown={breakdown} liabilityBreakdown={liabilityBreakdown} onSelectClassifier={onSelectClassifier} totalAssets={1200} totalLiabilities={200} view="ASSETS" />,
    )

    const cashSlice = screen.getAllByTestId('pie-cell')[0]
    await user.hover(cashSlice)
    expect(onSelectClassifier).not.toHaveBeenCalled()

    await user.click(cashSlice)
    expect(onSelectClassifier).toHaveBeenCalledWith('CASH')
  })

  it('switches donut to liabilities view', async () => {
    const onViewChange = vi.fn()
    render(<AssetsDonut breakdown={breakdown} liabilityBreakdown={liabilityBreakdown} totalAssets={1200} totalLiabilities={200} view="ASSETS" onViewChange={onViewChange} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Liabilities' }))
    expect(onViewChange).toHaveBeenCalledWith('LIABILITIES')
  })

  it('renders donut without a selected classifier', () => {
    render(<AssetsDonut breakdown={breakdown} liabilityBreakdown={liabilityBreakdown} totalAssets={1200} totalLiabilities={200} view="ASSETS" />)
    expect(screen.getByText('Cash & Equivalents')).toBeInTheDocument()
  })

  it('renders liability view in donut', () => {
    render(<AssetsDonut breakdown={breakdown} liabilityBreakdown={liabilityBreakdown} totalAssets={1200} totalLiabilities={200} view="LIABILITIES" />)
    expect(screen.getByText('Cards')).toBeInTheDocument()
  })

  it('renders expandable asset legend details in the donut', async () => {
    const onSelectClassifier = vi.fn()
    render(
      <AssetsDonut breakdown={breakdown} expandableLegend liabilityBreakdown={liabilityBreakdown} onSelectClassifier={onSelectClassifier} selectedClassifier="CASH" totalAssets={1200} totalLiabilities={200} view="ASSETS" />,
    )

    expect(screen.getByText('Checking')).toBeInTheDocument()
    expect(screen.getByText('Checking')).toHaveAttribute('title', 'Checking')
    expect(screen.getByText('Checking')).toHaveClass('whitespace-normal', 'break-words')
    expect(screen.getByText('Cash & Equivalents').closest('.rounded-2xl')).toHaveClass('min-w-0')
    expect(screen.getByText('USD')).toHaveAttribute('title', 'US Dollar')
    await userEvent.click(screen.getByText('Cash & Equivalents'))
    expect(onSelectClassifier).toHaveBeenCalledWith(null)
  })

  it('renders expandable liability legend details in the donut', async () => {
    const onSelectLiabilityCategory = vi.fn()
    render(
      <AssetsDonut breakdown={breakdown} expandableLegend liabilityBreakdown={liabilityBreakdown} onSelectLiabilityCategory={onSelectLiabilityCategory} selectedLiabilityCategory="CARD" totalAssets={1200} totalLiabilities={200} view="LIABILITIES" />,
    )

    expect(screen.getByText('Credit Card')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Cards'))
    expect(onSelectLiabilityCategory).toHaveBeenCalledWith(null)
  })
})
