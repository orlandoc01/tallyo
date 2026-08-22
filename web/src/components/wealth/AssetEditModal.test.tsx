import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../test/renderWithProviders'
import { AssetEditModal } from './AssetEditModal'
import type { AssetEditTab } from './assetEditTabs'
import type { Asset } from '../../types/graphql'

const mocks = vi.hoisted(() => {
  const quoteToPromise = vi.fn()
  const useMutation = vi.fn()
  const useQuery = vi.fn()
  return {
    query: vi.fn(() => ({ toPromise: quoteToPromise })),
    quoteToPromise,
    useMutation,
    useQuery,
    updateAsset: vi.fn().mockResolvedValue({ data: { updateAsset: { asset: null } }, error: null }),
    mergeAsset: vi.fn().mockResolvedValue({ data: { mergeAsset: { asset: null } }, error: null }),
  }
})

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(),
}))

vi.mock('urql', async () => (await import('../../test/urql')).mockUrql({
  useClient: vi.fn(() => ({ query: mocks.query })),
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
}))

import { usePermissions } from '../../hooks/usePermissions'

const currencyAsset: Asset = {
  id: '1',
  assetType: 'CURRENCY',
  identifier: 'USD',
  name: 'US Dollar',
  classifier: 'CASH',
  currentPrice: 1,
  forcedUsdPrice: null,
  trackingTicker: null,
  trackingMultiplier: 1,
  priceConnectivity: 'HEALTHY',
  investmentConnectivity: 'HEALTHY',
  adapterSources: [],
  details: null,
}

const securityAsset: Asset = {
  id: '2',
  assetType: 'SECURITY',
  identifier: 'VFFVX',
  name: 'Vanguard 2055',
  classifier: 'PUBLIC',
  currentPrice: 45.5,
  forcedUsdPrice: null,
  trackingTicker: null,
  trackingMultiplier: 1,
  priceConnectivity: 'HEALTHY',
  investmentConnectivity: 'HEALTHY',
  adapterSources: [{ sourceAdapter: 'PLAID', sourceId: 'sec-vffvx' }],
  details: null,
}

// A genuine custom tracker: an institution-only share class priced off a
// public proxy ticker, distinct from its own identifier.
const trackedSecurityAsset: Asset = {
  ...securityAsset,
  id: '5',
  identifier: 'TrustII_VFFVX',
  name: '401k Target 2055 Trust',
  trackingTicker: 'VFFVX',
  trackingMultiplier: 1.5155,
  adapterSources: [],
}

