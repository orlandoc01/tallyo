import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useMutation, useQuery } from 'urql'
import { Button } from '../common/Button'
import { DataGridRow, dataGridTextCell } from '../common/DataGrid'
import { Card, FormError } from '../common/FormControls'
import { QueryGate } from '../common/QueryGate'
import { Tag } from '../common/Tag'
import { ASSETS_QUERY } from '../../graphql/queries'
import { UPDATE_ASSET_MUTATION } from '../../graphql/mutations'
import { useIsMobile } from '../../hooks/useIsMobile'
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
  const isMobile = useIsMobile()
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
      emptyTitle="All asset tickers are resolving"
      emptyDescription="Assets with Yahoo Finance lookup failures will appear here."
      error={error}
      errorPrefix="Failed to load asset review queue"
      fetching={fetching}
      loadingLabel="Loading asset review queue"
      onRetry={() => reexecuteQuery({ requestPolicy: 'network-only' })}
    >
      <div className="space-y-4">
        {actionError ? <FormError>{actionError}</FormError> : null}
        <Card>
          {assets.map((asset) => {
            const busy = updatingAssetId === asset.id
            const title = (
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate font-medium text-text-1">{asset.name ?? asset.identifier}</span>
                <Tag className="shrink-0" tint="amber">{reasonLabel(asset)}</Tag>
              </div>
            )
            const actions = (
              <div className={isMobile ? 'mt-2 flex flex-wrap gap-2' : 'flex items-center gap-2'}>
                <Button onClick={() => navigate(`/review/assets/${asset.id}/info`)} size="sm" variant="secondary">Edit</Button>
                <Button disabled={!canUpdate || busy} onClick={() => setStatus(asset, 'HEALTHY')} size="sm" variant="secondary">Retry</Button>
                <Button disabled={!canUpdate || busy} onClick={() => setStatus(asset, 'IGNORE')} size="sm" variant="danger">Dismiss</Button>
              </div>
            )
            return isMobile ? (
              <div className="min-h-[52px] border-t border-border px-4 py-2.5" key={asset.id}>
                {title}
                <div className="truncate font-mono text-xs text-text-3">{asset.identifier}</div>
                {actions}
              </div>
            ) : (
              <DataGridRow gridTemplateColumns="minmax(0,1.6fr) minmax(0,1fr) auto" key={asset.id}>
                {title}
                <div className={`${dataGridTextCell} font-mono text-xs text-text-3`}>{asset.identifier}</div>
                {actions}
              </DataGridRow>
            )
          })}
        </Card>
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
