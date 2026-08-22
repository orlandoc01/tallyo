import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AssetCreateModal } from './AssetCreateModal'

const mocks = vi.hoisted(() => ({
  query: vi.fn(() => ({ toPromise: vi.fn().mockResolvedValue({ data: { assetQuote: { priceUSD: 123.45, asOf: '2026-06-02T00:00:00Z' } }, error: null }) })),
  createAsset: vi.fn().mockResolvedValue({ data: { createAsset: { asset: null } }, error: null }),
}))

vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

vi.mock('urql', async () => (await import('../../test/urql')).mockUrql({
  useClient: vi.fn(() => ({ query: mocks.query })),
  useMutation: vi.fn(() => [{ fetching: false, error: undefined }, mocks.createAsset]),
}))

describe('AssetCreateModal', () => {
  beforeEach(() => {
    mocks.query.mockClear()
    mocks.createAsset.mockClear()
  })

  it('creates a security asset with security details, defaulting Custom Tracking off', async () => {
    render(<AssetCreateModal onClose={() => {}} onCreate={() => {}} />)

    expect(screen.getByRole('switch', { name: 'Custom Tracking' })).not.toBeChecked()
    expect(screen.queryByLabelText('Tracking ticker')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Identifier (ticker/symbol)'), { target: { value: 'SPY' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'SPDR S&P 500 ETF' } })
    fireEvent.change(screen.getByLabelText('CUSIP'), { target: { value: '78462F103' } })
    fireEvent.change(screen.getByLabelText('ISIN'), { target: { value: 'US78462F1030' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(mocks.createAsset).toHaveBeenCalledWith({
      input: {
        assetType: 'SECURITY',
        identifier: 'SPY',
        name: 'SPDR S&P 500 ETF',
        classifier: 'PUBLIC',
        security: { cusip: '78462F103', isin: 'US78462F1030' },
      },
    }))
  })

  it('submits forced price for private security assets', async () => {
    render(<AssetCreateModal onClose={() => {}} />)

    fireEvent.change(screen.getByLabelText('Identifier (ticker/symbol)'), { target: { value: 'ACME' } })
    fireEvent.change(screen.getByLabelText('Asset Class'), { target: { value: 'COMPANY_EQUITY' } })
    fireEvent.click(screen.getByRole('switch', { name: /override pricing/i }))
    fireEvent.change(screen.getByLabelText('USD price per unit'), { target: { value: '12.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(mocks.createAsset).toHaveBeenCalledWith({
      input: expect.objectContaining({
        assetType: 'SECURITY',
        identifier: 'ACME',
        classifier: 'COMPANY_EQUITY',
        forcedUsdPrice: 12.5,
      }),
    }))
  })

  it('sends both tracking fields only when Custom Tracking is enabled', async () => {
    render(<AssetCreateModal onClose={() => {}} />)

    fireEvent.change(screen.getByLabelText('Identifier (ticker/symbol)'), { target: { value: 'TrustII_VFFVX' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Custom Tracking' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Use a different ticker or turn off Custom Tracking.')
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Tracking ticker'), { target: { value: 'VFFVX' } })
    fireEvent.change(screen.getByLabelText('Tracking multiplier'), { target: { value: '1.5155' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(mocks.createAsset).toHaveBeenCalledWith({
      input: expect.objectContaining({
        identifier: 'TrustII_VFFVX',
        trackingTicker: 'VFFVX',
        trackingMultiplier: 1.5155,
      }),
    }))
  })

  it('resets Custom Tracking and other security-only fields when leaving and returning to SECURITY', () => {
    render(<AssetCreateModal onClose={() => {}} />)

    fireEvent.click(screen.getByRole('switch', { name: 'Custom Tracking' }))
    fireEvent.change(screen.getByLabelText('Tracking ticker'), { target: { value: 'SPY' } })
    fireEvent.click(screen.getByRole('switch', { name: /override pricing/i }))
    fireEvent.change(screen.getByLabelText('USD price per unit'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('CUSIP'), { target: { value: '78462F103' } })

    fireEvent.change(screen.getByLabelText('Asset Type'), { target: { value: 'CRYPTO' } })
    fireEvent.change(screen.getByLabelText('Asset Type'), { target: { value: 'SECURITY' } })

    expect(screen.getByRole('switch', { name: 'Custom Tracking' })).not.toBeChecked()
    expect(screen.queryByLabelText('Tracking ticker')).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /override pricing/i })).not.toBeChecked()
    expect(screen.getByLabelText('CUSIP')).toHaveValue('')
  })
})
