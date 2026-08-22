import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { CombinedError } from 'urql'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { absoluteRoutePath, NET_WORTH_PATHS } from '../routes'
import { LocationPathname, LocationSearch, MobileHeaderActionsHost, renderWithProviders } from '../test/renderWithProviders'
import { NetWorthPage } from './NetWorthPage'

vi.mock('../components/institutions/AccountDetailModal', () => ({
  AccountDetailModal: ({ account, activeTab, basePath = `/accounts/${account.id}`, tabSearch = '', onClose }: { account: { id: string }; activeTab?: 'info' | 'valuation'; basePath?: string; tabSearch?: string; onClose: () => void }) => (
    <div aria-label={`Account ${account.id}`} onClick={(event) => event.stopPropagation()} role="dialog">
      <p>Account tab {activeTab}</p>
      <a href={`${basePath}/info${tabSearch}`}>Info</a>
      <a href={`${basePath}/valuation${tabSearch}`}>Valuation</a>
      <button onClick={onClose} type="button">Close account modal</button>
    </div>
  ),
}))
vi.mock('../components/wealth/NetWorthChart', () => ({ NetWorthChart: ({ onRangeChange }: { onRangeChange: (range: 'ONE_MONTH') => void }) => <button onClick={() => onRangeChange('ONE_MONTH')} type="button">Chart</button> }))
vi.mock('../components/wealth/AssetsDonut', () => ({ AssetsDonut: () => <div>Donut</div> }))
vi.mock('../components/wealth/AccountSidebar', () => ({
  AccountSidebar: ({ amountsHidden, canReadHoldings = true, heading, onAccountClick, onAccountGroupClick }: { amountsHidden?: boolean; canReadHoldings?: boolean; heading?: string; onAccountClick?: (account: { id: string; name: string }) => void; onAccountGroupClick?: (groupId: 'DEPOSITS' | 'INVESTMENTS', accountIds: string[]) => void }) => (
    <div data-account-sidebar>
      {heading ?? 'Net Worth'} {amountsHidden ? 'hidden' : 'shown'}
      {canReadHoldings ? (
        <>
          <button onClick={() => onAccountGroupClick?.('INVESTMENTS', ['acct-invest'])} type="button">Investments group</button>
          <button onClick={() => onAccountGroupClick?.('DEPOSITS', ['acct-cash', 'acct-savings'])} type="button">Deposits group</button>
          <button onClick={() => onAccountClick?.({ id: 'acct-cash', name: 'Checking' })} type="button">Checking account</button>
          <button onClick={() => onAccountClick?.({ id: 'acct-savings', name: 'Savings' })} type="button">Savings account</button>
        </>
      ) : null}
    </div>
  ),
}))
vi.mock('../components/wealth/AssetClassTable', () => ({
  AssetClassTable: ({ amountsHidden, onAssetClick }: { amountsHidden?: boolean; onAssetClick?: (holding: { asset: { id: string; assetType?: string }; holdings: { account: { id: string } }[] }) => void }) => (
    <div>
      Detailed {amountsHidden ? 'hidden' : 'shown'}
      <button type="button">Expand Cash details</button>
      <button onClick={() => onAssetClick?.({ asset: { id: 'asset-usd', assetType: 'CURRENCY' }, holdings: [] })} type="button">Edit US Dollar</button>
      <button onClick={() => onAssetClick?.({ asset: { id: 'asset-home', assetType: 'REAL_ESTATE' }, holdings: [{ account: { id: 'acct-home' } }] })} type="button">Open Primary Home</button>
    </div>
  ),
}))
vi.mock('../components/wealth/AssetEditModal', () => ({
  AssetEditModal: ({ asset, activeTab, basePath, tabSearch = '', onClose }: { asset: { id: string; identifier?: string; name?: string | null }; activeTab?: string; basePath: string; tabSearch?: string; onClose: () => void }) => (
    <div aria-label={`Edit ${asset.name ?? asset.identifier ?? asset.id}`} onClick={(event) => event.stopPropagation()} role="dialog">
      <p>Asset tab {activeTab}</p>
      <a href={`${basePath}/tracking${tabSearch}`}>Tracking</a>
      <button onClick={onClose} type="button">Close asset modal</button>
    </div>
  ),
  isAssetEditTab: (tab: string) => tab === 'info' || tab === 'tracking',
}))
vi.mock('../hooks/useNetWorth', () => ({ useNetWorth: vi.fn(), useHistoricalNetWorth: vi.fn() }))
vi.mock('../hooks/useEntityQueries', () => {
  const owners = [{ id: 'owner', name: 'Alex' }]
  const accounts = [
    { id: 'acct-cash', name: 'Checking', type: 'DEPOSITORY', subtype: 'checking', owner: owners[0], hidden: false, closed: false, manual: false, createdAt: '', updatedAt: '' },
    { id: 'acct-savings', name: 'Savings', type: 'DEPOSITORY', subtype: 'savings', owner: owners[0], hidden: false, closed: false, manual: false, createdAt: '', updatedAt: '' },
    { id: 'acct-invest', name: 'Brokerage', type: 'INVESTMENT', subtype: 'brokerage', owner: owners[0], hidden: false, closed: false, manual: false, createdAt: '', updatedAt: '' },
    { id: 'acct-invest-empty', name: 'Empty Brokerage', type: 'INVESTMENT', subtype: 'brokerage', owner: owners[0], hidden: false, closed: false, manual: false, createdAt: '', updatedAt: '' },
    { id: 'acct-home', name: 'Primary Home', type: 'PROPERTY', subtype: null, owner: owners[0], hidden: false, closed: false, manual: false, createdAt: '', updatedAt: '' },
  ]
  return {
    useAccounts: () => ({ accounts }),
    useOwners: () => ({ owners }),
  }
})