describe('AssetEditModal', () => {
  beforeEach(() => {
    mocks.query.mockClear()
    mocks.quoteToPromise.mockReset()
    mocks.quoteToPromise.mockResolvedValue({ data: { assetQuote: { priceUSD: 123.45, asOf: '2026-06-02T00:00:00Z' } }, error: null })
    mocks.useQuery.mockReset().mockReturnValue([{ data: { accounts: { items: [] } }, fetching: false, error: null }, vi.fn()])
    mocks.useMutation.mockReset()
    let mutationIndex = 0
    mocks.useMutation.mockImplementation(() => {
      mutationIndex += 1
      return [{ fetching: false, error: undefined }, mutationIndex % 2 === 1 ? mocks.updateAsset : mocks.mergeAsset]
    })
    mocks.updateAsset.mockReset().mockResolvedValue({ data: { updateAsset: { asset: null } }, error: null })
    mocks.mergeAsset.mockReset().mockResolvedValue({ data: { mergeAsset: { asset: null } }, error: null })
    vi.mocked(usePermissions).mockReturnValue({ canRead: () => true, canWrite: () => true, hasScope: () => true })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  function renderModal(asset: Asset, props: { activeTab?: AssetEditTab; onClose?: () => void; onUpdate?: (asset: Asset) => void; tabSearch?: string } = {}) {
    return renderWithProviders(
      <AssetEditModal asset={asset} activeTab={props.activeTab} basePath={`/assets/${asset.id}`} tabSearch={props.tabSearch} onClose={props.onClose ?? (() => {})} onUpdate={props.onUpdate} />,
    )
  }

  it('renders currency asset with name field', () => {
    renderModal(currencyAsset)
    expect(screen.getByText('Edit Asset')).toBeTruthy()
    expect(screen.getByDisplayValue('US Dollar')).toBeTruthy()
    expect(screen.getByDisplayValue('USD')).toBeTruthy()
    expect(screen.getByText('Type:')).toBeTruthy()
    expect(screen.queryByText(/always Cash & Equivalents/)).not.toBeInTheDocument()
  })

  it('lists accounts holding the asset', () => {
    mocks.useQuery.mockReturnValueOnce([{
      data: {
        node: {
          __typename: 'Asset',
          id: '2',
          latestSnapshot: {
            asOfDate: '2026-06-01',
            totalHeldQuantity: 4,
            totalHeldValueUSD: 1000,
            holdings: [
              { assetId: '2', accountId: 'acct-1', valueUSD: 1000, account: { id: 'acct-1', name: 'Brokerage', mask: '1234' } },
            ],
          },
        },
      },
      fetching: false,
      error: null,
    }, vi.fn()])

    renderModal(securityAsset)

    expect(screen.getByText('Accounts')).toBeInTheDocument()
    expect(screen.getByText('Brokerage (...1234)')).toBeInTheDocument()
    expect(screen.getByText('$1,000.00')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Brokerage/ })).toHaveAttribute('href', '/accounts/acct-1/valuation')
  })

  it('does not query or render accounts without both asset and holding scopes', () => {
    vi.mocked(usePermissions).mockReturnValue({
      canRead: (resource) => resource === 'assets',
      canWrite: () => true,
      hasScope: () => false,
    })

    renderModal(securityAsset)

    expect(screen.queryByText('Accounts')).not.toBeInTheDocument()
    expect(mocks.useQuery).not.toHaveBeenCalled()
  })

  it('shows asset account loading, retry, empty, masked, and display-only states', () => {
    const refetch = vi.fn()
    mocks.useQuery.mockReturnValueOnce([{ data: undefined, fetching: true, error: null }, refetch])
    const { unmount } = renderModal(securityAsset)
    expect(screen.getByRole('status')).toHaveTextContent('Loading accounts')
    unmount()

    mocks.useQuery.mockReturnValueOnce([{ data: undefined, fetching: false, error: { message: 'Nope' } }, refetch])
    const errored = renderModal(securityAsset)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load accounts: Nope')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalledWith({ requestPolicy: 'network-only' })
    errored.unmount()

    mocks.useQuery.mockReturnValueOnce([{ data: { node: { __typename: 'Asset', id: '2', latestSnapshot: null } }, fetching: false, error: null }, refetch])
    const empty = renderModal(securityAsset)
    expect(screen.getByText('Not held in any account.')).toBeInTheDocument()
    empty.unmount()

    mocks.useQuery.mockReturnValueOnce([{
      data: {
        node: {
          __typename: 'Asset',
          id: '2',
          latestSnapshot: {
            asOfDate: '2026-06-01',
            totalHeldQuantity: 4,
            totalHeldValueUSD: -250,
            holdings: [{ assetId: '2', accountId: 'acct-1', valueUSD: -250, account: { id: 'acct-1', name: 'Brokerage', mask: null } }],
          },
        },
      },
      fetching: false,
      error: null,
    }, refetch])
    renderModal(securityAsset, { tabSearch: '?hide_amounts=true' })
    expect(screen.getByText('Brokerage')).toBeInTheDocument()
    expect(screen.getByText('....')).toBeInTheDocument()
  })

  it('renders asset account rows without valuation links when wealth is unavailable', () => {
    vi.mocked(usePermissions).mockReturnValue({
      canRead: (resource) => resource === 'assets' || resource === 'holdings',
      canWrite: () => true,
      hasScope: () => true,
    })
    mocks.useQuery.mockReturnValueOnce([{
      data: {
        node: {
          __typename: 'Asset',
          id: '2',
          latestSnapshot: {
            asOfDate: '2026-06-01',
            totalHeldQuantity: 4,
            totalHeldValueUSD: 1000,
            holdings: [{ assetId: '2', accountId: 'acct-1', valueUSD: 1000, account: { id: 'acct-1', name: 'Brokerage', mask: '1234' } }],
          },
        },
      },
      fetching: false,
      error: null,
    }, vi.fn()])

    renderModal(securityAsset)

    expect(screen.getByText('Brokerage (...1234)')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Brokerage/ })).not.toBeInTheDocument()
  })

  it('hides the tracking tab when there is nothing to track', () => {
    renderModal(currencyAsset)

    expect(screen.getByRole('link', { name: 'Info' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Tracking' })).not.toBeInTheDocument()
  })

  it('renders security asset without CUSIP/ISIN fields', () => {
    renderModal(securityAsset)
    expect(screen.getByLabelText('Identifier (ticker/symbol)')).toHaveValue('VFFVX')
    expect(screen.queryByText('CUSIP')).not.toBeInTheDocument()
    expect(screen.queryByText('ISIN')).not.toBeInTheDocument()
    expect(screen.getByText('Price:')).toBeTruthy()
    expect(screen.getByText('$45.50')).toBeTruthy()
    expect(screen.queryByText(/as of/i)).not.toBeInTheDocument()
  })

  it('shows adapter sources as read-only provider rows', () => {
    renderModal(securityAsset, { activeTab: 'tracking' })
    expect(screen.getByText('Tracked by')).toBeTruthy()
    expect(screen.getByText('Plaid')).toBeTruthy()
    expect(screen.getByText('sec-vffvx')).toBeTruthy()
  })

  it('merges the current asset into another same-type asset', async () => {
    const onClose = vi.fn()
    const onUpdate = vi.fn()
    const targetAsset: Asset = {
      ...securityAsset,
      id: 'asset-target',
      identifier: 'VTI',
      name: 'Vanguard Total Stock Market ETF',
      adapterSources: [],
    }
    const cryptoTarget: Asset = {
      ...securityAsset,
      id: 'asset-crypto-target',
      assetType: 'CRYPTO',
      identifier: 'BTC',
      name: 'Bitcoin',
      classifier: 'CRYPTOCURRENCY',
      adapterSources: [],
    }
    mocks.query.mockReturnValueOnce({ toPromise: vi.fn().mockResolvedValue({ data: { assets: { items: [securityAsset, cryptoTarget, targetAsset] } }, error: null }) })
    mocks.mergeAsset.mockResolvedValueOnce({ data: { mergeAsset: { asset: targetAsset } }, error: null })

    renderModal(securityAsset, { activeTab: 'tracking', onClose, onUpdate })
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))

    expect(await screen.findByText('Choose surviving asset')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /BTC/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /VTI/i }))

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Merge VFFVX into VTI'))
    await waitFor(() => expect(mocks.mergeAsset).toHaveBeenCalledWith({
      input: {
        sourceAdapter: 'PLAID',
        sourceId: 'sec-vffvx',
        assetId: 'asset-target',
      },
    }))
    expect(onUpdate).toHaveBeenCalledWith(targetAsset)
    expect(onClose).toHaveBeenCalled()
  })

  it('keeps Enter in the merge search from submitting the edit form', async () => {
    const targetAsset: Asset = {
      ...securityAsset,
      id: 'asset-target',
      identifier: 'VTI',
      name: 'Vanguard Total Stock Market ETF',
      adapterSources: [],
    }
    mocks.query.mockReturnValueOnce({ toPromise: vi.fn().mockResolvedValue({ data: { assets: { items: [securityAsset, targetAsset] } }, error: null }) })

    renderModal(securityAsset, { activeTab: 'tracking' })
    fireEvent.click(screen.getByRole('switch', { name: /override pricing/i }))
    fireEvent.change(screen.getByLabelText('USD price per unit'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }))

    const search = await screen.findByLabelText('Search merge target assets')
    expect(fireEvent.keyDown(search, { key: 'Enter' })).toBe(false)
    expect(mocks.updateAsset).not.toHaveBeenCalled()
  })

  it('shows real estate message for real estate assets', () => {
    vi.mocked(usePermissions).mockReturnValue({ canRead: () => true, canWrite: () => false, hasScope: () => true })
    const reAsset: Asset = { ...currencyAsset, id: '3', assetType: 'REAL_ESTATE', details: { address: { street: '1 Main St', city: 'NYC', state: 'NY', zip: '10001', homeType: 'SINGLE_FAMILY' } } }
    renderModal(reAsset)
    expect(screen.getByText(/managed through the Accounts page/i)).toBeTruthy()
  })

  it('disables Save when nothing changed', () => {
    renderModal(currencyAsset)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('fires onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    renderModal(currencyAsset, { onClose })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows classifier dropdown for crypto assets', () => {
    const cryptoAsset: Asset = { ...currencyAsset, id: '4', assetType: 'CRYPTO', identifier: 'BTC', name: 'Bitcoin', classifier: 'CRYPTOCURRENCY', details: null }
    renderModal(cryptoAsset)
    expect(screen.getByText('CRYPTOCURRENCY')).toBeTruthy()
    expect(screen.getByRole('combobox')).toBeTruthy()
  })

  it('enables Save when name is changed', () => {
    renderModal(currencyAsset)
    const nameInput = screen.getByDisplayValue('US Dollar')
    fireEvent.change(nameInput, { target: { value: 'Renamed' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('shows security-only pricing controls for security assets', () => {
    renderModal(trackedSecurityAsset, { activeTab: 'tracking' })
    expect(screen.getByRole('switch', { name: /override pricing/i })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Tracking multiplier'), { target: { value: '2' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('defaults Custom Tracking off for an ordinary security and hides its fields', () => {
    renderModal(securityAsset, { activeTab: 'tracking' })
    expect(screen.getByRole('switch', { name: 'Custom Tracking' })).not.toBeChecked()
    expect(screen.queryByLabelText('Tracking ticker')).not.toBeInTheDocument()
  })

  it('defaults Custom Tracking on with its stored values visible for a genuine proxy', () => {
    renderModal(trackedSecurityAsset, { activeTab: 'tracking' })
    expect(screen.getByRole('switch', { name: 'Custom Tracking' })).toBeChecked()
    expect(screen.getByLabelText('Tracking ticker')).toHaveValue('VFFVX')
    expect(screen.getByLabelText('Tracking multiplier')).toHaveValue(1.5155)
  })

  it('shows a validation error and disables Save/Verify for a blank or self ticker', () => {
    renderModal(securityAsset, { activeTab: 'tracking' })
    fireEvent.click(screen.getByRole('switch', { name: 'Custom Tracking' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Use a different ticker or turn off Custom Tracking.')
    expect(screen.getByRole('button', { name: 'Verify ticker' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Tracking ticker'), { target: { value: securityAsset.identifier.toLowerCase() } })
    expect(screen.getByRole('alert')).toHaveTextContent('Use a different ticker or turn off Custom Tracking.')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('sends the clear sentinel when disabling an existing custom tracker', async () => {
    renderModal(trackedSecurityAsset, { activeTab: 'tracking' })
    fireEvent.click(screen.getByRole('switch', { name: 'Custom Tracking' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.updateAsset).toHaveBeenCalledWith({
      input: { id: '5', trackingTicker: '', trackingMultiplier: 1 },
    }))
  })

  it('toggling off then on restores unsaved values, and the initial state disables Save', () => {
    renderModal(trackedSecurityAsset, { activeTab: 'tracking' })
    const toggle = screen.getByRole('switch', { name: 'Custom Tracking' })

    fireEvent.change(screen.getByLabelText('Tracking ticker'), { target: { value: 'SPY' } })
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect(screen.getByLabelText('Tracking ticker')).toHaveValue('SPY')

    fireEvent.change(screen.getByLabelText('Tracking ticker'), { target: { value: 'VFFVX' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('does not treat whitespace-only ticker edits or a cosmetic multiplier re-entry as dirty', () => {
    renderModal(trackedSecurityAsset, { activeTab: 'tracking' })
    fireEvent.change(screen.getByLabelText('Tracking ticker'), { target: { value: '  VFFVX  ' } })
    fireEvent.change(screen.getByLabelText('Tracking multiplier'), { target: { value: '1.5155' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('disables Custom Tracking controls for read-only users', () => {
    vi.mocked(usePermissions).mockReturnValue({ canRead: () => true, canWrite: () => false, hasScope: () => true })
    renderModal(trackedSecurityAsset, { activeTab: 'tracking' })
    expect(screen.getByRole('switch', { name: 'Custom Tracking' })).toBeDisabled()
    expect(screen.getByLabelText('Tracking ticker')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Verify ticker' })).toBeDisabled()
  })

  it('cannot apply a deferred quote for a ticker the user has already changed', async () => {
    let resolveFirst: (value: unknown) => void = () => {}
    mocks.quoteToPromise
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce({ data: { assetQuote: { priceUSD: 999, asOf: '2026-06-02T00:00:00Z' } }, error: null })

    renderModal(trackedSecurityAsset, { activeTab: 'tracking' })
    fireEvent.click(screen.getByRole('button', { name: 'Verify ticker' }))
    fireEvent.change(screen.getByLabelText('Tracking ticker'), { target: { value: 'SPY' } })

    resolveFirst({ data: { assetQuote: { priceUSD: 45.5, asOf: '2026-06-01T00:00:00Z' } }, error: null })
    await Promise.resolve()
    await Promise.resolve()

    expect(screen.queryByText(/quoted/)).not.toBeInTheDocument()
  })

  it('shows forced price input for security assets with a forced price', () => {
    renderModal({ ...securityAsset, forcedUsdPrice: 12.34 }, { activeTab: 'tracking' })
    expect(screen.getByRole('switch', { name: /override pricing/i })).toBeChecked()
    expect(screen.getByLabelText('USD price per unit')).toHaveValue(12.34)
  })

  it('submits forced price changes for security assets', async () => {
    renderModal(securityAsset, { activeTab: 'tracking' })

    fireEvent.click(screen.getByRole('switch', { name: /override pricing/i }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('USD price per unit'), { target: { value: '25.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.updateAsset).toHaveBeenCalledWith({
      input: {
        id: '2',
        forcePrice: true,
        forcedUsdPrice: 25.5,
      },
    }))
  })

  it('submits forcePrice false when disabling an existing forced price', async () => {
    renderModal({ ...securityAsset, forcedUsdPrice: 12.34 }, { activeTab: 'tracking' })

    fireEvent.click(screen.getByRole('switch', { name: /override pricing/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.updateAsset).toHaveBeenCalledWith({
      input: {
        id: '2',
        forcePrice: false,
      },
    }))
  })

  it('enables Custom Tracking, verifies, and submits tracking fields for an ordinary security', async () => {
    renderModal(securityAsset, { activeTab: 'tracking' })
    fireEvent.click(screen.getByRole('switch', { name: 'Custom Tracking' }))
    expect(screen.getByRole('button', { name: 'Verify ticker' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Tracking ticker'), { target: { value: 'SPY' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify ticker' }))
    await waitFor(() => expect(mocks.query).toHaveBeenCalledWith(expect.anything(), { ticker: 'SPY' }))
    expect(await screen.findByText('$123.45')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Tracking multiplier'), { target: { value: '0.95' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.updateAsset).toHaveBeenCalledWith({
      input: {
        id: '2',
        trackingTicker: 'SPY',
        trackingMultiplier: 0.95,
      },
    }))
  })

  it('calls onClose after successful save', async () => {
    const onClose = vi.fn()
    const onUpdate = vi.fn()
    renderModal(currencyAsset, { onClose, onUpdate })

    const nameInput = screen.getByDisplayValue('US Dollar')
    fireEvent.change(nameInput, { target: { value: 'Updated Name' } })

    const saveBtn = screen.getByRole('button', { name: 'Save' })
    fireEvent.click(saveBtn)

    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('shows Save button as disabled without write permissions', () => {
    vi.mocked(usePermissions).mockReturnValue({ canRead: () => true, canWrite: () => false, hasScope: () => false })
    renderModal(currencyAsset)
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })
})
