import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import { AccountDetailModal } from '../components/institutions/AccountDetailModal'
import { useMobileHeader, useMobileHeaderActions } from '../components/layout/useMobileHeader'
import { MobileFilterButton, MobileFilterDropdown } from '../components/common/MobileFilterDropdown'
import { MobileFilterFooter } from '../components/common/MobileFilterFooter'
import { PageHeader } from '../components/common/PageHeader'
import { AmountVisibilityButton } from '../components/common/AmountVisibilityButton'
import { AnalysisFilterContent, AnalysisFilters } from '../components/portfolio/AnalysisFilters'
import { AccountSidebar } from '../components/wealth/AccountSidebar'
import { AssetEditModal } from '../components/wealth/AssetEditModal'
import { NetWorthBreakdownPanels } from '../components/wealth/NetWorthBreakdownPanels'
import { NetWorthChart } from '../components/wealth/NetWorthChart'
import { NetWorthHero } from '../components/wealth/NetWorthHero'
import { useNetWorthModalRoutes } from '../components/wealth/useNetWorthModalRoutes'
import { useHistoricalNetWorth, useNetWorth } from '../hooks/useNetWorth'
import { useNetWorthParams } from '../hooks/useNetWorthParams'
import { useOwners } from '../hooks/useEntityQueries'
import { usePermissions } from '../hooks/usePermissions'
import { accountGroupIdsFromAccountIds, accountsFromNetWorthReport, hasNetWorthFilters, netWorthChangeOverRange, netWorthInputFromFilters } from '../utils/netWorth'
import { isInvalidGlobalIDError } from '../utils/graphqlErrors'
import type { AssetClassifier, Granularity, NetWorthRange } from '../types/graphql'
import { accountIdsForAccountGroupIds, type AccountGroupId } from '../utils/accountGroups'

// Only true background clicks deselect the account filter. Clicks on any
// control express a different intent — and a control's own URL update would
// race with the clear, since two setSearchParams in one tick clobber each
// other. Data-attribute regions cover non-interactive surfaces (chart hover
// areas, breakdown tables, sidebar padding) that display the filtered data.
const KEEP_ACCOUNT_FILTERS_SELECTOR = 'button, a, input, select, textarea, label, [role="dialog"], [role="presentation"], [data-account-sidebar], [data-net-worth-filters], [data-net-worth-breakdown], [data-net-worth-chart]'
const NO_ACCOUNT_IDS: string[] = []

function granularityForRange(range: NetWorthRange): Granularity {
  if (range === 'ONE_MONTH' || range === 'THREE_MONTH') return 'DAILY'
  if (range === 'YTD' || range === 'ONE_YEAR') return 'WEEKLY'
  return 'MONTHLY'
}