const { useNetWorth, useHistoricalNetWorth } = await import('../hooks/useNetWorth')
const mockedUseNetWorth = vi.mocked(useNetWorth)
const mockedUseHistoricalNetWorth = vi.mocked(useHistoricalNetWorth)

const report = {
  currentNetWorthUSD: 1000,
  currentAssetsUSD: 1200,
  currentLiabilitiesUSD: 200,
  classifierBreakdown: [
    {
      classifier: 'CASH' as const,
      label: 'Cash & Equivalents',
      valueUSD: 1200,
      percentOfAssets: 100,
      assetCount: 1,
      holdings: [
        {
          asset: { id: 'asset-usd', assetType: 'CURRENCY' as const, identifier: 'USD', name: 'US Dollar', classifier: 'CASH' as const, trackingTicker: null, trackingMultiplier: 1, priceConnectivity: 'HEALTHY' as const, investmentConnectivity: 'HEALTHY' as const, adapterSources: [] },
          totalQuantity: 1200,
          valueUSD: 1200,
          percentOfClassifier: 100,
          holdings: [],
        },
      ],
    },
    {
      classifier: 'PUBLIC' as const,
      label: 'Public Assets',
      valueUSD: 600,
      percentOfAssets: 33.33,
      assetCount: 1,
      holdings: [
        {
          asset: { id: 'asset-aapl', assetType: 'SECURITY' as const, identifier: 'AAPL', name: 'Apple Inc', classifier: 'PUBLIC' as const, trackingTicker: null, trackingMultiplier: 1, priceConnectivity: 'HEALTHY' as const, investmentConnectivity: 'HEALTHY' as const, adapterSources: [] },
          totalQuantity: 6,
          valueUSD: 600,
          percentOfClassifier: 100,
          holdings: [{
            valueUSD: 600,
            account: { id: 'acct-invest', name: 'Brokerage', type: 'INVESTMENT' as const, subtype: 'brokerage', owner: { id: 'owner', name: 'Alex' }, hidden: false, closed: false, manual: false, createdAt: '', updatedAt: '' },
          }],
        },
      ],
    },
  ],
  liabilityBreakdown: [],
}

