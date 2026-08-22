import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { absoluteRoutePath, REVIEW_PATHS } from '../../routes'
import { LocationPathname, renderWithProviders } from '../../test/renderWithProviders'
import { AssetReviewQueue } from './AssetReviewQueue'

const mocks = vi.hoisted(() => ({
  reexecuteQuery: vi.fn(),
  updateAsset: vi.fn(),
  useQuery: vi.fn(),
}))

vi.mock('urql', async () => (await import('../../test/urql')).mockUrql({
  useMutation: vi.fn(() => [{ fetching: false, error: null }, mocks.updateAsset]),
  useQuery: mocks.useQuery,
}))

vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

vi.mock('./AssetEditModal', () => ({
  AssetEditModal: ({ asset, activeTab, onClose }: { asset: { id: string }; activeTab?: string; onClose: () => void }) => (
    <div aria-label={`Edit ${asset.id}`} role="dialog">
      <p>Asset tab {activeTab}</p>
      <button onClick={onClose} type="button">Close asset modal</button>
    </div>
  ),
  isAssetEditTab: (tab: string) => tab === 'info' || tab === 'tracking',
}))

describe('AssetReviewQueue', () => {
  beforeEach(() => {
    mocks.reexecuteQuery.mockClear()
    mocks.updateAsset.mockReset().mockResolvedValue({ data: { updateAsset: { asset: null } }, error: null })
    mocks.useQuery.mockReset()
  })

  it('renders empty state when all assets are healthy', () => {
    mocks.useQuery.mockReturnValue([{ data: { assets: { items: [] } }, fetching: false, error: null }, mocks.reexecuteQuery])

    renderQueue()

    expect(screen.getByText(/All asset tickers are resolving correctly/i)).toBeTruthy()
  })

  it('retries failed connectivity fields', async () => {
    mocks.useQuery.mockReturnValue([{ data: { assets: { items: [{ id: 'asset-1', identifier: 'BAD', name: 'Bad Fund', assetType: 'SECURITY', classifier: 'PUBLIC', priceConnectivity: 'NOT_FOUND', investmentConnectivity: 'HEALTHY' }] } }, fetching: false, error: null }, mocks.reexecuteQuery])

    renderQueue()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(mocks.updateAsset).toHaveBeenCalledWith({ input: { id: 'asset-1', priceConnectivity: 'HEALTHY' } }))
    expect(mocks.reexecuteQuery).toHaveBeenCalledWith({ requestPolicy: 'network-only' })
  })

  it('dismisses both failed connectivity fields', async () => {
    mocks.useQuery.mockReturnValue([{ data: { assets: { items: [{ id: 'asset-2', identifier: 'BAD2', name: 'Bad Fund 2', assetType: 'SECURITY', classifier: 'PUBLIC', priceConnectivity: 'NOT_FOUND', investmentConnectivity: 'NOT_FOUND' }] } }, fetching: false, error: null }, mocks.reexecuteQuery])

    renderQueue()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

    await waitFor(() => expect(mocks.updateAsset).toHaveBeenCalledWith({ input: { id: 'asset-2', priceConnectivity: 'IGNORE', investmentConnectivity: 'IGNORE' } }))
  })

  it('opens the asset editor through the review URL', async () => {
    mocks.useQuery.mockReturnValue([{ data: { assets: { items: [{ id: 'asset-1', identifier: 'BAD', name: 'Bad Fund', assetType: 'SECURITY', classifier: 'PUBLIC', priceConnectivity: 'NOT_FOUND', investmentConnectivity: 'HEALTHY' }] } }, fetching: false, error: null }, mocks.reexecuteQuery])

    renderQueue()
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(screen.getByTestId('location-pathname').textContent).toBe('/review/assets/asset-1/info')
    expect(screen.getByRole('dialog', { name: 'Edit asset-1' })).toBeInTheDocument()
  })
})

function renderQueue(initialEntries = ['/review/assets']) {
  return renderWithProviders(
    <Routes>
      {REVIEW_PATHS.map((path) => <Route element={<AssetReviewQueue />} key={path} path={absoluteRoutePath(path)} />)}
    </Routes>,
    { initialEntries, probes: <LocationPathname /> },
  )
}
