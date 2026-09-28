import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePermissions } from '../../hooks/usePermissions'
import { allowAllPermissionResult } from '../../test/permissions'
import { captureMutation, mockGraphqlError } from '../../test/msw'
import { TestProviders } from '../../test/renderWithProviders'
import type { Asset } from '../../types/graphql'
import type { AssetEditTab } from './assetEditTabs'
import { AssetEditModal } from './AssetEditModal'

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }))
vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

afterEach(() => {
  vi.mocked(usePermissions).mockReturnValue(allowAllPermissionResult)
})

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

const realEstateAsset: Asset = { ...currencyAsset, id: '3', assetType: 'REAL_ESTATE', classifier: 'REAL_ESTATE', identifier: '1 Main St', name: null }

function renderSheet(asset: Asset, props: { activeTab?: AssetEditTab; onClose?: () => void; onUpdate?: (asset: Asset) => void } = {}) {
  const tab = props.activeTab ?? 'info'
  function Providers({ children }: { children: ReactNode }) {
    return <TestProviders initialEntries={[`/portfolio/assets/${asset.id}/${tab}`]} withGraphql>{children}</TestProviders>
  }
  return render(
    <AssetEditModal activeTab={tab} asset={asset} basePath={`/portfolio/assets/${asset.id}`} onClose={props.onClose ?? vi.fn()} onUpdate={props.onUpdate} />,
    { wrapper: Providers },
  )
}