// Series whose first point (800) yields a +25.0% gain against the report's
// current net worth of 1000.
const gainingSeries = [
  { date: '2026-06-01', totalAssetsUSD: 960, totalLiabilitiesUSD: 160, netWorthUSD: 800 },
  { date: '2026-06-04', totalAssetsUSD: 1200, totalLiabilitiesUSD: 200, netWorthUSD: 1000 },
]

// Series whose first point (1250) yields a -20.0% loss against current net worth.
const losingSeries = [
  { date: '2026-06-01', totalAssetsUSD: 1450, totalLiabilitiesUSD: 200, netWorthUSD: 1250 },
  { date: '2026-06-04', totalAssetsUSD: 1200, totalLiabilitiesUSD: 200, netWorthUSD: 1000 },
]

const netWorthScopes = ['read:wealth', 'read:holdings', 'read:assets']

function mockHistorical(series: typeof gainingSeries) {
  mockedUseHistoricalNetWorth.mockReturnValue({
    fetching: false,
    historicalReport: { series, classifierSeries: [], liabilitySeries: [] },
  } as unknown as ReturnType<typeof useHistoricalNetWorth>)
}

describe('NetWorthPage', () => {
  beforeEach(() => {
    mockedUseNetWorth.mockReset()
    mockedUseHistoricalNetWorth.mockReturnValue({ fetching: false, historicalReport: undefined } as unknown as ReturnType<typeof useHistoricalNetWorth>)
    localStorage.clear()
  })

  it('shows loading state', () => {
    mockedUseNetWorth.mockReturnValue({ fetching: true, report: undefined } as unknown as ReturnType<typeof useNetWorth>)
    renderPage()
    const loadingDiv = screen.getByText('Loading net worth...')
    expect(loadingDiv).toBeInTheDocument()
    expect(loadingDiv).toHaveClass('lg:min-h-screen')
  })

  it('shows error state', () => {
    mockedUseNetWorth.mockReturnValue({ fetching: false, report: undefined, error: new CombinedError({ graphQLErrors: ['Nope'] }) } as unknown as ReturnType<typeof useNetWorth>)
    renderPage()
    expect(screen.getByText(/Failed to load net worth/)).toBeInTheDocument()
  })

  it('shows empty state', () => {
    mockedUseNetWorth.mockReturnValue({ fetching: false, report: undefined } as unknown as ReturnType<typeof useNetWorth>)
    renderPage()
    expect(screen.getByText(/No wealth data yet/)).toBeInTheDocument()
  })

  it('renders report totals', () => {
    mockedUseNetWorth.mockReturnValue({ fetching: false, report } as unknown as ReturnType<typeof useNetWorth>)
    renderPage()
    expect(screen.getByText('Household Wealth')).toBeInTheDocument()
    expect(screen.getAllByText('Chart')).toHaveLength(2)
    expect(screen.getAllByText('Donut')).toHaveLength(2)
    expect(screen.getByText('Accounts shown')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Filters$/i })).toBeInTheDocument()
  })

  it('does not force a mobile viewport-height layout', () => {
    mockedUseNetWorth.mockReturnValue({ fetching: false, report } as unknown as ReturnType<typeof useNetWorth>)
    const { container } = renderPage()
    // MobileHeaderActionsHost is the first child; NetWorthPage root is last
    const pageRoot = container.lastElementChild

    expect(pageRoot).not.toHaveClass('min-h-screen')
    expect(pageRoot).toHaveClass('lg:min-h-screen')
  })

  it('applies owner filters from the page dropdown', async () => {
    mockedUseNetWorth.mockReturnValue({ fetching: false, report } as unknown as ReturnType<typeof useNetWorth>)
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: /^Filters$/i }))
    await userEvent.click(screen.getByRole('button', { name: /Owner/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Alex' }))

    expect(mockedUseNetWorth).toHaveBeenLastCalledWith(expect.objectContaining({ ownerIds: ['owner'] }))
  })

  it('registers mobile header actions with the filters menu', async () => {
    mockedUseNetWorth.mockReturnValue({ fetching: false, report } as unknown as ReturnType<typeof useNetWorth>)
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Open net worth filters' }))
    const dialog = screen.getByRole('dialog', { name: 'Filters' })
    expect(dialog).toHaveClass('fixed')
    expect(dialog).toHaveStyle({ top: '48px' })
    expect(dialog.firstElementChild).toHaveClass('absolute', 'right-0', 'top-0')
    expect(dialog.firstElementChild).toHaveClass('w-[min(20rem,100vw)]')
    await userEvent.click(screen.getByRole('button', { name: /Owner/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Alex' }))

    expect(mockedUseNetWorth).toHaveBeenLastCalledWith(expect.objectContaining({ ownerIds: ['owner'] }))
  })

  it('masks amounts across the page while leaving percentages visible', async () => {
    mockedUseNetWorth.mockReturnValue({ fetching: false, report } as unknown as ReturnType<typeof useNetWorth>)
    mockHistorical(gainingSeries)
    renderPage(['/net-worth?range=ONE_MONTH&account_ids=acct-cash'])

    expect(screen.getByText('$1,000.00')).toBeInTheDocument()
    // Hide amounts button appears in both mobile header and desktop toolbar (dual-view in
    // JSDOM). Click the desktop one ([1]): it sits inside the page's clear-account-filters-
    // on-outside-click region, so this also guards against the toggle wiping account_ids.
    await userEvent.click(screen.getAllByRole('button', { name: 'Hide amounts' })[1])

    expect(screen.getAllByRole('button', { name: 'Show amounts' }).length).toBeGreaterThan(0)
    expect(screen.getByTestId('location-search').textContent).toBe('?range=ONE_MONTH&account_ids=acct-cash&hide_amounts=true')
    expect(screen.queryByText('$1,000.00')).not.toBeInTheDocument()
    expect(screen.getAllByText('....').length).toBeGreaterThan(0)
    expect(screen.getAllByText((_, element) => element?.textContent?.includes('+25.0% over selected range') ?? false).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Net Worth hidden')).toHaveLength(1)
    expect(screen.getByText('Accounts hidden')).toBeInTheDocument()
    expect(screen.getAllByText('Detailed hidden')).toHaveLength(2)
  })

  it('loads the amount visibility toggle from the URL', async () => {
    mockedUseNetWorth.mockReturnValue({ fetching: false, report } as unknown as ReturnType<typeof useNetWorth>)
    const user = userEvent.setup()
    renderPage(['/net-worth?hide_amounts=true'])

    expect(screen.getAllByRole('button', { name: 'Show amounts' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('....').length).toBeGreaterThan(0)

    await user.click(screen.getAllByRole('button', { name: 'Show amounts' })[0])

    expect(screen.getAllByRole('button', { name: 'Hide amounts' }).length).toBeGreaterThan(0)
    expect(screen.getByTestId('location-search').textContent).toBe('')
  })

  it('shows selected filters from the URL and can clear them', async () => {
    mockedUseNetWorth.mockReturnValue({ fetching: false, report } as unknown as ReturnType<typeof useNetWorth>)
    renderPage(['/net-worth?owner=owner&account_ids=acct-cash'])

    expect(screen.getByRole('button', { name: /Filters: 2 selected/i })).toBeInTheDocument()
    expect(mockedUseNetWorth).toHaveBeenCalledWith({ ownerIds: ['owner'] }, false)
    expect(mockedUseNetWorth).toHaveBeenLastCalledWith(expect.objectContaining({ ownerIds: ['owner'], accountIds: ['acct-cash'] }))

    await userEvent.click(screen.getByRole('button', { name: /Filters: 2 selected/i }))
    await userEvent.click(screen.getByRole('button', { name: /Clear all/i }))

    expect(mockedUseNetWorth).toHaveBeenLastCalledWith(expect.not.objectContaining({ ownerIds: expect.any(Array), accountIds: expect.any(Array) }))
  })

  it('ignores account filters and hides account controls without holdings scope', async () => {
    mockedUseNetWorth.mockReturnValue({ fetching: false, report } as unknown as ReturnType<typeof useNetWorth>)
    renderPage(['/net-worth?owner=owner&account_ids=acct-cash'], ['read:wealth'])

    expect(mockedUseNetWorth).toHaveBeenLastCalledWith({ ownerIds: ['owner'] })
    expect(mockedUseHistoricalNetWorth).toHaveBeenLastCalledWith(expect.objectContaining({ filters: { ownerIds: ['owner'] } }))
    expect(screen.getByText('Household Wealth')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Filters: 1 selected/i }))
    expect(screen.getByRole('button', { name: /Owner/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Account type/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Account/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Investments group' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Checking account' })).not.toBeInTheDocument()
  })

  it('clears invalid ID filters from the URL after a server rejection', async () => {
    mockedUseNetWorth.mockImplementation((input, pause) => {
      if (pause) return { fetching: false, report: undefined } as unknown as ReturnType<typeof useNetWorth>
      if (input.ownerIds?.length || input.accountIds?.length) {
        return { fetching: false, report: undefined, error: { message: '[GraphQL] invalid global id' } } as unknown as ReturnType<typeof useNetWorth>
      }
      return { fetching: false, report } as unknown as ReturnType<typeof useNetWorth>
    })
    renderPage(['/net-worth?range=ONE_MONTH&owner=sam&account_ids=checking'])

    expect(screen.getByText('Household Wealth')).toBeInTheDocument()
    expect(mockedUseNetWorth).toHaveBeenCalledWith(expect.objectContaining({ ownerIds: ['sam'], accountIds: ['checking'] }))
    await waitFor(() => expect(screen.getByTestId('location-search').textContent).toBe('?range=ONE_MONTH'))
  })

  it('ignores legacy account type URL params and opens sidebar account clicks in the valuation modal', async () => {
    mockedUseNetWorth.mockReturnValue({ fetching: false, report } as unknown as ReturnType<typeof useNetWorth>)
    renderPage(['/net-worth?account_types=INVESTMENTS'])

    expect(mockedUseNetWorth).toHaveBeenLastCalledWith(expect.not.objectContaining({ accountIds: expect.any(Array) }))

    await userEvent.click(screen.getAllByRole('button', { name: 'Checking account' })[0])

    expect(screen.getByTestId('location-pathname').textContent).toBe('/net-worth/accounts/acct-cash/valuation')
    expect(screen.getByTestId('location-search').textContent).toBe('?account_types=INVESTMENTS')
    expect(screen.getByRole('dialog', { name: 'Account acct-cash' })).toBeInTheDocument()
    expect(screen.getByText('Account tab valuation')).toBeInTheDocument()
    expect(mockedUseNetWorth).toHaveBeenLastCalledWith(expect.not.objectContaining({ accountIds: expect.any(Array) }))
  })

  it('focuses sidebar account groups as account IDs without encoding account types', async () => {
    mockedUseNetWorth.mockReturnValue({ fetching: false, report } as unknown as ReturnType<typeof useNetWorth>)
    renderPage()

    await userEvent.click(screen.getAllByRole('button', { name: 'Investments group' })[0])
    expect(mockedUseNetWorth).toHaveBeenLastCalledWith(expect.objectContaining({ accountIds: ['acct-invest'] }))
    expect(screen.getByTestId('location-search').textContent).toBe('?account_ids=acct-invest')

    await userEvent.click(screen.getAllByRole('button', { name: 'Deposits group' })[0])
    expect(mockedUseNetWorth).toHaveBeenLastCalledWith(expect.objectContaining({ accountIds: ['acct-invest', 'acct-cash', 'acct-savings'] }))
    expect(screen.getByTestId('location-search').textContent).toBe('?account_ids=acct-invest%2Cacct-cash%2Cacct-savings')
  })

  it('limits net worth account type filters to accounts in the report', async () => {
    mockedUseNetWorth.mockReturnValue({ fetching: false, report } as unknown as ReturnType<typeof useNetWorth>)
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: /^Filters$/i }))
    await userEvent.click(screen.getByRole('button', { name: /Account type/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Investments' }))

    expect(mockedUseNetWorth).toHaveBeenLastCalledWith(expect.objectContaining({ accountIds: ['acct-invest'] }))
    expect(screen.getByTestId('location-search').textContent).toBe('?account_ids=acct-invest')
    expect(screen.getByRole('button', { name: /Filters: 1 selected/i })).toBeInTheDocument()
  })

  it('unfocuses sidebar account groups by removing their account IDs', async () => {
    mockedUseNetWorth.mockReturnValue({ fetching: false, report } as unknown as ReturnType<typeof useNetWorth>)
    renderPage(['/net-worth?account_ids=acct-invest,acct-cash,acct-savings'])

    await userEvent.click(screen.getAllByRole('button', { name: 'Deposits group' })[0])

    expect(mockedUseNetWorth).toHaveBeenLastCalledWith(expect.objectContaining({ accountIds: ['acct-invest'] }))
    expect(screen.getByTestId('location-search').textContent).toBe('?account_ids=acct-invest')
  })

  it('preserves account filters when opening a sidebar account modal', async () => {
    mockedUseNetWorth.mockReturnValue({ fetching: false, report } as unknown as ReturnType<typeof useNetWorth>)
    renderPage(['/net-worth?account_ids=acct-invest'])

    await userEvent.click(screen.getAllByRole('button', { name: 'Checking account' })[0])

    expect(screen.getByTestId('location-pathname').textContent).toBe('/net-worth/accounts/acct-cash/valuation')
    expect(screen.getByTestId('location-search').textContent).toBe('?account_ids=acct-invest')
    expect(screen.getByRole('link', { name: 'Info' })).toHaveAttribute('href', '/net-worth/accounts/acct-cash/info?account_ids=acct-invest')
    expect(mockedUseNetWorth).toHaveBeenLastCalledWith(expect.objectContaining({ accountIds: ['acct-invest'] }))

    await userEvent.click(screen.getByRole('button', { name: 'Close account modal' }))

    expect(screen.getByTestId('location-pathname').textContent).toBe('/net-worth')
    expect(screen.getByTestId('location-search').textContent).toBe('?account_ids=acct-invest')
  })

  it('clears sidebar account filters when clicking outside the accounts tile', async () => {
    mockedUseNetWorth.mockReturnValue({ fetching: false, report } as unknown as ReturnType<typeof useNetWorth>)
    renderPage()

    await userEvent.click(screen.getAllByRole('button', { name: 'Investments group' })[0])
    expect(mockedUseNetWorth).toHaveBeenLastCalledWith(expect.objectContaining({ accountIds: ['acct-invest'] }))

    await userEvent.click(screen.getByText('Household Wealth'))
    expect(mockedUseNetWorth).toHaveBeenLastCalledWith(expect.not.objectContaining({ accountIds: expect.any(Array) }))
  })

  it('keeps account filters when expanding asset details', async () => {
    mockedUseNetWorth.mockReturnValue({ fetching: false, report } as unknown as ReturnType<typeof useNetWorth>)
    renderPage(['/net-worth?account_ids=acct-cash'])

    await userEvent.click(screen.getAllByRole('button', { name: 'Expand Cash details' })[1])

    expect(mockedUseNetWorth).toHaveBeenLastCalledWith(expect.objectContaining({ accountIds: ['acct-cash'] }))
  })

  it('keeps account filters when changing the historical chart range', async () => {
    mockedUseNetWorth.mockReturnValue({ fetching: false, report } as unknown as ReturnType<typeof useNetWorth>)
    renderPage(['/net-worth?account_ids=acct-cash'])

    await userEvent.click(screen.getAllByRole('button', { name: 'Chart' })[0])

    expect(mockedUseNetWorth).toHaveBeenLastCalledWith(expect.objectContaining({ accountIds: ['acct-cash'] }))
    expect(mockedUseHistoricalNetWorth).toHaveBeenLastCalledWith(expect.objectContaining({
      range: 'ONE_MONTH',
      filters: expect.objectContaining({ accountIds: ['acct-cash'] }),
    }))
    expect(screen.getByTestId('location-search').textContent).toBe('?account_ids=acct-cash&range=ONE_MONTH')
  })

  it('registers asset edit modals in the net worth URL from detailed rows', async () => {
    mockedUseNetWorth.mockReturnValue({ fetching: false, report } as unknown as ReturnType<typeof useNetWorth>)
    renderPage(['/net-worth?range=ONE_MONTH'])

    await userEvent.click(screen.getAllByRole('button', { name: 'Edit US Dollar' })[1])

    expect(screen.getByTestId('location-pathname').textContent).toBe('/net-worth/assets/asset-usd/info')
    expect(screen.getByTestId('location-search').textContent).toBe('?range=ONE_MONTH')
    expect(screen.getByRole('dialog', { name: 'Edit US Dollar' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Tracking' })).toHaveAttribute('href', '/net-worth/assets/asset-usd/tracking?range=ONE_MONTH')

    await userEvent.click(screen.getByRole('button', { name: 'Close asset modal' }))

    expect(screen.getByTestId('location-pathname').textContent).toBe('/net-worth')
    expect(screen.getByTestId('location-search').textContent).toBe('?range=ONE_MONTH')
  })

  it('opens real estate asset rows as account valuation modals', async () => {
    mockedUseNetWorth.mockReturnValue({ fetching: false, report } as unknown as ReturnType<typeof useNetWorth>)
    renderPage(['/net-worth?range=ONE_MONTH'])

    await userEvent.click(screen.getAllByRole('button', { name: 'Open Primary Home' })[0])

    expect(screen.getByTestId('location-pathname').textContent).toBe('/net-worth/accounts/acct-home/valuation')
    expect(screen.getByTestId('location-search').textContent).toBe('?range=ONE_MONTH')
    expect(screen.getByRole('dialog', { name: 'Account acct-home' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Valuation' })).toHaveAttribute('href', '/net-worth/accounts/acct-home/valuation?range=ONE_MONTH')
  })

  it('opens asset edit modals from direct net worth asset URLs', () => {
    mockedUseNetWorth.mockReturnValue({ fetching: false, report } as unknown as ReturnType<typeof useNetWorth>)
    renderPage(['/net-worth/assets/asset-usd'])

    expect(screen.getByRole('dialog', { name: 'Edit US Dollar' })).toBeInTheDocument()
  })

  it('renders negative trends and snapshot dates', () => {
    mockedUseNetWorth.mockReturnValue({
      fetching: false,
      report: { ...report, asOfDate: '2026-06-04' },
    } as unknown as ReturnType<typeof useNetWorth>)
    mockHistorical(losingSeries)

    renderPage()

    expect(screen.getByText('As of 2026-06-04')).toBeInTheDocument()
    expect(screen.getAllByText((_, element) => element?.textContent?.includes('-20.0% over selected range') ?? false).length).toBeGreaterThan(0)
  })
})

function renderPage(initialEntries = ['/net-worth'], scopes = netWorthScopes) {
  return renderWithProviders(
    <Routes>
      {NET_WORTH_PATHS.map((path) => <Route element={<NetWorthPage />} key={path} path={absoluteRoutePath(path)} />)}
    </Routes>,
    {
      auth: { scopes, masterPasswordStatus: 'DISABLED' },
      initialEntries,
      probes: <><MobileHeaderActionsHost /><LocationSearch /><LocationPathname /></>,
      withMobileHeader: true,
    },
  )
}
