import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { AssetsTab } from './AssetsTab'
import { ACCOUNTS_PATHS, absoluteRoutePath, SETTINGS_ASSET_PATHS } from '../../routes'
import { LocationPathname, LocationSearch, MobileHeaderActionsHost, renderWithProviders, TestProviders } from '../../test/renderWithProviders'

vi.mock('urql', async () => (await import('../../test/urql')).mockUrql({
  useQuery: vi.fn(),
}))
vi.mock('../../hooks/useEntityQueries', () => ({ useAccounts: vi.fn() }))
vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())
vi.mock('../institutions/AccountDetailModal', () => ({
  AccountDetailModal: ({ account, activeTab, basePath = `/accounts/${account.id}`, tabSearch = '', onClose }: { account: { id: string }; activeTab?: 'info' | 'valuation'; basePath?: string; tabSearch?: string; onClose: () => void }) => (
    <div aria-label={`Account ${account.id}`} role="dialog">
      <p>Account tab {activeTab}</p>
      <a href={`${basePath}/valuation${tabSearch}`}>Valuation</a>
      <button onClick={onClose} type="button">Close account modal</button>
    </div>
  ),
}))
vi.mock('../wealth/AssetCreateModal', () => ({
  AssetCreateModal: ({ onClose, onCreate }: { onClose: () => void; onCreate?: () => void }) => (
    <div aria-label="Create asset" role="dialog">
      <button onClick={() => onCreate?.()} type="button">Create mocked asset</button>
      <button onClick={onClose} type="button">Close create asset</button>
    </div>
  ),
}))
vi.mock('../wealth/AssetEditModal', () => ({
  AssetEditModal: ({ asset, activeTab, basePath, tabSearch = '', onClose }: { asset: { id: string }; activeTab?: 'info' | 'tracking'; basePath: string; tabSearch?: string; onClose: () => void }) => (
    <div aria-label={`Asset ${asset.id}`} role="dialog">
      <p>Asset tab {activeTab}</p>
      <a href={`${basePath}/tracking${tabSearch}`}>Tracking</a>
      <button onClick={onClose} type="button">Close asset modal</button>
    </div>
  ),
  isAssetEditTab: (tab: string) => tab === 'info' || tab === 'tracking',
}))

import { useQuery } from 'urql'
import { useAccounts } from '../../hooks/useEntityQueries'

