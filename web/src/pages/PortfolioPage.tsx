import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { useMobileHeader, useMobileHeaderActions } from '../components/layout/useMobileHeader'
import { MobileFilterButton, MobileFilterDropdown } from '../components/common/MobileFilterDropdown'
import { MobileFilterFooter } from '../components/common/MobileFilterFooter'
import { AmountVisibilityButton } from '../components/common/AmountVisibilityButton'
import { AnalysisFilterContent } from '../components/portfolio/AnalysisFilters'
import { PortfolioCard } from '../components/portfolio/PortfolioCard'
import { PORTFOLIO_VIEW_PARAMS, portfolioFilterCount, portfolioViewOption, type PortfolioFilters, type PortfolioViewParam } from '../components/portfolio/portfolioSlices'
import { QueryGate } from '../components/common/QueryGate'
import { AssetEditModal } from '../components/wealth/AssetEditModal'
import { isAssetEditTab, type AssetEditTab } from '../components/wealth/assetEditTabs'
import { amountVisibilityFromParams, HIDE_AMOUNTS_PARAM } from '../hooks/amountVisibilityParam'
import { useAccounts, useOwners } from '../hooks/useEntityQueries'
import { useAnalysis } from '../hooks/useAnalysis'
import { useNormalizeTabParam } from '../hooks/useNormalizeTabParam'
import { useSearchParamWriters } from '../hooks/useSearchParamWriters'
import { boolParam, clearParamUpdates, enumParam, listParam, paramUpdate, paramUpdates, readParams, type ParamCodec } from '../hooks/urlParams'
import { isInvalidGlobalIDError } from '../utils/graphqlErrors'
import type { AnalysisInput, AnalysisReport, AnalysisView, Asset } from '../types/graphql'
import { ASSET_ACCOUNT_GROUPS, subtypesForAccountGroupIds, type AccountGroupId } from '../utils/accountGroups'

const ACCOUNT_GROUP_IDS = ASSET_ACCOUNT_GROUPS.map((group) => group.id)

const FILTER_PARAMS = {
  ownerIds: listParam('owners'),
  accountGroupIds: accountGroupIdsParam('accountTypes'),
  accountIds: listParam('accounts'),
  includeUnclassified: boolParam('includeUnclassified'),
}
const PORTFOLIO_PARAMS = {
  view: enumParam('view', PORTFOLIO_VIEW_PARAMS, 'composition'),
  ...FILTER_PARAMS,
}

