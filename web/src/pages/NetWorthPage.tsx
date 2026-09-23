import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { AccountDetailModal } from '../components/institutions/AccountDetailModal'
import { useMobileHeader, useMobileHeaderActions } from '../components/layout/useMobileHeader'
import { CollapsibleFilterSection } from '../components/common/CollapsibleFilterSection'
import { FilterRadioList } from '../components/common/FilterCheckboxList'
import { MobileFilterButton, MobileFilterDropdown } from '../components/common/MobileFilterDropdown'
import { MobileFilterFooter } from '../components/common/MobileFilterFooter'
import { QueryGate } from '../components/common/QueryGate'
import { AmountVisibilityButton } from '../components/common/AmountVisibilityButton'
import { AnalysisFilterContent } from '../components/portfolio/AnalysisFilters'
import { AccountSidebar } from '../components/wealth/AccountSidebar'
import { AllocationCard, type BreakdownView, type FocusState } from '../components/wealth/AllocationCard'
import { AssetEditModal } from '../components/wealth/AssetEditModal'
import { NetWorthCard } from '../components/wealth/NetWorthCard'
import { NetWorthFilterPanel } from '../components/wealth/NetWorthFilterPanel'
import { NET_WORTH_RANGE_OPTIONS, rangeOption } from '../components/wealth/netWorthRanges'
import { useNetWorthModalRoutes } from '../components/wealth/useNetWorthModalRoutes'
import { useHistoricalNetWorth, useNetWorth } from '../hooks/useNetWorth'
import { useNetWorthParams } from '../hooks/useNetWorthParams'
import { useOwners } from '../hooks/useEntityQueries'
import { usePermissions } from '../hooks/usePermissions'
import { accountGroupIdsFromAccountIds, accountsFromNetWorthReport, hasNetWorthFilters, netWorthChangeOverRange, netWorthInputFromFilters } from '../utils/netWorth'
import { isInvalidGlobalIDError } from '../utils/graphqlErrors'
import type { AssetClassifier, Granularity, NetWorthRange } from '../types/graphql'
import { accountIdsForAccountGroupIds, type AccountGroupId } from '../utils/accountGroups'
import { toggleSelectedIds } from '../utils/selection'

// Only true background clicks deselect the account filter. Clicks on any
// control express a different intent — and a control's own URL update would
// race with the clear, since two setSearchParams in one tick clobber each
// other. Data-attribute regions cover non-interactive surfaces (chart hover
// areas, breakdown tables, sidebar padding) that display the filtered data.
const KEEP_ACCOUNT_FILTERS_SELECTOR = 'button, a, input, select, textarea, label, [role="dialog"], [role="presentation"], [data-account-sidebar], [data-net-worth-filters], [data-net-worth-breakdown], [data-net-worth-chart]'
const NO_ACCOUNT_IDS: string[] = []
const PAGE_CLASS_NAME = 'lg:min-h-screen'

function granularityForRange(range: NetWorthRange): Granularity {
  if (range === 'ONE_MONTH' || range === 'THREE_MONTH') return 'DAILY'
  if (range === 'YTD' || range === 'ONE_YEAR') return 'WEEKLY'
  return 'MONTHLY'
}