export function NetWorthPage() {
  const { canRead } = usePermissions()
  const canReadHoldings = canRead('holdings')
  const { range, ownerIds, accountIds, amountsHidden, setRange, setOwnerIds, setAccountIds, toggleAmountsHidden, clearAccountFilters, clearFilters, replaceFilters } = useNetWorthParams()
  const [selectedClassifier, setSelectedClassifier] = useState<AssetClassifier | null>(null)
  const [selectedLiabilityCategory, setSelectedLiabilityCategory] = useState<string | null>(null)
  const [view, setView] = useState<'ASSETS' | 'LIABILITIES'>('ASSETS')
  const mobile = useMobileHeader()
  const { owners } = useOwners()
  const effectiveAccountIds = canReadHoldings ? accountIds : NO_ACCOUNT_IDS
  const netWorthInput = useMemo(() => netWorthInputFromFilters(ownerIds, effectiveAccountIds), [ownerIds, effectiveAccountIds])
  const sidebarNetWorthInput = useMemo(() => netWorthInputFromFilters(ownerIds, []), [ownerIds])
  const historicalInput = useMemo(() => ({ range, granularity: granularityForRange(range), ...(hasNetWorthFilters(netWorthInput) ? { filters: netWorthInput } : {}) }), [range, netWorthInput])
  const selectedAccountIds = effectiveAccountIds
  const { report: sidebarReport } = useNetWorth(sidebarNetWorthInput, effectiveAccountIds.length === 0)
  const { report, fetching, error, refetch } = useNetWorth(netWorthInput)
  const { historicalReport } = useHistoricalNetWorth(historicalInput)
  const invalidIDError = isInvalidGlobalIDError(error)
  const accountSidebarReport = sidebarReport ?? report
  const netWorthAccounts = useMemo(() => accountSidebarReport ? accountsFromNetWorthReport(accountSidebarReport) : [], [accountSidebarReport])
  const selectedAccountGroupIds = useMemo(() => accountGroupIdsFromAccountIds(netWorthAccounts, effectiveAccountIds), [netWorthAccounts, effectiveAccountIds])
  const modalRoutes = useNetWorthModalRoutes(report ?? null)
  const pageClassName = 'lg:min-h-screen'

  useEffect(() => {
    if (invalidIDError) replaceFilters([], [])
  }, [invalidIDError, replaceFilters])

  const toggleAccountGroup = useCallback((_accountGroupId: AccountGroupId | null, groupAccountIds: string[]) => {
    setAccountIds((current) => toggleIds(current, groupAccountIds))
  }, [setAccountIds])
  const setAccountGroups = useCallback((groupIds: AccountGroupId[]) => setAccountIds(accountIdsForAccountGroupIds(netWorthAccounts, groupIds)), [netWorthAccounts, setAccountIds])

  function clearAccountFiltersFromOutsideClick(event: MouseEvent<HTMLDivElement>) {
    if (!canReadHoldings || !accountIds.length) return
    const target = event.target as HTMLElement
    if (target.closest(KEEP_ACCOUNT_FILTERS_SELECTOR)) return
    clearAccountFilters()
  }

  const mobileHeaderActions = useMemo(() => (
    <>
      <AmountVisibilityButton amountsHidden={amountsHidden} onToggle={toggleAmountsHidden} variant="mobile" />
      <div data-net-worth-filters>
        <MobileFilterButton active={mobile.filterOpen} ariaLabel="Open net worth filters" highlighted={hasNetWorthFilters(netWorthInput)} onClick={mobile.filterOpen ? mobile.closeFilter : mobile.openFilter} />
      </div>
    </>
  ), [amountsHidden, mobile.closeFilter, mobile.filterOpen, mobile.openFilter, netWorthInput, toggleAmountsHidden])

  useMobileHeaderActions(mobileHeaderActions)

  if ((fetching || invalidIDError) && !report) {
    return <div className={`${pageClassName} text-neutral-500`}>Loading net worth...</div>
  }

  if (error && !invalidIDError) {
    return <div className={`${pageClassName} text-red-700`}>Failed to load net worth: {error.message}</div>
  }

  if (!report) {
    return <div className={`${pageClassName} text-neutral-500`}>No wealth data yet. Run a balance sync after linking Plaid accounts.</div>
  }

  const { changeUSD, changePct } = netWorthChangeOverRange(report.currentNetWorthUSD, historicalReport?.series)
  const positive = changeUSD >= 0
  const visibleAccountSidebarReport = accountSidebarReport ?? report
  const breakdownPanelProps = {
    amountsHidden,
    canReadHoldings,
    report,
    selectedClassifier,
    selectedLiabilityCategory,
    view,
    onAssetClick: modalRoutes.openAsset,
    onSelectClassifier: setSelectedClassifier,
    onSelectLiabilityCategory: setSelectedLiabilityCategory,
    onViewChange: setView,
  }
  return (
    <div className={pageClassName} onClick={clearAccountFiltersFromOutsideClick}>
      <PageHeader
        actions={(
          <>
          <AmountVisibilityButton amountsHidden={amountsHidden} onToggle={toggleAmountsHidden} variant="toolbar" />
          <div data-net-worth-filters>
            <AnalysisFilters
              accountGroupCountMode="derived"
              accounts={netWorthAccounts}
              accountGroupIds={selectedAccountGroupIds}
              accountIds={effectiveAccountIds}
              enableAccountConnectionToggle
              ownerIds={ownerIds}
              owners={owners}
              showAccountFilters={canReadHoldings}
              onAccountChange={setAccountIds}
              onAccountGroupChange={setAccountGroups}
              onClear={clearFilters}
              onOwnerChange={setOwnerIds}
            />
          </div>
          </>
        )}
        className="mb-4"
        title="Net Worth"
      />
      <div className="flex gap-4">
        <AccountSidebar
          amountsHidden={amountsHidden}
          breakdown={visibleAccountSidebarReport.classifierBreakdown}
          canReadHoldings={canReadHoldings}
          liabilityBreakdown={visibleAccountSidebarReport.liabilityBreakdown}
          netWorth={visibleAccountSidebarReport.currentNetWorthUSD}
          selectedAccountGroupIds={selectedAccountGroupIds}
          selectedAccountIds={selectedAccountIds}
          onAccountClick={canReadHoldings ? modalRoutes.openAccountValuation : undefined}
          onAccountGroupClick={canReadHoldings ? toggleAccountGroup : undefined}
        />
        <div className="min-w-0 flex-1 space-y-4 lg:space-y-0">
          <NetWorthHero amountsHidden={amountsHidden} changePct={changePct} changeUSD={changeUSD} report={report} />

          <div className="hidden lg:block lg:space-y-4">
            <div data-net-worth-chart>
              <NetWorthChart amountsHidden={amountsHidden} asOfDate={report.asOfDate} classifierSeries={historicalReport?.classifierSeries} liabilitySeries={historicalReport?.liabilitySeries} netWorthUSD={report.currentNetWorthUSD} onRangeChange={setRange} points={historicalReport?.series ?? []} positive={positive} range={range} />
            </div>

            <NetWorthBreakdownPanels variant="desktop" {...breakdownPanelProps} />
          </div>

          <NetWorthBreakdownPanels variant="mobile" {...breakdownPanelProps} />

          <div className="lg:hidden">
            <AccountSidebar
              amountsHidden={amountsHidden}
              breakdown={visibleAccountSidebarReport.classifierBreakdown}
              canReadHoldings={canReadHoldings}
              className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
              heading="Accounts"
              liabilityBreakdown={visibleAccountSidebarReport.liabilityBreakdown}
              netWorth={visibleAccountSidebarReport.currentNetWorthUSD}
              selectedAccountGroupIds={selectedAccountGroupIds}
              selectedAccountIds={selectedAccountIds}
              onAccountClick={canReadHoldings ? modalRoutes.openAccountValuation : undefined}
              onAccountGroupClick={canReadHoldings ? toggleAccountGroup : undefined}
              showSummary={false}
            />
          </div>

          <div className="lg:hidden" data-net-worth-chart>
            <NetWorthChart amountsHidden={amountsHidden} asOfDate={report.asOfDate} classifierSeries={historicalReport?.classifierSeries} liabilitySeries={historicalReport?.liabilitySeries} onRangeChange={setRange} points={historicalReport?.series ?? []} positive={positive} range={range} />
          </div>
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
            refetch({ requestPolicy: 'network-only' })
          }}
          onUpdate={() => refetch({ requestPolicy: 'network-only' })}
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
          onUpdate={() => refetch({ requestPolicy: 'network-only' })}
        />
      ) : null}
      {mobile.filterOpen ? (
        <div data-net-worth-filters>
          <MobileFilterDropdown
            bodyClassName="space-y-4"
            footer={(
              <MobileFilterFooter
                primaryLabel="Done"
                onPrimary={mobile.closeFilter}
                onSecondary={clearFilters}
              />
            )}
            labelledBy="net-worth-filters-title"
            onClose={mobile.closeFilter}
          >
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

function toggleIds<T extends string>(ids: T[], toggledIds: T[]): T[] {
  if (toggledIds.length === 0) return ids
  const toggled = new Set(toggledIds)
  if (toggledIds.every((id) => ids.includes(id))) return ids.filter((id) => !toggled.has(id))
  return [...ids, ...toggledIds.filter((id) => !ids.includes(id))]
}
