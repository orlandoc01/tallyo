import { useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { useQuery } from 'urql'
import { AssetCreateModal } from '../wealth/AssetCreateModal'
import { AssetEditModal } from '../wealth/AssetEditModal'
import { accountsHoldingAsset } from '../wealth/assetAccounts'
import { isAssetEditTab, type AssetEditTab } from '../wealth/assetEditTabs'
import { AssetFilterPanel, AssetMobileFilters } from './AssetFilterPanel'
import { countActiveAssetFilters, emptyAssetFilters } from './assetFilters'
import { AssetGridHeader, AssetRow } from './AssetRow'
import { SettingsTitleRow } from './SettingsTitleRow'
import { useMobileHeaderActions } from '../layout/useMobileHeader'
import { Button } from '../common/Button'
import { FiltersButton } from '../common/FiltersButton'
import { Card, SearchInput } from '../common/FormControls'
import { MobileFilterButton } from '../common/MobileFilterDropdown'
import { QueryGate } from '../common/QueryGate'
import { ASSETS_WITH_LATEST_SNAPSHOT_QUERY } from '../../graphql/queries'
import { useAccounts } from '../../hooks/useEntityQueries'
import { useFilterCaretRight } from '../../hooks/useFilterCaretRight'
import { useNormalizeTabParam } from '../../hooks/useNormalizeTabParam'
import { usePermissions } from '../../hooks/usePermissions'
import { useQueryParamState } from '../../hooks/useQueryParamState'
import type { Asset, AssetList, AssetsInput } from '../../types/graphql'

export function AssetsTab() {
  const navigate = useNavigate()
  const location = useLocation()
  const { canRead } = usePermissions()
  const canReadHoldings = canRead('holdings')
  const { asset_id: selectedAssetId, asset_tab: selectedAssetTabParam } = useParams()
  const [filters, setFilters] = useState(emptyAssetFilters)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [search, setSearch] = useQueryParamState('q')
  const [createAssetParam, setCreateAssetParam] = useQueryParamState('new')
  const pageRef = useRef<HTMLDivElement>(null)
  const filtersButtonRef = useRef<HTMLButtonElement>(null)
  const caretRight = useFilterCaretRight(filtersOpen, filtersButtonRef, pageRef)
  const trimmedSearch = search.trim()
  const input: AssetsInput = {
    ...(filters.assetType !== 'ALL' && { assetType: filters.assetType }),
    ...(filters.includeHistorical && { includeHistorical: true }),
    ...(trimmedSearch && { search: trimmedSearch }),
  }
  const [{ data, fetching, error }, reexecuteQuery] = useQuery<{ assets: AssetList }>({ query: ASSETS_WITH_LATEST_SNAPSHOT_QUERY, variables: { input } })
  const { accounts } = useAccounts({ includeLatestSnapshot: canReadHoldings })
  const creatingAsset = createAssetParam === '1'
  const assets = data?.assets.items ?? []
  const selectedAsset = selectedAssetId ? assets.find((asset) => asset.id === selectedAssetId) ?? null : null
  const selectedAssetTab: AssetEditTab = selectedAssetTabParam === 'tracking' ? 'tracking' : 'info'
  const activeFilterCount = countActiveAssetFilters(filters)

  const mobileHeaderActions = useMemo(() => (
    <>
      <MobileFilterButton active={mobileFiltersOpen} ariaLabel="Open asset filters" count={activeFilterCount} onClick={() => setMobileFiltersOpen((open) => !open)} />
      <Button aria-label="Create asset" onClick={() => setCreateAssetParam('1')}>+ Create</Button>
    </>
  ), [activeFilterCount, mobileFiltersOpen, setCreateAssetParam])
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
    <div className="flex flex-col gap-3" ref={pageRef}>
      <SettingsTitleRow action={<Button onClick={() => setCreateAssetParam('1')}>Create asset</Button>} title="Assets" />
      <div className="flex items-center gap-2">
        <SearchInput ariaLabel="Search assets" className="w-full lg:max-w-[420px]" onChange={setSearch} placeholder="Search assets by name or identifier..." type="search" value={search} />
        <div className="hidden lg:block">
          <FiltersButton count={activeFilterCount} onClick={() => setFiltersOpen((open) => !open)} open={filtersOpen} ref={filtersButtonRef} />
        </div>
      </div>
      {filtersOpen ? (
        <div className="hidden lg:block">
          <AssetFilterPanel caretRight={caretRight} filters={filters} onChange={setFilters} onClear={() => setFilters(emptyAssetFilters)} />
        </div>
      ) : null}
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
          <Card as="section">
            <div className="overflow-x-auto">
              <div className="lg:min-w-[640px]">
                <AssetGridHeader />
                {assets.map((asset) => <AssetRow asset={asset} key={asset.id} onClick={() => handleAssetClick(asset)} />)}
              </div>
            </div>
          </Card>
        </QueryGate>
      </div>

      {mobileFiltersOpen ? (
        <AssetMobileFilters filters={filters} onChange={setFilters} onClear={() => setFilters(emptyAssetFilters)} onClose={() => setMobileFiltersOpen(false)} />
      ) : null}
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

function settingsAssetsPath(search: string) {
  return `/settings/assets${search}`
}

function settingsAssetInfoPath(assetID: string, search: string) {
  return `/settings/assets/${assetID}/info${search}`
}