export function NetWorthPage() {
  const { canRead } = usePermissions()
  const canReadHoldings = canRead('holdings')
  const { range, ownerIds, accountIds, focusDate, amountsHidden, setRange, setOwnerIds, setAccountIds, setFocusDate, toggleAmountsHidden, clearAccountFilters, clearFilters, replaceFilters } = useNetWorthParams()
  const [selectedClassifier, setSelectedClassifier] = useState<AssetClassifier | null>(null)
  const [selectedLiabilityCategory, setSelectedLiabilityCategory] = useState<string | null>(null)
  const [view, setView] = useState<BreakdownView>('ASSETS')
  const [dateSectionOpen, setDateSectionOpen] = useState(false)
  const mobile = useMobileHeader()
  const { owners } = useOwners()
  const effectiveAccountIds = canReadHoldings ? accountIds : NO_ACCOUNT_IDS
  const netWorthInput = useMemo(() => netWorthInputFromFilters(ownerIds, effectiveAccountIds), [ownerIds, effectiveAccountIds])
  const sidebarNetWorthInput = useMemo(() => netWorthInputFromFilters(ownerIds, []), [ownerIds])
  const historicalInput = useMemo(() => ({ range, granularity: granularityForRange(range), ...(hasNetWorthFilters(netWorthInput) ? { filters: netWorthInput } : {}) }), [range, netWorthInput])
  const { report: sidebarReport } = useNetWorth(sidebarNetWorthInput, effectiveAccountIds.length === 0)
  // The focused-date report only drives the allocation card; the hero, sidebar
  // and range change stay on the live position.
  const focusedInput = useMemo(() => focusDate ? { ...netWorthInput, asOfDate: focusDate } : netWorthInput, [focusDate, netWorthInput])
  const focusedQuery = useNetWorth(focusedInput, !focusDate)
  const { report, fetching, error, refetch } = useNetWorth(netWorthInput)
  // urql keeps the previous variables' data while a new request is in flight,
  // so only a settled report for this exact date may stand in for it.
  const focusState = focusStateFor(focusDate, focusedQuery)
  const breakdownReport = focusState === 'ready' ? focusedQuery.report : report
  const { historicalReport } = useHistoricalNetWorth(historicalInput)
  const invalidIDError = isInvalidGlobalIDError(error)
  const accountSidebarReport = sidebarReport ?? report
  const netWorthAccounts = useMemo(() => accountSidebarReport ? accountsFromNetWorthReport(accountSidebarReport) : [], [accountSidebarReport])
  const selectedAccountGroupIds = useMemo(() => accountGroupIdsFromAccountIds(netWorthAccounts, effectiveAccountIds), [netWorthAccounts, effectiveAccountIds])
  const modalRoutes = useNetWorthModalRoutes(breakdownReport ?? null)
  const filterCount = ownerIds.length + effectiveAccountIds.length

  useEffect(() => {
    if (invalidIDError) replaceFilters([], [])
  }, [invalidIDError, replaceFilters])

  const toggleAccountGroup = useCallback((_accountGroupId: AccountGroupId | null, groupAccountIds: string[]) => {
    setAccountIds((current) => toggleSelectedIds(current, groupAccountIds))
  }, [setAccountIds])
  const setAccountGroups = useCallback((groupIds: AccountGroupId[]) => setAccountIds(accountIdsForAccountGroupIds(netWorthAccounts, groupIds)), [netWorthAccounts, setAccountIds])
  const clearFocusDate = useCallback(() => setFocusDate(null), [setFocusDate])
  const refetchFocused = focusedQuery.refetch
  const retryFocus = useCallback(() => refetchFocused({ requestPolicy: 'network-only' }), [refetchFocused])
  const refetchLive = useCallback(() => refetch({ requestPolicy: 'network-only' }), [refetch])

  function clearAccountFiltersFromOutsideClick(event: MouseEvent<HTMLDivElement>) {
    if (!canReadHoldings || !accountIds.length) return
    const target = event.target as HTMLElement
    if (target.closest(KEEP_ACCOUNT_FILTERS_SELECTOR)) return
    clearAccountFilters()
  }

  const mobileHeaderActions = useMemo(() => (
    <>
      <div data-net-worth-filters>
        <MobileFilterButton active={mobile.filterOpen} ariaLabel="Open net worth filters" count={filterCount} onClick={mobile.filterOpen ? mobile.closeFilter : mobile.openFilter} />
      </div>
      <AmountVisibilityButton amountsHidden={amountsHidden} onToggle={toggleAmountsHidden} variant="mobile" />
    </>
  ), [amountsHidden, filterCount, mobile.closeFilter, mobile.filterOpen, mobile.openFilter, toggleAmountsHidden])

  useMobileHeaderActions(mobileHeaderActions)

  if (!report || (error && !invalidIDError)) {
    return (
      <div className={PAGE_CLASS_NAME}>
        <QueryGate data={report} empty={!report} emptyDescription="Run a balance sync after linking accounts." emptyTitle="No wealth data yet" error={invalidIDError ? undefined : error} errorPrefix="Failed to load net worth" fetching={fetching || invalidIDError} loadingLabel="Loading net worth" onRetry={refetchLive} />
      </div>
    )
  }

  const { changeUSD, changePct } = netWorthChangeOverRange(report.currentNetWorthUSD, historicalReport?.series)
  const visibleAccountSidebarReport = accountSidebarReport ?? report
  const sidebarProps = {
    amountsHidden,
    breakdown: visibleAccountSidebarReport.classifierBreakdown,
    canReadHoldings,
    liabilityBreakdown: visibleAccountSidebarReport.liabilityBreakdown,
    netWorth: visibleAccountSidebarReport.currentNetWorthUSD,
    selectedAccountGroupIds,
    selectedAccountIds: effectiveAccountIds,
    onAccountClick: canReadHoldings ? modalRoutes.openAccountValuation : undefined,
    onAccountGroupClick: canReadHoldings ? toggleAccountGroup : undefined,
    onClearAccountFilters: clearAccountFilters,
  }
  return (
    <div className={PAGE_CLASS_NAME} onClick={clearAccountFiltersFromOutsideClick}>
      <div className="grid gap-3 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)] lg:items-start">
        <AccountSidebar {...sidebarProps} variant="desktop" />
        <div className="min-w-0 space-y-3">
          <NetWorthCard
            amountsHidden={amountsHidden}
            changePct={changePct}
            changeUSD={changeUSD}
            filterCount={filterCount}
            filters={(
              <NetWorthFilterPanel
                accounts={netWorthAccounts}
                accountGroupIds={selectedAccountGroupIds}
                accountIds={effectiveAccountIds}
                owners={owners}
                ownerIds={ownerIds}
                range={range}
                showAccountFilters={canReadHoldings}
                onAccountChange={setAccountIds}
                onAccountGroupChange={setAccountGroups}
                onClear={clearFilters}
                onOwnerChange={setOwnerIds}
                onRangeChange={setRange}
              />
            )}
            focusDate={focusDate}
            historicalReport={historicalReport}
            range={range}
            report={report}
            onFocusDate={setFocusDate}
            onToggleAmountsHidden={toggleAmountsHidden}
          />
          <AccountSidebar {...sidebarProps} variant="mobile" />
          <AllocationCard
            amountsHidden={amountsHidden}
            canReadHoldings={canReadHoldings}
            focusDate={focusDate}
            focusState={focusState ?? undefined}
            historicalReport={historicalReport}
            range={range}
            report={breakdownReport ?? report}
            selectedClassifier={selectedClassifier}
            selectedLiabilityCategory={selectedLiabilityCategory}
            view={view}
            onAssetClick={modalRoutes.openAsset}
            onClearFocus={clearFocusDate}
            onRetryFocus={retryFocus}
            onSelectClassifier={setSelectedClassifier}
            onSelectLiabilityCategory={setSelectedLiabilityCategory}
            onViewChange={setView}
          />
        </div>
      </div>

      {modalRoutes.selectedAccount ? (
        <AccountDetailModal
          account={modalRoutes.selectedAccount}
          activeTab={modalRoutes.selectedAccountTab}
          basePath={`/net-worth/accounts/${modalRoutes.selectedAccount.id}`}
          tabSearch={modalRoutes.tabSearch}
          onClose={modalRoutes.closeModal}
          onDelete={() => {
            modalRoutes.closeModal()
            refetchLive()
          }}
          onUpdate={refetchLive}
        />
      ) : null}
      {modalRoutes.selectedAsset ? (
        <AssetEditModal
          key={modalRoutes.selectedAsset.id}
          asset={modalRoutes.selectedAsset}
          activeTab={modalRoutes.selectedAssetTab}
          basePath={`/net-worth/assets/${modalRoutes.selectedAsset.id}`}
          tabSearch={modalRoutes.tabSearch}
          onClose={modalRoutes.closeModal}
          onUpdate={refetchLive}
        />
      ) : null}
      {mobile.filterOpen ? (
        <div data-net-worth-filters>
          <MobileFilterDropdown
            footer={<MobileFilterFooter primaryLabel="Apply" onPrimary={mobile.closeFilter} />}
            labelledBy="net-worth-filters-title"
            onClear={clearFilters}
            onClose={mobile.closeFilter}
            title="Filters"
          >
            <CollapsibleFilterSection active={false} expanded={dateSectionOpen} label="Date" summary={rangeOption(range).label} onToggle={() => setDateSectionOpen((current) => !current)}>
              <FilterRadioList
                options={NET_WORTH_RANGE_OPTIONS.map((option) => ({ id: option.id, label: option.label, ariaLabel: option.label, trailing: option.compact }))}
                selectedId={range}
                onChange={(id) => {
                  setRange(id)
                  setDateSectionOpen(false)
                }}
              />
            </CollapsibleFilterSection>
            <AnalysisFilterContent
              accounts={netWorthAccounts}
              accountGroupIds={selectedAccountGroupIds}
              accountIds={effectiveAccountIds}
              enableAccountConnectionToggle
              ownerIds={ownerIds}
              owners={owners}
              showAccountFilters={canReadHoldings}
              onAccountChange={setAccountIds}
              onAccountGroupChange={setAccountGroups}
              onOwnerChange={setOwnerIds}
            />
          </MobileFilterDropdown>
        </div>
      ) : null}
    </div>
  )
}

function focusStateFor(focusDate: string | undefined, query: ReturnType<typeof useNetWorth>): FocusState | null {
  if (!focusDate) return null
  if (query.fetching) return 'loading'
  if (query.error) return 'error'
  return query.report?.asOfDate === focusDate ? 'ready' : 'loading'
}
