import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePermissions } from '../../hooks/usePermissions'
import { allowAllPermissionResult } from '../../test/permissions'
import { captureMutation } from '../../test/msw'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import { AssetCreateModal } from './AssetCreateModal'

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }))
vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

afterEach(() => {
  vi.mocked(usePermissions).mockReturnValue(allowAllPermissionResult)
})

describe('AssetCreateSheet', () => {
  it('renders security rows by default and hides them for a currency', async () => {
    const user = userEvent.setup()
    render(<AssetCreateModal onClose={vi.fn()} />, { wrapper: GraphqlTestProvider })

    const sheet = screen.getByRole('dialog', { name: 'New asset' })
    expect(within(sheet).queryByRole('button', { name: 'Close filters' })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /^asset type/i })).toHaveTextContent('Security')
    expect(within(sheet).getByRole('switch', { name: 'Custom tracking' })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /^cusip/i })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Create' })).toBeDisabled()

    await user.click(within(sheet).getByRole('button', { name: /^asset type/i }))
    await user.click(within(sheet).getByRole('radio', { name: 'Currency' }))
    expect(within(sheet).queryByRole('switch', { name: 'Custom tracking' })).not.toBeInTheDocument()
    expect(within(sheet).getByText(/always Cash & Equivalents for currency assets/)).toBeInTheDocument()
  })

  it('creates a crypto asset with a picked classifier', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    const onClose = vi.fn()
    const createAsset = captureMutation<{ assetType: string; identifier: string; classifier: string; name?: string }>('CreateAsset', {
      createAsset: { __typename: 'CreateAssetPayload', asset: { __typename: 'Asset', id: 'asset-new', assetType: 'CRYPTO', identifier: 'USDC', name: 'USD Coin', classifier: 'STABLECOIN', currentPrice: null, forcedUsdPrice: null, trackingTicker: null, trackingMultiplier: 1, priceConnectivity: 'HEALTHY', investmentConnectivity: 'HEALTHY', adapterSources: [], details: null } },
    })
    render(<AssetCreateModal onClose={onClose} onCreate={onCreate} />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getByRole('button', { name: /^asset type/i }))
    await user.click(screen.getByRole('radio', { name: 'Crypto' }))
    await user.click(screen.getByRole('button', { name: /^identifier/i }))
    await user.type(screen.getByRole('textbox', { name: 'Identifier' }), 'USDC')
    await user.click(screen.getByRole('button', { name: /^name/i }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'USD Coin')
    await user.click(screen.getByRole('button', { name: /^asset class/i }))
    await user.click(screen.getByRole('radio', { name: 'Stablecoin' }))
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createAsset.input).toEqual({ assetType: 'CRYPTO', identifier: 'USDC', classifier: 'STABLECOIN', name: 'USD Coin' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ id: 'asset-new' })))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows a Done footer without write access', async () => {
    vi.mocked(usePermissions).mockReturnValue({ canRead: () => true, canWrite: () => false, hasScope: () => true })
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<AssetCreateModal onClose={onClose} />, { wrapper: GraphqlTestProvider })

    expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
