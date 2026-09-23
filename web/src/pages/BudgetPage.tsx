import { useCallback, useMemo, useRef, useState } from 'react'
import { addYears, format, subMonths } from 'date-fns'
import { Navigate, useNavigate, useParams } from 'react-router'
import { BudgetAddModal } from '../components/budgets/BudgetAddModal'
import { BudgetEmptyMonth } from '../components/budgets/BudgetEmptyMonth'
import { AddBudgetButton, BudgetHeader, type BudgetView } from '../components/budgets/BudgetHeader'
import { BudgetSectionList } from '../components/budgets/BudgetSectionList'
import { BudgetSetupWizard, FirstBudgetIntro } from '../components/budgets/BudgetSetupWizard'
import { BudgetTotals } from '../components/budgets/BudgetTotals'
import { BudgetYearView } from '../components/budgets/BudgetYearView'
import { actualsByCategory, budgetedByCategory, useBudgetSetup } from '../components/budgets/useBudgetSetup'
import { FormError } from '../components/common/FormControls'
import { QueryGate } from '../components/common/QueryGate'
import { useMobileHeaderActions } from '../components/layout/useMobileHeader'
import { useBudgetMutations, useBudgetReport, useBudgetReportHistory } from '../hooks/useBudgets'
import { useCategoryGroups } from '../hooks/useEntityQueries'
import { usePermissions } from '../hooks/usePermissions'
import { useSaveAction } from '../hooks/useSaveAction'
import { currentBudgetPath, getCurrentPeriod, periodFromMonthKey, shiftPeriod } from '../utils/dates'