export function PortfolioPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { asset_id: selectedAssetId, asset_tab: selectedAssetTabParam } = useParams()
  const [selectedSliceState, setSelectedSliceState] = useState<{ label: string | null; scope: string }>({ label: null, scope: '' })
  const { searchParams, pushParams, replaceParams } = useSearchParamWriters()
  const params = useMemo(() => readParams(PORTFOLIO_PARAMS, searchParams), [searchParams])
  const view = portfolioViewOption(params.view).view
  const amountsHidden = amountVisibilityFromParams(searchParams)
  const mobile = useMobileHeader()
  const filters = useMemo<PortfolioFilters>(() => ({
    ownerIds: params.ownerIds,
    accountGroupIds: params.accountGroupIds,
    accountIds: params.accountIds,
    includeUnclassified: Boolean(params.includeUnclassified),
  }), [params.accountGroupIds, params.accountIds, params.includeUnclassified, params.ownerIds])
  const { owners } = useOwners()
  const { accounts } = useAccounts()
  const input = useMemo(() => analysisInput(view, filters), [view, filters])
  const { report, fetching, error, refetch } = useAnalysis(input)
  const invalidIDError = isInvalidGlobalIDError(error)
  const selectedAsset = selectedAssetId && report ? assetFromAnalysisReport(report, selectedAssetId) : null
  const selectedAssetTab: AssetEditTab = selectedAssetTabParam === 'tracking' ? 'tracking' : 'info'
  const selectionScope = `${view}:${filters.ownerIds.join(',')}:${filters.accountGroupIds.join(',')}:${filters.accountIds.join(',')}:${filters.includeUnclassified}`
  const selectedSlice = selectedSliceState.scope === selectionScope ? selectedSliceState.label : null
  const setSelectedSlice = useCallback((label: string | null) => {
    setSelectedSliceState({ label, scope: selectionScope })
  }, [selectionScope])
  const setView = useCallback((next: PortfolioViewParam) => {
    pushParams(paramUpdate(PORTFOLIO_PARAMS.view, next))
  }, [pushParams])
  const updateFilters = useCallback((patch: Partial<PortfolioFilters>) => {
    pushParams(paramUpdates(FILTER_PARAMS, patch))
  }, [pushParams])
  const clearFilters = useCallback(() => {
    pushParams(clearParamUpdates(FILTER_PARAMS))
  }, [pushParams])
  const toggleAmountsHidden = useCallback(() => {
    pushParams({ [HIDE_AMOUNTS_PARAM]: amountsHidden ? null : 'true' })
  }, [amountsHidden, pushParams])
  const retry = useCallback(() => refetch({ requestPolicy: 'network-only' }), [refetch])

  useEffect(() => {
    if (invalidIDError) replaceParams({
      ...paramUpdate(PORTFOLIO_PARAMS.ownerIds, []),
      ...paramUpdate(PORTFOLIO_PARAMS.accountIds, []),
    })
  }, [invalidIDError, replaceParams])

  function openAsset(asset: Asset) {
    navigate(portfolioAssetInfoPath(asset.id, location.search))
  }

  function closeAssetModal() {
    navigate(portfolioPath(location.search))
  }

  useNormalizeTabParam(selectedAssetId, selectedAssetTabParam, isAssetEditTab, (assetId) => portfolioAssetInfoPath(assetId, location.search))

  const mobileHeaderActions = useMemo(() => (
    <>
      <MobileFilterButton active={mobile.filterOpen} count={portfolioFilterCount(filters)} onClick={mobile.filterOpen ? mobile.closeFilter : mobile.openFilter} />
      <AmountVisibilityButton amountsHidden={amountsHidden} onToggle={toggleAmountsHidden} variant="mobile" />
    </>
  ), [amountsHidden, filters, mobile.closeFilter, mobile.filterOpen, mobile.openFilter, toggleAmountsHidden])

  useMobileHeaderActions(mobileHeaderActions)

  return (
    <div className="lg:min-h-screen">
      <h1 className="sr-only">Portfolio</h1>
      <PortfolioCard
        accounts={accounts}
        amountsHidden={amountsHidden}
        fetching={fetching || invalidIDError}
        body={(
          <QueryGate
            data={fetching ? undefined : report}
            empty={Boolean(report && !fetching && report.slices.length === 0)}
            emptyTitle="No analyzable holdings"
            emptyDescription="Run a balance sync after linking investment accounts to populate portfolio analysis."
            error={invalidIDError ? undefined : error}
            errorPrefix="Failed to load portfolio analysis"
            fetching={fetching || invalidIDError}
            loadingLabel="Loading portfolio analysis"
            onRetry={retry}
          />
        )}
        filters={filters}
        owners={owners}
        report={report}
        selectedLabel={selectedSlice}
        view={params.view}
        onClearFilters={clearFilters}
        onEditAsset={openAsset}
        onFilterChange={updateFilters}
        onSelectLabel={setSelectedSlice}
        onToggleAmountsHidden={toggleAmountsHidden}
        onViewChange={setView}
      />
      {selectedAsset ? (
        <AssetEditModal
          key={selectedAsset.id}
          asset={selectedAsset}
          activeTab={selectedAssetTab}
          basePath={`/portfolio/assets/${selectedAsset.id}`}
          tabSearch={location.search}
          onClose={closeAssetModal}
          onUpdate={retry}
        />
      ) : null}
      {mobile.filterOpen ? (
        <MobileFilterDropdown
          bodyClassName="space-y-4"
          footer={(
            <MobileFilterFooter
              primaryLabel="Done"
              onPrimary={mobile.closeFilter}
              onSecondary={clearFilters}
            />
          )}
          labelledBy="portfolio-filters-title"
          onClose={mobile.closeFilter}
        >
          <AnalysisFilterContent
            accounts={accounts}
            accountGroupIds={filters.accountGroupIds}
            accountIds={filters.accountIds}
            checkboxVariant="highlight"
            enableAccountConnectionToggle
            includeUnclassified={filters.includeUnclassified}
            ownerIds={filters.ownerIds}
            owners={owners}
            onAccountChange={(accountIds) => updateFilters({ accountIds })}
            onAccountGroupChange={(accountGroupIds) => updateFilters({ accountGroupIds })}
            onIncludeUnclassifiedChange={(includeUnclassified) => updateFilters({ includeUnclassified })}
            onOwnerChange={(ownerIds) => updateFilters({ ownerIds })}
          />
        </MobileFilterDropdown>
      ) : null}
    </div>
  )
}

function portfolioPath(search: string) {
  return `/portfolio${search}`
}

function portfolioAssetInfoPath(assetID: string, search: string) {
  return `/portfolio/assets/${assetID}/info${search}`
}

function assetFromAnalysisReport(report: AnalysisReport, assetID: string) {
  return report.slices
    .flatMap((slice) => slice.holdings)
    .find((holding) => holding.asset.id === assetID)?.asset ?? null
}

function accountGroupIdsParam(key: string): ParamCodec<AccountGroupId[]> {
  const list = listParam(key)
  return {
    key,
    read: (params) => list.read(params).filter((value): value is AccountGroupId => ACCOUNT_GROUP_IDS.includes(value as AccountGroupId)),
    write: (params, value) => list.write(params, value),
  }
}

function analysisInput(view: AnalysisView, { ownerIds, accountGroupIds, accountIds, includeUnclassified }: PortfolioFilters): AnalysisInput {
  const accountSubtypes = subtypesForAccountGroupIds(accountGroupIds)
  return {
    view,
    ...(ownerIds.length ? { ownerIds } : {}),
    ...(accountSubtypes.length ? { accountSubtypes } : {}),
    ...(accountIds.length ? { accountIds } : {}),
    ...(includeUnclassified ? { includeUnclassified: true } : {}),
  }
}
