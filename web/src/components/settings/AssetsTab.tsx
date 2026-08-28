import { useCallback, useMemo, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { useQuery } from 'urql'
import { AssetCreateModal } from '../wealth/AssetCreateModal'
import { AssetEditModal } from '../wealth/AssetEditModal'
import { accountsHoldingAsset } from '../wealth/assetAccounts'
import { isAssetEditTab, type AssetEditTab } from '../wealth/assetEditTabs'
import { AssetFiltersDropdown } from './AssetFiltersDropdown'
import { useMobileHeaderActions } from '../layout/useMobileHeader'
import { SearchInput, SectionLabel } from '../common/FormControls'
import { mobileHeaderActionClass } from '../common/mobileHeaderActionClass'
import { QueryGate } from '../common/QueryGate'
import { ASSETS_WITH_LATEST_SNAPSHOT_QUERY } from '../../graphql/queries'
import { useAccounts } from '../../hooks/useEntityQueries'
import { useNormalizeTabParam } from '../../hooks/useNormalizeTabParam'
import { usePermissions } from '../../hooks/usePermissions'
import { useQueryParamState } from '../../hooks/useQueryParamState'
import { formatCurrency } from '../../utils/currency'
import { formatQuantity } from '../../utils/amount'
import type { Asset, AssetList, AssetsInput, AssetType } from '../../types/graphql'

export function AssetsTab() {
  const navigate = useNavigate()
  const location = useLocation()
  const { canRead } = usePermissions()
  const canReadHoldings = canRead('holdings')
  const { asset_id: selectedAssetId, asset_tab: selectedAssetTabParam } = useParams()
  const [assetTypeFilter, setAssetTypeFilter] = useState<AssetType | 'ALL'>('ALL')
  const [includeHistorical, setIncludeHistorical] = useState(false)
  const [search, setSearch] = useQueryParamState('q')
  const [createAssetParam, setCreateAssetParam] = useQueryParamState('new')
  const trimmedSearch = search.trim()
  const input: AssetsInput = {
    ...(assetTypeFilter !== 'ALL' && { assetType: assetTypeFilter }),
    ...(includeHistorical && { includeHistorical }),
    ...(trimmedSearch && { search: trimmedSearch }),
  }
  const [{ data, fetching, error }, reexecuteQuery] = useQuery<{ assets: AssetList }>({ query: ASSETS_WITH_LATEST_SNAPSHOT_QUERY, variables: { input } })
  const { accounts } = useAccounts({ includeLatestSnapshot: canReadHoldings })
  const creatingAsset = createAssetParam === '1'
  const assets = data?.assets.items ?? []
  const selectedAsset = selectedAssetId ? assets.find((asset) => asset.id === selectedAssetId) ?? null : null
  const selectedAssetTab: AssetEditTab = selectedAssetTabParam === 'tracking' ? 'tracking' : 'info'

  function handleSearchChange(nextSearch: string) {
    setSearch(nextSearch)
  }

  const clearFilters = useCallback(() => {
    setAssetTypeFilter('ALL')
    setIncludeHistorical(false)
  }, [])

  const mobileHeaderActions = useMemo(() => (
    <AssetFiltersDropdown
      assetTypeFilter={assetTypeFilter}
      buttonAriaLabel="Open asset filters"
      buttonClassName={mobileHeaderActionClass('touch-manipulation rounded-xl p-2.5')}
      buttonContent={<SlidersHorizontal className="h-5 w-5" />}
      includeHistorical={includeHistorical}
      onAssetTypeChange={setAssetTypeFilter}
      onClear={clearFilters}
      onIncludeHistoricalChange={setIncludeHistorical}
    />
  ), [assetTypeFilter, clearFilters, includeHistorical])

  useMobileHeaderActions(mobileHeaderActions)

  useNormalizeTabParam(selectedAssetId, selectedAssetTabParam, isAssetEditTab, (assetId) => settingsAssetInfoPath(assetId, location.search))

  function handleAssetClick(asset: Asset) {
    if (asset.assetType === 'REAL_ESTATE' && canReadHoldings) {
      const account = accountsHoldingAsset(accounts, asset.id)[0]
      if (account) navigate(`/accounts/${account.id}/valuation`)
      return
    }
    navigate(settingsAssetInfoPath(asset.id, location.search))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 lg:hidden">
        <SectionLabel>Assets</SectionLabel>
        <button className={createAssetButtonClassName()} onClick={() => setCreateAssetParam('1')} type="button">
          Create asset
        </button>
      </div>
      <div className="hidden flex-col gap-3 lg:flex lg:flex-row lg:items-center lg:justify-between">
        <SectionLabel>Assets</SectionLabel>
        <div className="hidden items-center gap-2 lg:flex">
          <button className={createAssetButtonClassName()} onClick={() => setCreateAssetParam('1')} type="button">
            Create asset
          </button>
          <AssetFiltersDropdown
            assetTypeFilter={assetTypeFilter}
            includeHistorical={includeHistorical}
            onAssetTypeChange={setAssetTypeFilter}
            onClear={clearFilters}
            onIncludeHistoricalChange={setIncludeHistorical}
          />
        </div>
      </div>
      <SearchInput ariaLabel="Search assets" onChange={handleSearchChange} placeholder="Search assets by name or identifier..." type="search" value={search} />
      <div aria-busy={fetching} aria-live="polite">
        <QueryGate
          data={data}
          empty={assets.length === 0}
          emptyTitle="No assets found."
          error={error}
          errorPrefix="Failed to load assets"
          fetching={fetching}
          loadingLabel="Loading assets"
          onRetry={() => reexecuteQuery({ requestPolicy: 'network-only' })}
        >
          <div className="divide-y divide-neutral-100 rounded-2xl border border-neutral-200 bg-white">
            {assets.map((asset) => {
              const snapshot = asset.latestSnapshot
              const hasHoldingSummary = snapshot != null
              return (
                <button
                  className="flex w-full items-center justify-between gap-4 px-5 py-3 text-left transition hover:bg-neutral-50"
                  key={asset.id}
                  onClick={() => handleAssetClick(asset)}
                  type="button"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-neutral-900">{asset.name ?? asset.identifier}</p>
                    <p className="truncate text-xs text-neutral-500">
                      {asset.assetType} &middot; {asset.identifier}
                    </p>
                  </div>
                  {hasHoldingSummary ? (
                    <div className="text-right">
                      <p className="font-semibold text-neutral-950">{formatCurrency(snapshot.totalHeldValueUSD)}</p>
                      {snapshot.totalHeldQuantity != null ? (
                        <p className="text-xs text-neutral-500">{formatQuantity(snapshot.totalHeldQuantity)} units</p>
                      ) : null}
                    </div>
                  ) : null}
                </button>
              )
            })}
          </div>
        </QueryGate>
      </div>

      {selectedAsset ? (
        <AssetEditModal
          key={selectedAsset.id}
          asset={selectedAsset}
          activeTab={selectedAssetTab}
          basePath={`/settings/assets/${selectedAsset.id}`}
          tabSearch={location.search}
          onClose={() => navigate(settingsAssetsPath(location.search))}
          onUpdate={() => {
            navigate(settingsAssetsPath(location.search))
            reexecuteQuery({ requestPolicy: 'network-only' })
          }}
        />
      ) : null}
      {creatingAsset ? (
        <AssetCreateModal
          onClose={() => setCreateAssetParam('')}
          onCreate={() => {
            setCreateAssetParam('')
            reexecuteQuery({ requestPolicy: 'network-only' })
          }}
        />
      ) : null}
    </div>
  )
}

function createAssetButtonClassName() {
  return 'rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-700'
}

function settingsAssetsPath(search: string) {
  return `/settings/assets${search}`
}

function settingsAssetInfoPath(assetID: string, search: string) {
  return `/settings/assets/${assetID}/info${search}`
}
