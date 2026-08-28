import { useCallback, useMemo, useRef, useState } from 'react'
import { Copy } from 'lucide-react'
import { addYears, format, subMonths } from 'date-fns'
import { Navigate, useNavigate, useParams } from 'react-router'
import { BudgetPeriodNav } from '../components/budgets/BudgetPeriodNav'
import { BudgetSectionList } from '../components/budgets/BudgetSectionList'
import { BudgetSetupWizard, EmptyMonthOptions, FirstBudgetIntro } from '../components/budgets/BudgetSetupWizard'
import { BudgetTotals } from '../components/budgets/BudgetTotals'
import { BudgetYearView } from '../components/budgets/BudgetYearView'
import { actualsByCategory, useBudgetSetup } from '../components/budgets/useBudgetSetup'
import { ErrorState } from '../components/common/ErrorState'
import { FormError } from '../components/common/FormControls'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { PageHeader } from '../components/common/PageHeader'
import { PageToolbarButton } from '../components/common/PageToolbar'
import { SegmentedControl } from '../components/common/SegmentedControl'
import { useMobileHeaderActions } from '../components/layout/useMobileHeader'
import { useBudgetMutations, useBudgetReport, useBudgetReportHistory } from '../hooks/useBudgets'
import { useCategoryGroups } from '../hooks/useEntityQueries'
import { usePermissions } from '../hooks/usePermissions'
import { useSaveAction } from '../hooks/useSaveAction'
import { currentBudgetPath, getCurrentPeriod, periodFromMonthKey, shiftPeriod } from '../utils/dates'

type BudgetView = 'MONTH' | 'YEAR'
type BudgetMode = 'first-budget' | 'empty-month' | 'setup' | 'month' | 'year'

const budgetViewOptions: Array<{ value: BudgetView; label: string }> = [
  { value: 'MONTH', label: 'Monthly' },
  { value: 'YEAR', label: 'Yearly' },
]

