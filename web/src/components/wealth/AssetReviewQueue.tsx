import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useMutation, useQuery } from 'urql'
import { QueryGate } from '../common/QueryGate'
import { ASSETS_QUERY } from '../../graphql/queries'
import { UPDATE_ASSET_MUTATION } from '../../graphql/mutations'
import { useNormalizeTabParam } from '../../hooks/useNormalizeTabParam'
import { usePermissions } from '../../hooks/usePermissions'
import type { Asset, AssetList, ConnectivityStatus } from '../../types/graphql'
import { AssetEditModal } from './AssetEditModal'
import { isAssetEditTab, type AssetEditTab } from './assetEditTabs'

type AssetUpdateInput = {
  id: string
  priceConnectivity?: ConnectivityStatus
  investmentConnectivity?: ConnectivityStatus
}

export function AssetReviewQueue() {
  const navigate = useNavigate()
  const { asset_id: selectedAssetId, asset_tab: selectedAssetTabParam } = useParams()
  const [{ data, fetching, error }, reexecuteQuery] = useQuery<{ assets: AssetList }>({ query: ASSETS_QUERY, variables: { input: {} } })
  const [, updateAsset] = useMutation(UPDATE_ASSET_MUTATION)
  const { canWrite } = usePermissions()
  const [updatingAssetId, setUpdatingAssetId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const queryAssets = data?.assets.items ?? []
  const assets = queryAssets.filter(needsReview)
  const selectedAsset = selectedAssetId ? queryAssets.find((asset) => asset.id === selectedAssetId) ?? null : null
  const selectedAssetTab: AssetEditTab = selectedAssetTabParam === 'tracking' ? 'tracking' : 'info'
  const canUpdate = canWrite('assets')

  useNormalizeTabParam(selectedAssetId, selectedAssetTabParam, isAssetEditTab, (assetId) => `/review/assets/${assetId}/info`)

  async function setStatus(asset: Asset, status: ConnectivityStatus) {
    const input: AssetUpdateInput = { id: asset.id }
    if (asset.priceConnectivity === 'NOT_FOUND') {
      input.priceConnectivity = status
    }
    if (asset.investmentConnectivity === 'NOT_FOUND') {
      input.investmentConnectivity = status
    }
    setUpdatingAssetId(asset.id)
    setActionError(null)
    const result = await updateAsset({ input })
    setUpdatingAssetId(null)
    if (result.error) {
      setActionError(result.error.message)
      return
    }
    reexecuteQuery({ requestPolicy: 'network-only' })
  }

  return (
    <QueryGate
      data={data}
      empty={assets.length === 0}
      emptyTitle="All asset tickers are resolving correctly."
      emptyDescription="Assets with Yahoo Finance lookup failures will appear here."
      error={error}
      errorPrefix="Failed to load asset review queue"
      fetching={fetching}
      loadingLabel="Loading asset review queue"
      onRetry={() => reexecuteQuery({ requestPolicy: 'network-only' })}
    >
      <div className="space-y-4">
        {actionError ? <p className="text-sm text-red-600">{actionError}</p> : null}
        <div className="divide-y divide-neutral-100 rounded-2xl border border-neutral-200 bg-white">
          {assets.map((asset) => {
            const busy = updatingAssetId === asset.id
            return (
              <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between" key={asset.id}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-neutral-950">{asset.name ?? asset.identifier}</p>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">{reasonLabel(asset)}</span>
                  </div>
                  <p className="mt-1 truncate text-sm text-neutral-500">{asset.identifier}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50" onClick={() => navigate(`/review/assets/${asset.id}/info`)} type="button">
                    Edit
                  </button>
                  <button className="rounded-xl border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50" disabled={!canUpdate || busy} onClick={() => setStatus(asset, 'HEALTHY')} type="button">
                    Retry
                  </button>
                  <button className="rounded-xl border border-neutral-200 bg-neutral-100 px-3 py-2 text-sm font-semibold text-neutral-800 transition hover:bg-neutral-200 disabled:opacity-50" disabled={!canUpdate || busy} onClick={() => setStatus(asset, 'IGNORE')} type="button">
                    Dismiss
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        {selectedAsset ? (
          <AssetEditModal
            key={selectedAsset.id}
            asset={selectedAsset}
            activeTab={selectedAssetTab}
            basePath={`/review/assets/${selectedAsset.id}`}
            onClose={() => navigate('/review/assets')}
            onUpdate={() => {
              navigate('/review/assets')
              reexecuteQuery({ requestPolicy: 'network-only' })
            }}
          />
        ) : null}
      </div>
    </QueryGate>
  )
}

function needsReview(asset: Asset) {
  return asset.priceConnectivity === 'NOT_FOUND' || asset.investmentConnectivity === 'NOT_FOUND'
}

function reasonLabel(asset: Asset) {
  const price = asset.priceConnectivity === 'NOT_FOUND'
  const investment = asset.investmentConnectivity === 'NOT_FOUND'
  if (price && investment) return 'Price + Investment'
  return price ? 'Price' : 'Investment'
}
