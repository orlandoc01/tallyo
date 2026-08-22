import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { useMobileHeader, useMobileHeaderActions } from '../components/layout/useMobileHeader'
import { MobileFilterButton, MobileFilterDropdown } from '../components/common/MobileFilterDropdown'
import { MobileFilterFooter } from '../components/common/MobileFilterFooter'
import { PageToolbar, PageToolbarActions } from '../components/common/PageToolbar'
import { AmountVisibilityButton } from '../components/common/AmountVisibilityButton'
import { AnalysisFilterContent, AnalysisFilters } from '../components/portfolio/AnalysisFilters'
import { AnalysisPieChart } from '../components/portfolio/AnalysisPieChart'
import { AnalysisSliceList } from '../components/portfolio/AnalysisSliceList'
import { AnalysisViewToggle } from '../components/portfolio/AnalysisViewToggle'
import { QueryGate } from '../components/common/QueryGate'
import { AssetEditModal } from '../components/wealth/AssetEditModal'
import { isAssetEditTab, type AssetEditTab } from '../components/wealth/assetEditTabs'
import { amountVisibilityFromParams, HIDE_AMOUNTS_PARAM } from '../hooks/amountVisibilityParam'
import { useAccounts, useOwners } from '../hooks/useEntityQueries'
import { useAnalysis } from '../hooks/useAnalysis'
import { useNormalizeTabParam } from '../hooks/useNormalizeTabParam'
import { useSearchParamWriters } from '../hooks/useSearchParamWriters'
import { boolParam, clearParamUpdates, enumParam, listParam, paramUpdate, readParams, type ParamCodec } from '../hooks/urlParams'
import { isInvalidGlobalIDError } from '../utils/graphqlErrors'
import type { AnalysisInput, AnalysisReport, AnalysisView, Asset } from '../types/graphql'
import { ASSET_ACCOUNT_GROUPS, subtypesForAccountGroupIds, type AccountGroupId } from '../utils/accountGroups'

const ACCOUNT_GROUP_IDS = ASSET_ACCOUNT_GROUPS.map((group) => group.id)
const PORTFOLIO_VIEW_PARAMS = ['composition', 'category', 'group', 'sectors'] as const
type PortfolioViewParam = typeof PORTFOLIO_VIEW_PARAMS[number]

const VIEW_BY_PARAM: Record<PortfolioViewParam, AnalysisView> = {
  composition: 'COMPOSITION',
  category: 'MORNINGSTAR_CATEGORY',
  group: 'MORNINGSTAR_GROUP',
  sectors: 'SECTORS',
}
const PARAM_BY_VIEW: Record<AnalysisView, PortfolioViewParam> = {
  COMPOSITION: 'composition',
  MORNINGSTAR_CATEGORY: 'category',
  MORNINGSTAR_GROUP: 'group',
  SECTORS: 'sectors',
}

const PORTFOLIO_PARAMS = {
  view: enumParam('view', PORTFOLIO_VIEW_PARAMS, 'composition'),
  ownerIds: listParam('owners'),
  accountGroupIds: accountGroupIdsParam('accountTypes'),
  accountIds: listParam('accounts'),
  includeUnclassified: boolParam('includeUnclassified'),
}