describe('AssetsTab', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/')
  })

  beforeEach(() => {
    vi.mocked(useAccounts).mockReturnValue({ accounts: [], refetch: vi.fn() } as never)
  })

  function renderAssetsTab() {
    return render(<TestProviders router="browser" withMobileHeader><AssetsTab /></TestProviders>)
  }

  function renderAssetsTabWithHeaderActions() {
    return render(<TestProviders probes={<MobileHeaderActionsHost />} router="browser" withMobileHeader><AssetsTab /></TestProviders>)
  }

  function renderAssetsRoute(initialEntries = ['/settings/assets']) {
    return renderWithProviders(
      <Routes>
        {SETTINGS_ASSET_PATHS.map((path) => <Route element={<AssetsTab />} key={path} path={absoluteRoutePath(path)} />)}
        <Route element={<div>Global account route</div>} path={absoluteRoutePath(ACCOUNTS_PATHS[2])} />
      </Routes>,
      { initialEntries, probes: <><LocationPathname /><LocationSearch /></>, withMobileHeader: true },
    )
  }

  it('renders loading state', () => {
    vi.mocked(useQuery).mockReturnValue([{ data: undefined, fetching: true, error: null }, vi.fn()] as never)
    renderAssetsTab()
    expect(screen.getByRole('searchbox', { name: /search assets/i })).toBeTruthy()
    expect(screen.getByText(/Loading assets/i)).toBeTruthy()
  })

  it('renders error state', () => {
    vi.mocked(useQuery).mockReturnValue([{ data: undefined, fetching: false, error: new Error('fail') }, vi.fn()] as never)
    renderAssetsTab()
    expect(screen.getByRole('searchbox', { name: /search assets/i })).toBeTruthy()
    expect(screen.getByText(/Failed to load assets/i)).toBeTruthy()
  })

  it('renders empty state', () => {
    vi.mocked(useQuery).mockReturnValue([{ data: { assets: { items: [] } }, fetching: false, error: null }, vi.fn()] as never)
    renderAssetsTab()
    expect(screen.getByText(/No assets found/i)).toBeTruthy()
  })

  it('renders asset list from query', () => {
    vi.mocked(useQuery).mockReturnValue([{ data: { assets: { items: [{ id: '1', assetType: 'CURRENCY' as const, identifier: 'USD', name: 'US Dollar', classifier: 'CASH' as const, currentPrice: 1, currentPriceAt: null, adapterSources: [], details: null, latestSnapshot: { asOfDate: '2026-05-21', totalHeldQuantity: 100, totalHeldValueUSD: 100 } }] } },
      fetching: false,
      error: null,
    }, vi.fn()] as never)
    renderAssetsTab()
    expect(screen.getByText('US Dollar')).toBeTruthy()
    expect(screen.getByText(/100\.00/)).toBeTruthy()
  })

  it('shows valuation without units when aggregate quantity is unavailable', () => {
    vi.mocked(useQuery).mockReturnValue([{ data: { assets: { items: [{ id: '1', assetType: 'CRYPTO' as const, identifier: 'MOO', name: 'Moo Aero msUSD-USDC', classifier: 'STABLECOIN' as const, currentPrice: 2_528_869.29, currentPriceAt: null, adapterSources: [], details: null, latestSnapshot: { asOfDate: '2026-05-21', totalHeldQuantity: null, totalHeldValueUSD: 76_714.93 } }] } },
      fetching: false,
      error: null,
    }, vi.fn()] as never)

    renderAssetsTab()

    expect(screen.getByText('$76,714.93')).toBeTruthy()
    expect(screen.queryByText(/units$/)).toBeNull()
  })

  it('omits the holdings summary when an asset has no holdings', () => {
    vi.mocked(useQuery).mockReturnValue([{ data: { assets: { items: [{ id: '1', assetType: 'CURRENCY' as const, identifier: 'OLD', name: 'Old Asset', classifier: 'CASH' as const, currentPrice: 1, currentPriceAt: null, adapterSources: [], details: null, latestSnapshot: null }] } },
      fetching: false,
      error: null,
    }, vi.fn()] as never)
    renderAssetsTab()
    expect(screen.getByText('Old Asset')).toBeTruthy()
    expect(screen.queryByText(/No holdings/i)).toBeNull()
  })

  it('passes selected asset type to query variables', async () => {
    const user = userEvent.setup()
    vi.mocked(useQuery).mockReturnValue([{ data: { assets: { items: [] } }, fetching: false, error: null }, vi.fn()] as never)

    const { rerender } = renderAssetsTab()
    expect(vi.mocked(useQuery).mock.calls.at(-1)?.[0]).toMatchObject({ variables: { input: {} } })

    await user.click(screen.getByRole('button', { name: /^Filters$/i }))
    await user.click(screen.getByRole('button', { name: /Asset type/i }))
    await user.click(screen.getByRole('checkbox', { name: 'Security' }))
    rerender(<TestProviders router="browser" withMobileHeader><AssetsTab /></TestProviders>)

    expect(vi.mocked(useQuery).mock.calls.at(-1)?.[0]).toMatchObject({ variables: { input: { assetType: 'SECURITY' } } })
  })

  it('passes includeHistorical when toggled', async () => {
    const user = userEvent.setup()
    vi.mocked(useQuery).mockReturnValue([{ data: { assets: { items: [] } }, fetching: false, error: null }, vi.fn()] as never)

    renderAssetsTab()
    expect(vi.mocked(useQuery).mock.calls.at(-1)?.[0]).toMatchObject({ variables: { input: {} } })

    await user.click(screen.getByRole('button', { name: /^Filters$/i }))
    await user.click(screen.getByRole('switch', { name: /include historical assets/i }))

    expect(vi.mocked(useQuery).mock.calls.at(-1)?.[0]).toMatchObject({ variables: { input: { includeHistorical: true } } })
  })

  it('places filters in mobile header actions', async () => {
    const user = userEvent.setup()
    vi.mocked(useQuery).mockReturnValue([{ data: { assets: { items: [] } }, fetching: false, error: null }, vi.fn()] as never)

    renderAssetsTabWithHeaderActions()
    await user.click(await screen.findByRole('button', { name: /open asset filters/i }))
    await user.click(screen.getByRole('switch', { name: /include historical assets/i }))

    expect(vi.mocked(useQuery).mock.calls.at(-1)?.[0]).toMatchObject({ variables: { input: { includeHistorical: true } } })
  })

  it('passes search to query variables and the URL immediately', () => {
    vi.mocked(useQuery).mockReturnValue([{ data: { assets: { items: [] } }, fetching: false, error: null }, vi.fn()] as never)

    renderAssetsTab()
    fireEvent.change(screen.getByRole('searchbox', { name: /search assets/i }), { target: { value: 'vti' } })

    expect(vi.mocked(useQuery).mock.calls.at(-1)?.[0]).toMatchObject({ variables: { input: { search: 'vti' } } })
    expect(window.location.search).toBe('?q=vti')
  })

  it('initializes asset search from q', () => {
    window.history.pushState({}, '', '/settings/assets?q=vti')
    vi.mocked(useQuery).mockReturnValue([{ data: { assets: { items: [] } }, fetching: false, error: null }, vi.fn()] as never)

    renderAssetsTab()

    expect(screen.getByRole('searchbox', { name: /search assets/i })).toHaveValue('vti')
    expect(vi.mocked(useQuery).mock.calls.at(-1)?.[0]).toMatchObject({ variables: { input: { search: 'vti' } } })
  })

  it('opens the create asset modal from the query param and create button', async () => {
    vi.mocked(useQuery).mockReturnValue([{ data: { assets: { items: [] } }, fetching: false, error: null }, vi.fn()] as never)

    renderAssetsRoute(['/settings/assets?new=1'])

    expect(screen.getByRole('dialog', { name: 'Create asset' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close create asset' }))
    expect(screen.getByTestId('location-search').textContent).toBe('')

    await userEvent.click(screen.getAllByRole('button', { name: 'Create asset' })[0])
    expect(screen.getByTestId('location-search').textContent).toBe('?new=1')
  })

  it('opens asset rows in the settings asset URL', async () => {
    vi.mocked(useQuery).mockReturnValue([{ data: { assets: { items: [{ id: 'asset-stock', assetType: 'SECURITY' as const, identifier: 'VTI', name: 'Vanguard Total Stock Market ETF', classifier: 'PUBLIC' as const, currentPrice: 250, currentPriceAt: null, adapterSources: [], details: null, totalHeldQuantity: 1, totalHeldValueUSD: 250 }] } }, fetching: false, error: null }, vi.fn()] as never)

    renderAssetsRoute(['/settings/assets?q=vti'])
    await userEvent.click(screen.getByRole('button', { name: /Vanguard Total Stock Market ETF/ }))

    expect(screen.getByTestId('location-pathname').textContent).toBe('/settings/assets/asset-stock/info')
    expect(screen.getByTestId('location-search').textContent).toBe('?q=vti')
    expect(screen.getByRole('dialog', { name: 'Asset asset-stock' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Tracking' })).toHaveAttribute('href', '/settings/assets/asset-stock/tracking?q=vti')

    await userEvent.click(screen.getByRole('button', { name: 'Close asset modal' }))

    expect(screen.getByTestId('location-pathname').textContent).toBe('/settings/assets')
    expect(screen.getByTestId('location-search').textContent).toBe('?q=vti')
  })

  it('opens real estate asset rows on the account valuation page', async () => {
    vi.mocked(useQuery).mockReturnValue([{ data: { assets: { items: [{ id: 'asset-home', assetType: 'REAL_ESTATE' as const, identifier: 'home-primary', name: 'Primary Home', classifier: 'REAL_ESTATE' as const, currentPrice: 1450000, currentPriceAt: null, adapterSources: [], details: null, totalHeldQuantity: 1, totalHeldValueUSD: 1450000 }] } }, fetching: false, error: null }, vi.fn()] as never)
    vi.mocked(useAccounts).mockReturnValue({
      accounts: [{ id: 'acct-home', name: 'Primary Home', type: 'PROPERTY', owner: { id: 'owner', name: 'Alex' }, hidden: false, closed: false, manual: false, createdAt: '', updatedAt: '', latestSnapshot: { holdings: [{ asset: { id: 'asset-home' } }] } }],
      refetch: vi.fn(),
    } as never)

    renderAssetsRoute(['/settings/assets?q=home'])
    await userEvent.click(screen.getByRole('button', { name: /Primary Home/ }))

    expect(screen.getByTestId('location-pathname').textContent).toBe('/accounts/acct-home/valuation')
    expect(screen.getByTestId('location-search').textContent).toBe('')
  })
})