type BudgetMode = 'first-budget' | 'empty-month' | 'setup' | 'month' | 'year'

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
  const [addOpen, setAddOpen] = useState(false)
  const [localBudgetMonths, setLocalBudgetMonths] = useState<Set<string>>(() => new Set())

  const budgetGroups = useMemo(() => categoryGroups.filter((g) => g.kind !== 'TRANSFER'), [categoryGroups])
  const budgetCategories = useMemo(() => budgetGroups.flatMap((group) => group.categories), [budgetGroups])
  const hasBudgetHistory = (history?.items.length ?? 0) > 0
  const hasBudgetForMonth = Boolean(history?.items.some((item) => item.month === monthKey) || localBudgetMonths.has(monthKey))
  const availableMonths = useMemo(() => [...(history?.items ?? [])].map((item) => item.month).sort((a, b) => b.localeCompare(a)), [history])
  const lastBudgetMonth = availableMonths[0] ?? previousMonth
  const [copyFromMonth, setCopyFromMonth] = useState('')
  const budgetMode: BudgetMode = setupMode ? 'setup'
    : canWriteBudgets && history && !hasBudgetHistory ? 'first-budget'
    : canWriteBudgets && view === 'MONTH' && history && hasBudgetHistory && !hasBudgetForMonth ? 'empty-month'
    : view === 'YEAR' ? 'year' : 'month'
  const isOnboarding = budgetMode !== 'month' && budgetMode !== 'year'
  const showHeader = budgetMode !== 'first-budget' && budgetMode !== 'setup'
  const showCopyLastMonth = Boolean(canWriteBudgets && history && budgetMode === 'month' && !hasBudgetForMonth)
  const showAddBudget = canWriteBudgets && showHeader && view === 'MONTH'
  const selectedCopyFromMonth = copyFromMonth || lastBudgetMonth
  const unbudgetedCategories = useMemo(() => {
    const planned = budgetedByCategory(report)
    return budgetCategories.filter((category) => !(planned.get(category.id) ?? 0))
  }, [budgetCategories, report])
  const { report: previousReport, fetching: previousFetching } = useBudgetReport({ month: previousMonth }, !isOnboarding)
  const previousActuals = useMemo(() => actualsByCategory(previousReport), [previousReport])
  const setup = useBudgetSetup({ active: setupMode, monthKey, categories: budgetCategories, previousActuals, ready: !previousFetching })
  const lastMonthKey = useRef(monthKey)
  const lastYear = useRef(year)

  if (view === 'MONTH') lastMonthKey.current = monthKey
  else lastYear.current = year

  const handleChangeView = useCallback((nextView: BudgetView) => {
    if (nextView === view) return
    navigate(nextView === 'YEAR' ? `/budgets/${lastYear.current}` : `/budgets/${lastMonthKey.current}`)
  }, [navigate, view])

  const addDisabled = unbudgetedCategories.length === 0
  const mobileHeaderActions = useMemo(() => (
    showAddBudget ? <AddBudgetButton disabled={addDisabled} onClick={() => setAddOpen(true)} /> : null
  ), [addDisabled, showAddBudget])

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

  function handleBudgetAdded() {
    setLocalBudgetMonths((current) => new Set(current).add(monthKey))
    setAddOpen(false)
    reexecuteHistory({ requestPolicy: 'network-only' })
    reexecuteQuery({ requestPolicy: 'network-only' })
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
    <div className="space-y-3">
      <h1 className="sr-only">Budgets</h1>
      {showHeader ? (
        <BudgetHeader
          addDisabled={addDisabled}
          canWrite={showAddBudget}
          copying={copyBudgetsState.fetching}
          label={view === 'YEAR' ? year : period.label}
          onAddBudget={() => setAddOpen(true)}
          onChangeView={handleChangeView}
          onCopyMonth={handleCopyLastMonth}
          onShift={handleShiftMonth}
          showCopy={showCopyLastMonth}
          unit={view === 'YEAR' ? 'year' : 'month'}
          view={view}
        />
      ) : null}

      {pageError ? <FormError>{pageError}</FormError> : null}
      {addOpen ? <BudgetAddModal categories={unbudgetedCategories} month={monthKey} onClose={() => setAddOpen(false)} onSaved={handleBudgetAdded} /> : null}

      <QueryGate
        data={history ?? undefined}
        empty={false}
        emptyTitle="No budgets yet"
        error={historyError}
        errorPrefix="Could not load budget history"
        fetching={historyFetching}
        loadingLabel="Checking budget history"
        onRetry={() => reexecuteHistory({ requestPolicy: 'network-only' })}
      >
        {budgetMode === 'first-budget' ? (
          <FirstBudgetIntro onStart={() => setSetupMode(true)} />
        ) : budgetMode === 'empty-month' ? (
          <BudgetEmptyMonth
            availableMonths={availableMonths}
            copying={copyBudgetsState.fetching}
            copyFromMonth={selectedCopyFromMonth}
            monthLabel={period.label}
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
            onCancel={() => setSetupMode(false)}
            onChangeAmount={setup.changeAmount}
            onContinue={handleContinueSetup}
            onRemoveCategory={setup.removeCategory}
            saving={setup.saving}
          />
        ) : budgetMode === 'year' ? (
          <QueryGate
            data={yearHistory ?? undefined}
            empty={false}
            emptyTitle="No budgets yet"
            error={yearHistoryError}
            errorPrefix="Could not load budget history"
            fetching={yearHistoryFetching}
            loadingLabel="Loading budget history"
            onRetry={() => reexecuteYearHistory({ requestPolicy: 'network-only' })}
          >
            {yearHistory ? <BudgetYearView categoryGroups={budgetGroups} history={yearHistory.items} year={year} /> : null}
          </QueryGate>
        ) : (
          <QueryGate
            data={report ?? undefined}
            empty={false}
            emptyTitle="No budget"
            error={error}
            errorPrefix="Could not load budget"
            fetching={fetching}
            loadingLabel="Loading budget"
            onRetry={() => reexecuteQuery({ requestPolicy: 'network-only' })}
          >
            {report ? (
              <>
                <BudgetTotals report={report} />
                <BudgetSectionList
                  categoryGroups={budgetGroups}
                  editable={canWriteBudgets}
                  monthKey={monthKey}
                  onSaveLine={handleSaveLine}
                  report={report}
                  savingCategoryId={setBudgetState.fetching ? savingCategoryId : null}
                />
              </>
            ) : null}
          </QueryGate>
        )}
      </QueryGate>
    </div>
  )
}