describe('AssetEditSheet', () => {
  it('renders the hero, sticky tabs and info rows on mobile', () => {
    renderSheet(securityAsset)

    const sheet = screen.getByRole('dialog', { name: 'Asset' })
    expect(within(sheet).getByText('Vanguard 2055', { selector: 'div' })).toBeInTheDocument()
    expect(within(sheet).getByRole('navigation', { name: 'Asset edit sections' })).toHaveClass('sticky')
    expect(within(sheet).getByRole('link', { name: 'Tracking' })).toHaveAttribute('href', '/portfolio/assets/2/tracking')
    expect(within(sheet).getByRole('button', { name: /^identifier/i })).toHaveTextContent('VFFVX')
    expect(within(sheet).getByRole('button', { name: /^name/i })).toHaveTextContent('Vanguard 2055')
    expect(within(sheet).getByRole('button', { name: /^asset class/i })).toHaveTextContent('Public Assets')
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(within(sheet).queryByRole('button', { name: 'Close filters' })).not.toBeInTheDocument()
  })

  it('edits the name through the Name row, saves only the change and closes', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    const onClose = vi.fn()
    const updated = { ...currencyAsset, name: 'Dollars' }
    const updateAsset = captureMutation<{ id: string; name?: string }>('UpdateAsset', {
      updateAsset: { __typename: 'UpdateAssetPayload', asset: { __typename: 'Asset', ...updated } },
    })
    renderSheet(currencyAsset, { onClose, onUpdate })

    await user.click(screen.getByRole('button', { name: /^name/i }))
    const nameInput = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'Dollars')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateAsset.input).toEqual({ id: '1', name: 'Dollars' }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: '1', name: 'Dollars' })))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('stays open with the error shown when the save fails', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    mockGraphqlError('UpdateAsset', 'Identifier taken', { kind: 'mutation' })
    renderSheet(currencyAsset, { onClose })

    await user.click(screen.getByRole('button', { name: /^name/i }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), '!')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/Identifier taken/)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('picks an asset class from the accordion, collapses it and saves the classifier', async () => {
    const user = userEvent.setup()
    const updateAsset = captureMutation<{ id: string; classifier?: string }>('UpdateAsset', {
      updateAsset: { __typename: 'UpdateAssetPayload', asset: { __typename: 'Asset', ...securityAsset, classifier: 'COMPANY_EQUITY' } },
    })
    renderSheet(securityAsset)

    const row = screen.getByRole('button', { name: /^asset class/i })
    await user.click(row)
    await user.click(screen.getByRole('radio', { name: 'Company Equity' }))

    expect(row).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(row).toHaveTextContent('Company Equity')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(updateAsset.input).toEqual({ id: '2', classifier: 'COMPANY_EQUITY' }))
  })

  it('forces a unit price from the tracking tab', async () => {
    const user = userEvent.setup()
    const updateAsset = captureMutation<{ id: string; forcePrice?: boolean; forcedUsdPrice?: number }>('UpdateAsset', {
      updateAsset: { __typename: 'UpdateAssetPayload', asset: { __typename: 'Asset', ...securityAsset, forcedUsdPrice: 25.5 } },
    })
    renderSheet(securityAsset, { activeTab: 'tracking' })

    expect(screen.queryByLabelText('USD price per unit')).not.toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Force price' }))
    await user.type(screen.getByLabelText('USD price per unit'), '25.5')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateAsset.input).toEqual({ id: '2', forcePrice: true, forcedUsdPrice: 25.5 }))
  })

  it('clears a verified quote when the ticker changes or custom tracking turns off', async () => {
    const user = userEvent.setup()
    renderSheet(securityAsset, { activeTab: 'tracking' })

    await user.click(screen.getByRole('switch', { name: 'Custom tracking' }))
    await user.type(screen.getByLabelText('Tracking ticker'), 'SPY')
    await user.click(screen.getByRole('button', { name: 'Verify ticker' }))
    expect(await screen.findByText(/quoted/)).toBeInTheDocument()

    await user.type(screen.getByLabelText('Tracking ticker'), 'X')
    expect(screen.queryByText(/quoted/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Verify ticker' }))
    expect(await screen.findByText(/quoted/)).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Custom tracking' }))
    expect(screen.queryByText(/quoted/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Tracking ticker')).not.toBeInTheDocument()
  })

  it('shows a currency asset with a static asset class and no tracking tab', () => {
    renderSheet(currencyAsset)

    expect(screen.getByText('Currency · Cash & Equivalents')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Tracking' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^asset class/i })).not.toBeInTheDocument()
    expect(screen.getByText('Cash & Equivalents', { selector: 'span.text-text-2' })).toBeInTheDocument()
  })

  it('edits the identifier and sends null when it is cleared', async () => {
    const user = userEvent.setup()
    const updateAsset = captureMutation<{ id: string; identifier?: string | null }>('UpdateAsset', {
      updateAsset: { __typename: 'UpdateAssetPayload', asset: { __typename: 'Asset', ...currencyAsset, identifier: 'EUR' } },
    })
    const renamed = renderSheet(currencyAsset)

    await user.click(screen.getByRole('button', { name: /^identifier/i }))
    const identifier = screen.getByRole('textbox', { name: 'Identifier' })
    await user.clear(identifier)
    await user.type(identifier, 'EUR')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(updateAsset.input).toEqual({ id: '1', identifier: 'EUR' }))
    renamed.unmount()

    renderSheet(currencyAsset)
    await user.click(screen.getByRole('button', { name: /^identifier/i }))
    await user.clear(screen.getByRole('textbox', { name: 'Identifier' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(updateAsset.input).toEqual({ id: '1', identifier: null }))
  })

  it('submits the trimmed tracking ticker and numeric multiplier', async () => {
    const user = userEvent.setup()
    const updateAsset = captureMutation<{ id: string; trackingTicker?: string; trackingMultiplier?: number }>('UpdateAsset', {
      updateAsset: { __typename: 'UpdateAssetPayload', asset: { __typename: 'Asset', ...securityAsset, trackingTicker: 'SPY', trackingMultiplier: 0.95 } },
    })
    renderSheet(securityAsset, { activeTab: 'tracking' })

    await user.click(screen.getByRole('switch', { name: 'Custom tracking' }))
    await user.type(screen.getByLabelText('Tracking ticker'), ' SPY ')
    const multiplier = screen.getByLabelText('Tracking multiplier')
    await user.clear(multiplier)
    await user.type(multiplier, '0.95')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateAsset.input).toEqual({ id: '2', trackingTicker: 'SPY', trackingMultiplier: 0.95 }))
  })

  it('reveals the tracking ticker field when custom tracking is switched on', async () => {
    const user = userEvent.setup()
    renderSheet(securityAsset, { activeTab: 'tracking' })

    expect(screen.queryByLabelText('Tracking ticker')).not.toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Custom tracking' }))
    expect(screen.getByLabelText('Tracking ticker')).toBeInTheDocument()
  })

  it('shows the Accounts-page note and a Done footer for real estate', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderSheet(realEstateAsset, { onClose })

    expect(screen.getByText(/managed through the Accounts page/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders static rows and a Done footer without write access', () => {
    vi.mocked(usePermissions).mockReturnValue({ canRead: () => true, canWrite: () => false, hasScope: () => true })
    renderSheet(securityAsset)

    expect(screen.queryByRole('button', { name: /^name/i })).not.toBeInTheDocument()
    expect(screen.getByText('Vanguard 2055', { selector: 'span.text-text-2' })).toBeInTheDocument()
    expect(screen.getByText('Public Assets', { selector: 'span.text-text-2' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
  })
})