export function PortfolioPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { asset_id: selectedAssetId, asset_tab: selectedAssetTabParam } = useParams()
  const [selectedSliceState, setSelectedSliceState] = useState<{ label: string | null; scope: string }>({ label: null, scope: '' })
  const { searchParams, pushParams, replaceParams } = useSearchParamWriters()
  const params = useMemo(() => readParams(PORTFOLIO_PARAMS, searchParams), [searchParams])
  const view = VIEW_BY_PARAM[params.view]
  const amountsHidden = amountVisibilityFromParams(searchParams)
  const mobile = useMobileHeader()
  const filterParams = useMemo(() => ({
    ownerIds: params.ownerIds,
    accountGroupIds: params.accountGroupIds,
    accountIds: params.accountIds,
    includeUnclassified: Boolean(params.includeUnclassified),
  }), [params.accountGroupIds, params.accountIds, params.includeUnclassified, params.ownerIds])
  const { ownerIds, accountGroupIds, accountIds, includeUnclassified } = filterParams
  const { owners } = useOwners()
  const { accounts } = useAccounts()
  const input = useMemo(() => analysisInput(view, ownerIds, accountGroupIds, accountIds, includeUnclassified), [view, ownerIds, accountGroupIds, accountIds, includeUnclassified])
  const { report, fetching, error, refetch } = useAnalysis(input)
  const invalidIDError = isInvalidGlobalIDError(error)
  const selectedAsset = selectedAssetId && report ? assetFromAnalysisReport(report, selectedAssetId) : null
  const selectedAssetTab: AssetEditTab = selectedAssetTabParam === 'tracking' ? 'tracking' : 'info'
  const selectionScope = `${view}:${ownerIds.join(',')}:${accountGroupIds.join(',')}:${accountIds.join(',')}:${includeUnclassified}`
  const selectedSlice = selectedSliceState.scope === selectionScope ? selectedSliceState.label : null
  const setSelectedSlice = useCallback((label: string | null) => {
    setSelectedSliceState({ label, scope: selectionScope })
  }, [selectionScope])
  const setView = useCallback((nextView: AnalysisView) => {
    pushParams(paramUpdate(PORTFOLIO_PARAMS.view, PARAM_BY_VIEW[nextView]))
  }, [pushParams])
  const setListFilter = useCallback(<T extends string>(codec: ParamCodec<T[]>, ids: T[]) => {
    pushParams(paramUpdate(codec, ids))
  }, [pushParams])
  const setIncludeUnclassified = useCallback((value: boolean) => {
    pushParams(paramUpdate(PORTFOLIO_PARAMS.includeUnclassified, value))
  }, [pushParams])
  const clearFilters = useCallback(() => {
    pushParams(clearParamUpdates({
      ownerIds: PORTFOLIO_PARAMS.ownerIds,
      accountGroupIds: PORTFOLIO_PARAMS.accountGroupIds,
      accountIds: PORTFOLIO_PARAMS.accountIds,
      includeUnclassified: PORTFOLIO_PARAMS.includeUnclassified,
    }))
  }, [pushParams])
  const toggleAmountsHidden = useCallback(() => {
    pushParams({ [HIDE_AMOUNTS_PARAM]: amountsHidden ? null : 'true' })
  }, [amountsHidden, pushParams])

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
      <AmountVisibilityButton amountsHidden={amountsHidden} onToggle={toggleAmountsHidden} variant="mobile" />
      <MobileFilterButton active={mobile.filterOpen} highlighted={hasPortfolioFilters(filterParams)} onClick={mobile.filterOpen ? mobile.closeFilter : mobile.openFilter} />
    </>
  ), [amountsHidden, filterParams, mobile.closeFilter, mobile.filterOpen, mobile.openFilter, toggleAmountsHidden])

  useMobileHeaderActions(mobileHeaderActions)

  return (
    <div className="space-y-6 lg:min-h-screen">
      <PageToolbar>
        <div className="w-full lg:hidden">
          <AnalysisViewToggle value={view} onChange={setView} />
        </div>
        <PageToolbarActions>
          <AnalysisViewToggle value={view} onChange={setView} />
          <AmountVisibilityButton amountsHidden={amountsHidden} onToggle={toggleAmountsHidden} variant="toolbar" />
          <AnalysisFilters
            accounts={accounts}
            accountGroupIds={accountGroupIds}
            accountIds={accountIds}
            checkboxVariant="highlight"
            enableAccountConnectionToggle
            includeUnclassified={includeUnclassified}
            ownerIds={ownerIds}
            owners={owners}
            onAccountChange={(ids) => setListFilter(PORTFOLIO_PARAMS.accountIds, ids)}
            onAccountGroupChange={(ids) => setListFilter(PORTFOLIO_PARAMS.accountGroupIds, ids)}
            onClear={clearFilters}
            onIncludeUnclassifiedChange={setIncludeUnclassified}
            onOwnerChange={(ids) => setListFilter(PORTFOLIO_PARAMS.ownerIds, ids)}
          />
        </PageToolbarActions>
      </PageToolbar>

      <QueryGate
        data={report}
        empty={Boolean(report && report.slices.length === 0)}
        emptyTitle="No public portfolio holdings yet"
        emptyDescription="Run a balance sync after linking investment accounts to populate portfolio analysis."
        error={invalidIDError ? undefined : error}
        errorPrefix="Failed to load portfolio analysis"
        fetching={fetching || invalidIDError}
        loadingLabel="Loading portfolio analysis"
        onRetry={() => refetch({ requestPolicy: 'network-only' })}
      >
        {report && report.slices.length > 0 ? (
          <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <AnalysisPieChart amountsHidden={amountsHidden} selectedLabel={selectedSlice} slices={report.slices} totalValueUSD={report.totalValueUSD} onSliceClick={setSelectedSlice} />
            <AnalysisSliceList amountsHidden={amountsHidden} selectedLabel={selectedSlice} slices={report.slices} onEditAsset={openAsset} onSelectedLabelChange={setSelectedSlice} />
          </div>
        ) : null}
      </QueryGate>
      {selectedAsset ? (
        <AssetEditModal
          key={selectedAsset.id}
          asset={selectedAsset}
          activeTab={selectedAssetTab}
          basePath={`/portfolio/assets/${selectedAsset.id}`}
          tabSearch={location.search}
          onClose={closeAssetModal}
          onUpdate={() => {
            refetch({ requestPolicy: 'network-only' })
          }}
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
            accountGroupIds={accountGroupIds}
            accountIds={accountIds}
            checkboxVariant="highlight"
            enableAccountConnectionToggle
            includeUnclassified={includeUnclassified}
            ownerIds={ownerIds}
            owners={owners}
            onAccountChange={(ids) => setListFilter(PORTFOLIO_PARAMS.accountIds, ids)}
            onAccountGroupChange={(ids) => setListFilter(PORTFOLIO_PARAMS.accountGroupIds, ids)}
            onIncludeUnclassifiedChange={setIncludeUnclassified}
            onOwnerChange={(ids) => setListFilter(PORTFOLIO_PARAMS.ownerIds, ids)}
          />
        </MobileFilterDropdown>
      ) : null}
    </div>
  )
}

interface PortfolioFilterParams {
  ownerIds: string[]
  accountGroupIds: AccountGroupId[]
  accountIds: string[]
  includeUnclassified: boolean
}

function hasPortfolioFilters(filters: PortfolioFilterParams) {
  return Boolean(filters.ownerIds.length || filters.accountGroupIds.length || filters.accountIds.length || filters.includeUnclassified)
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

function analysisInput(view: AnalysisView, ownerIds: string[], accountGroupIds: AccountGroupId[], accountIds: string[], includeUnclassified: boolean): AnalysisInput {
  const accountSubtypes = subtypesForAccountGroupIds(accountGroupIds)
  return {
    view,
    ...(ownerIds.length ? { ownerIds } : {}),
    ...(accountSubtypes.length ? { accountSubtypes } : {}),
    ...(accountIds.length ? { accountIds } : {}),
    ...(includeUnclassified ? { includeUnclassified: true } : {}),
  }
}