export function BudgetPage() {
  const navigate = useNavigate()
  const { month } = useParams()
  const routedView = month && /^\d{4}$/.test(month) ? 'YEAR' : 'MONTH'
  const routedMonth = routedView === 'YEAR' ? `${month}-01` : month
  const routedPeriod = useMemo(() => (routedMonth ? periodFromMonthKey(routedMonth) : null), [routedMonth])
  const fallbackPeriod = useMemo(() => getCurrentPeriod('MONTHLY'), [])
  const period = routedPeriod ?? fallbackPeriod
  const monthKey = format(period.start, 'yyyy-MM')
  const previousMonth = format(subMonths(period.start, 1), 'yyyy-MM')
  const year = format(period.start, 'yyyy')
  const view: BudgetView = routedView
  const yearHistoryInput = useMemo(() => ({ startMonth: `${year}-01`, endMonth: `${Number(year) + 1}-01` }), [year])

  const { report, error, fetching, reexecuteQuery } = useBudgetReport({ month: monthKey }, view === 'YEAR')
  const { history, error: historyError, fetching: historyFetching, reexecuteQuery: reexecuteHistory } = useBudgetReportHistory()
  const { history: yearHistory, error: yearHistoryError, fetching: yearHistoryFetching, reexecuteQuery: reexecuteYearHistory } = useBudgetReportHistory(yearHistoryInput, true, view !== 'YEAR')
  const { categoryGroups } = useCategoryGroups()
  const { canWrite } = usePermissions()
  const canWriteBudgets = canWrite('budgets')
  const { setBudget, copyBudgets, setBudgetState, copyBudgetsState } = useBudgetMutations()
  const [savingCategoryId, setSavingCategoryId] = useState<string | null>(null)
  const { error: pageError, save } = useSaveAction()
  const [setupMode, setSetupMode] = useState(false)
  const [localBudgetMonths, setLocalBudgetMonths] = useState<Set<string>>(() => new Set())

  const budgetGroups = useMemo(() => categoryGroups.filter((g) => g.kind !== 'TRANSFER'), [categoryGroups])
  const budgetCategories = useMemo(() => budgetGroups.flatMap((group) => group.categories), [budgetGroups])
  const hasBudgetHistory = (history?.items.length ?? 0) > 0
  const hasBudgetForMonth = Boolean(history?.items.some((item) => item.month === monthKey) || localBudgetMonths.has(monthKey))
  const lastBudgetMonth = useMemo(() => {
    if (!history?.items.length) return previousMonth
    return [...history.items].sort((a, b) => b.month.localeCompare(a.month))[0].month
  }, [history, previousMonth])
  const [copyFromMonth, setCopyFromMonth] = useState('')
  const budgetMode: BudgetMode = setupMode ? 'setup'
    : canWriteBudgets && history && !hasBudgetHistory ? 'first-budget'
    : canWriteBudgets && view === 'MONTH' && history && hasBudgetHistory && !hasBudgetForMonth ? 'empty-month'
    : view === 'YEAR' ? 'year' : 'month'
  const isOnboarding = budgetMode !== 'month' && budgetMode !== 'year'
  const showCopyLastMonth = Boolean(canWriteBudgets && history && budgetMode === 'month' && !hasBudgetForMonth)
  const selectedCopyFromMonth = copyFromMonth || lastBudgetMonth
  const { report: previousReport } = useBudgetReport({ month: previousMonth }, !isOnboarding)
  const previousActuals = useMemo(() => actualsByCategory(previousReport), [previousReport])
  const setup = useBudgetSetup({ active: setupMode, monthKey, categories: budgetCategories, previousActuals })
  const lastMonthKey = useRef(monthKey)
  const lastYear = useRef(year)

  if (view === 'MONTH') lastMonthKey.current = monthKey
  else lastYear.current = year

  const handleChangeView = useCallback((nextView: BudgetView) => {
    if (nextView === view) return
    navigate(nextView === 'YEAR' ? `/budgets/${lastYear.current}` : `/budgets/${lastMonthKey.current}`)
  }, [navigate, view])

  const mobileHeaderActions = useMemo(() => {
    if (!hasBudgetHistory) return null
    return <BudgetViewToggle compact onChange={handleChangeView} view={view} />
  }, [handleChangeView, hasBudgetHistory, view])

  useMobileHeaderActions(mobileHeaderActions)

  async function handleSaveLine(categoryId: string, amount: number) {
    setSavingCategoryId(categoryId)
    await save(
      () => setBudget({ input: { month: monthKey, categoryId, amount } }).finally(() => setSavingCategoryId(null)),
      () => reexecuteQuery({ requestPolicy: 'network-only' }),
    )
  }

  async function handleCopyLastMonth() {
    await save(
      () => copyBudgets({ input: { fromMonth: previousMonth, toMonth: monthKey } }),
      () => reexecuteQuery({ requestPolicy: 'network-only' }),
    )
  }

  async function handleCopyFromMonth() {
    await save(
      () => copyBudgets({ input: { fromMonth: selectedCopyFromMonth, toMonth: monthKey } }),
      () => {
        setLocalBudgetMonths((current) => new Set(current).add(monthKey))
        reexecuteHistory({ requestPolicy: 'network-only' })
        reexecuteQuery({ requestPolicy: 'network-only' })
      },
    )
  }

  async function handleContinueSetup() {
    await save(
      async () => {
        const setupError = await setup.saveAll()
        if (setupError) throw new Error(setupError)
        return {}
      },
      () => {
        setLocalBudgetMonths((current) => new Set(current).add(monthKey))
        setSetupMode(false)
        reexecuteHistory({ requestPolicy: 'network-only' })
        reexecuteQuery({ requestPolicy: 'network-only' })
      },
    )
  }

  function handleShiftMonth(direction: -1 | 1) {
    const next = view === 'YEAR'
      ? periodFromMonthKey(format(addYears(period.start, direction), 'yyyy-MM')) ?? period
      : shiftPeriod(period, direction)
    navigate(view === 'YEAR' ? `/budgets/${format(next.start, 'yyyy')}` : `/budgets/${format(next.start, 'yyyy-MM')}`)
  }

  if (month && (!routedPeriod || (view === 'MONTH' && !/^\d{4}-\d{2}$/.test(month)))) {
    return <Navigate replace to={currentBudgetPath()} />
  }

  return (
    <div className="space-y-4 lg:space-y-6">
      <PageHeader
        actions={hasBudgetHistory || showCopyLastMonth ? (
          <>
          {hasBudgetHistory ? <BudgetViewToggle onChange={handleChangeView} view={view} /> : null}
          {showCopyLastMonth ? (
            <PageToolbarButton
              disabled={copyBudgetsState.fetching}
              onClick={handleCopyLastMonth}
            >
              <Copy aria-hidden className="h-4 w-4" />
              Copy last month
            </PageToolbarButton>
          ) : null}
          </>
        ) : undefined}
        title="Budgets"
      />

      {budgetMode !== 'first-budget' && budgetMode !== 'setup' ? (
        <BudgetPeriodNav
          label={view === 'YEAR' ? year : period.label}
          onShift={handleShiftMonth}
          unit={view === 'YEAR' ? 'year' : 'month'}
        />
      ) : null}

      {pageError ? <FormError>{pageError}</FormError> : null}

      {historyFetching && !history ? <LoadingSpinner label="Checking budget history" /> : null}
      {historyError ? <ErrorState message="Could not load budget history." onRetry={() => reexecuteHistory({ requestPolicy: 'network-only' })} /> : null}

      {budgetMode === 'first-budget' ? (
        <FirstBudgetIntro onStart={() => setSetupMode(true)} />
      ) : budgetMode === 'empty-month' ? (
        <EmptyMonthOptions
          availableMonths={[...(history?.items ?? [])].sort((a, b) => b.month.localeCompare(a.month)).map((i) => i.month)}
          copying={copyBudgetsState.fetching}
          copyFromMonth={selectedCopyFromMonth}
          onCopy={handleCopyFromMonth}
          onCopyFromMonthChange={setCopyFromMonth}
          onSetup={() => setSetupMode(true)}
        />
      ) : budgetMode === 'setup' ? (
        <BudgetSetupWizard
          categories={budgetCategories}
          drafts={setup.drafts}
          included={setup.included}
          isFirstBudget={!hasBudgetHistory}
          lastMonthActuals={previousActuals}
          onAddCategory={setup.addCategory}
          onChangeAmount={setup.changeAmount}
          onContinue={handleContinueSetup}
          onRemoveCategory={setup.removeCategory}
          saving={setup.saving}
        />
      ) : null}

      {budgetMode === 'month' && report ? <BudgetTotals report={report} /> : null}

      {budgetMode === 'month' && fetching && !report ? <LoadingSpinner label="Loading budget" /> : null}
      {budgetMode === 'month' && error ? <ErrorState message="Could not load budget." onRetry={() => reexecuteQuery({ requestPolicy: 'network-only' })} /> : null}

      {budgetMode === 'year' && yearHistoryFetching && !yearHistory ? <LoadingSpinner label="Loading budget history" /> : null}
      {budgetMode === 'year' && yearHistoryError ? <ErrorState message="Could not load budget history." onRetry={() => reexecuteYearHistory({ requestPolicy: 'network-only' })} /> : null}
      {budgetMode === 'year' && yearHistory ? (
        <BudgetYearView categoryGroups={budgetGroups} history={yearHistory.items} year={year} />
      ) : null}

      {budgetMode === 'month' && report ? (
        <BudgetSectionList
          categoryGroups={budgetGroups}
          editable={canWriteBudgets}
          monthKey={monthKey}
          onSaveLine={handleSaveLine}
          report={report}
          savingCategoryId={setBudgetState.fetching ? savingCategoryId : null}
        />
      ) : null}
    </div>
  )
}

function BudgetViewToggle({ compact = false, onChange, view }: { compact?: boolean; onChange: (view: BudgetView) => void; view: BudgetView }) {
  return (
    <SegmentedControl ariaLabel="Budget view" options={budgetViewOptions} size={compact ? 'sm' : 'md'} value={view} onChange={onChange} />
  )
}
