import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { graphql, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePermissions } from '../hooks/usePermissions'
import { server } from '../mocks/server'
import { allowAllPermissionResult } from '../test/permissions'
import { mockGraphqlError, mockQuery } from '../test/msw'
import { LocationDisplay, MobileHeaderActionsHost, renderWithProviders } from '../test/renderWithProviders'
import { BudgetPage } from './BudgetPage'

vi.mock('../hooks/usePermissions', async () => (await import('../test/permissions')).allowAllPermissions())

function renderBudgetPage(route = '/budgets/2026-06') {
  return renderWithProviders(
    <Routes>
      <Route element={<BudgetPage />} path="/budgets/:month" />
      <Route element={<div />} path="/transactions" />
    </Routes>,
    {
      initialEntries: [route],
      probes: <><MobileHeaderActionsHost /><LocationDisplay /></>,
      withGraphql: true,
      withMobileHeader: true,
    },
  )
}

function useExistingBudgetHistory(month = '2026-06') {
  mockQuery('BudgetReportHistory', {
    budgetReportHistory: {
      __typename: 'BudgetReportHistory',
      items: [{ __typename: 'BudgetReport', month, expensesBudgeted: 600, expensesActual: 220, incomeBudgeted: 1200, incomeActual: 1200, remainingBudgeted: 600, remainingActual: 980 }],
    },
  })
}

function useSetBudgetMock() {
  const calls: { month: string; categoryId: string; amount: number }[] = []
  server.use(
    graphql.link('/query').mutation<Record<string, unknown>, { input: { month: string; categoryId: string; amount: number } }>('SetBudget', ({ variables: { input } }) => {
      calls.push(input)
      return HttpResponse.json({
        data: {
          setBudget: {
            __typename: 'SetBudgetPayload',
            budget: {
              __typename: 'Budget',
              id: input.categoryId,
              month: input.month,
              amount: input.amount,
              category: { __typename: 'Category', id: input.categoryId, name: 'Utilities', emoji: '💡', groupName: 'Home', groupEmoji: '🏠', kind: 'EXPENSE', sortOrder: 6, plaidPFC2Codes: [] },
            },
          },
        },
      })
    }),
  )
  return calls
}

function useEmptyMonthHistory(months: string[]) {
  mockQuery('BudgetReportHistory', {
    budgetReportHistory: {
      __typename: 'BudgetReportHistory',
      items: months.map((month) => ({ __typename: 'BudgetReport', month, expensesBudgeted: 500, expensesActual: 200, incomeBudgeted: 0, incomeActual: 0, remainingBudgeted: -500, remainingActual: -200 })),
    },
  })
}

const groceries = { __typename: 'Category', id: '1', name: 'Groceries', emoji: '🍏', groupName: 'Food', groupEmoji: '🍽️', kind: 'EXPENSE', sortOrder: 1, plaidPFC2Codes: [] }

function foodReport(month: string, lines: Array<{ category: typeof groceries; budgeted: number; actual: number }>) {
  const budgeted = lines.reduce((sum, line) => sum + line.budgeted, 0)
  const actual = lines.reduce((sum, line) => sum + line.actual, 0)
  return {
    __typename: 'BudgetReport',
    month,
    expensesBudgeted: budgeted,
    expensesActual: actual,
    incomeBudgeted: 0,
    incomeActual: 0,
    remainingBudgeted: -budgeted,
    remainingActual: -actual,
    sections: [{
      __typename: 'BudgetSection',
      label: 'Food',
      budgeted,
      actual,
      remaining: budgeted - actual,
      group: { __typename: 'CategoryGroup', id: '1', name: 'Food', emoji: '🍽️', kind: 'EXPENSE' },
      lines: lines.map((line) => ({ __typename: 'BudgetLine', id: line.category.id, remaining: line.budgeted - line.actual, ...line })),
    }],
  }
}

describe('BudgetPage', () => {
  beforeEach(() => {
    useExistingBudgetHistory()
  })

  afterEach(() => {
    vi.mocked(usePermissions).mockReturnValue(allowAllPermissionResult)
  })

  it('adds a budget for an unbudgeted category through the header modal', async () => {
    const user = userEvent.setup()
    const setBudgetCalls = useSetBudgetMock()

    renderBudgetPage()

    await screen.findByLabelText('Income budget summary')
    await user.click(screen.getAllByRole('button', { name: 'Add budget' })[0])

    const dialog = await screen.findByRole('dialog', { name: 'Add budget' })
    const select = within(dialog).getByRole('combobox', { name: 'Category' })
    expect(within(select).queryByRole('option', { name: /groceries/i })).not.toBeInTheDocument()
    await user.selectOptions(select, '6')
    await user.type(within(dialog).getByLabelText('Amount'), '125')
    await user.click(within(dialog).getByRole('button', { name: 'Save budget' }))

    await waitFor(() => expect(setBudgetCalls).toContainEqual({ month: '2026-06', categoryId: '6', amount: 125 }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add budget' })).not.toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: /review budget targets/i })).not.toBeInTheDocument()
  })

  it('disables Add budget once every category has a budget', async () => {
    const budgetedIds = ['1', '2', '3', '5', '6', '7', '8', '9']
    mockQuery('BudgetReport', {
      budgetReport: foodReport('2026-06', budgetedIds.map((id) => ({ category: { ...groceries, id, name: `Category ${id}` }, budgeted: 10, actual: 1 }))),
    })

    renderBudgetPage()

    await screen.findByLabelText('Income budget summary')
    const addButtons = screen.getAllByRole('button', { name: 'Add budget' })
    expect(addButtons).toHaveLength(2)
    expect(within(screen.getByTestId('mobile-header-actions')).getByRole('button', { name: 'Add budget' })).toBeDisabled()
    for (const button of addButtons) {
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('title', 'Every category already has a budget')
    }
  })

  it('adding a budget to an empty month flips into the month view', async () => {
    const user = userEvent.setup()
    const setBudgetCalls = useSetBudgetMock()
    useEmptyMonthHistory(['2026-05'])

    renderBudgetPage('/budgets/2026-06')

    await screen.findByRole('heading', { name: 'No budget for June 2026' })
    await user.click(screen.getAllByRole('button', { name: 'Add budget' })[0])
    const dialog = await screen.findByRole('dialog', { name: 'Add budget' })
    await user.type(within(dialog).getByLabelText('Amount'), '80')
    await user.click(within(dialog).getByRole('button', { name: 'Save budget' }))

    await waitFor(() => expect(setBudgetCalls).toHaveLength(1))
    expect(setBudgetCalls[0].month).toBe('2026-06')
    expect(await screen.findByLabelText('Income budget summary')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'No budget for June 2026' })).not.toBeInTheDocument()
  })

  it('waits for the previous month report before prefilling wizard drafts', async () => {
    const user = userEvent.setup()
    let releasePrevious = () => {}
    const previousSettled = new Promise<void>((resolve) => { releasePrevious = resolve })
    server.use(
      graphql.link('/query').query<Record<string, unknown>, { input: { month: string } }>('BudgetReport', async ({ variables }) => {
        const month = variables.input.month
        if (month === '2026-05') await previousSettled
        return HttpResponse.json({ data: { budgetReport: foodReport(month, [{ category: groceries, budgeted: 0, actual: 390 }]) } })
      }),
    )
    useEmptyMonthHistory(['2026-05'])

    renderBudgetPage('/budgets/2026-06')

    await user.click(await screen.findByRole('button', { name: 'Set up manually' }))
    expect(await screen.findByRole('heading', { name: /review budget targets/i })).toBeInTheDocument()
    expect(screen.queryByLabelText('Budget amount for Groceries')).not.toBeInTheDocument()

    releasePrevious()

    expect(await screen.findByLabelText('Budget amount for Groceries')).toHaveValue('390.00')
    expect(screen.getByText('Last month: $390.00')).toBeInTheDocument()
  })

  it('opens the add-budget modal from the mobile header action', async () => {
    const user = userEvent.setup()

    renderBudgetPage()

    await screen.findByLabelText('Income budget summary')
    await user.click(within(screen.getByTestId('mobile-header-actions')).getByRole('button', { name: 'Add budget' }))

    expect(await screen.findByRole('dialog', { name: 'Add budget' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add budget' })).not.toBeInTheDocument())
  })

  it('hides every write affordance without budget write access', async () => {
    vi.mocked(usePermissions).mockReturnValue({ canRead: () => true, canWrite: () => false, hasScope: () => true })
    useEmptyMonthHistory(['2026-05'])

    renderBudgetPage('/budgets/2026-06')

    expect(await screen.findByLabelText('Income budget summary')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add budget' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit budget for Groceries' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /copy from/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Set up manually' })).not.toBeInTheDocument()
    expect(screen.getByText('$460.00')).toBeInTheDocument()
  })

  it('copies from the only budgeted month without a month picker', async () => {
    const user = userEvent.setup()
    const copyCalls: { fromMonth: string; toMonth: string }[] = []
    server.use(
      graphql.link('/query').mutation<Record<string, unknown>, { input: { fromMonth: string; toMonth: string } }>('CopyBudgets', ({ variables }) => {
        copyCalls.push(variables.input)
        return HttpResponse.json({ data: { copyBudgets: { __typename: 'CopyBudgetsPayload', copiedCount: 3 } } })
      }),
    )
    useEmptyMonthHistory(['2026-05'])

    renderBudgetPage('/budgets/2026-06')

    await user.click(await screen.findByRole('button', { name: 'Copy from May 2026' }))
    expect(screen.queryByRole('combobox', { name: 'Month to copy from' })).not.toBeInTheDocument()
    await waitFor(() => expect(copyCalls).toEqual([{ fromMonth: '2026-05', toMonth: '2026-06' }]))
  })

  it('cancels the setup wizard back to the empty-month state', async () => {
    const user = userEvent.setup()
    useEmptyMonthHistory(['2026-05'])

    renderBudgetPage('/budgets/2026-06')

    await user.click(await screen.findByRole('button', { name: 'Set up manually' }))
    expect(await screen.findByRole('heading', { name: /review budget targets/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('heading', { name: 'No budget for June 2026' })).toBeInTheDocument()
  })

  it('renders sections, lines, and totals from the report', async () => {
    renderBudgetPage()

    expect(await screen.findByLabelText('Income budget summary')).toBeInTheDocument()
    expect(await screen.findByText('Food')).toBeInTheDocument()
    expect(await screen.findByText('Groceries')).toBeInTheDocument()
    expect(await screen.findByText('Restaurants & Bars')).toBeInTheDocument()
    // Total budgeted shown in the totals card; same value also rolls up to the Food section.
    const totalCells = await screen.findAllByText('$780.00')
    expect(totalCells.length).toBeGreaterThanOrEqual(1)
  })

  it('links category budget bars to transactions filtered for the budget month', async () => {
    const user = userEvent.setup()
    renderBudgetPage('/budgets/2026-06')

    const link = await screen.findByRole('link', { name: 'View Groceries transactions for this month' })
    expect(link).toHaveAttribute('href', '/transactions?category_ids=1&start_date=2026-06-01&end_date=2026-06-30')

    await user.click(link)

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/transactions?category_ids=1&start_date=2026-06-01&end_date=2026-06-30'))
  })

  it('renders high-level summary progress bars in income, expenses, net order', async () => {
    renderBudgetPage()

    const incomeSummary = await screen.findByLabelText('Income budget summary')
    const expensesSummary = await screen.findByLabelText('Expenses budget summary')
    const netSummary = await screen.findByLabelText('Net budget summary')
    const incomeProgress = await screen.findByRole('progressbar', { name: 'Income progress' })
    const expensesProgress = await screen.findByRole('progressbar', { name: 'Expenses progress' })
    const netProgress = await screen.findByRole('progressbar', { name: 'Net progress' })

    expect(within(incomeSummary).getByText('$1,680.00').compareDocumentPosition(within(incomeSummary).getByText('$1,600.00'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(within(expensesSummary).getByText('$640.00').compareDocumentPosition(within(expensesSummary).getByText('$780.00'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(within(netSummary).getByText('$1,040.00').compareDocumentPosition(within(netSummary).getByText('$820.00'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(incomeProgress).toHaveAttribute('aria-valuenow', '100')
    expect(expensesProgress).toHaveAttribute('aria-valuenow', '82')
    expect(netProgress).toHaveAttribute('aria-valuenow', '100')
    expect(incomeProgress.compareDocumentPosition(expensesProgress)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(expensesProgress.compareDocumentPosition(netProgress)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(within(incomeSummary).getByText('105% of plan')).toBeInTheDocument()
    expect(within(expensesSummary).getByText('82% of plan')).toBeInTheDocument()
    expect(within(netSummary).getByText('127% of plan')).toBeInTheDocument()
    expect(screen.getByText('85%')).toBeInTheDocument()
    expect(screen.getByText('78%')).toBeInTheDocument()
  })

  it('navigates months with the stepper', async () => {
    const user = userEvent.setup()
    const seen: string[] = []
    server.use(
      graphql.link('/query').query<Record<string, unknown>, { input: { month: string } }>('BudgetReport', ({ variables }) => {
        const month = variables.input.month
        seen.push(month)
        return HttpResponse.json({
          data: {
            budgetReport: {
              __typename: 'BudgetReport',
              month,
              expensesBudgeted: 0,
              expensesActual: 0,
              incomeBudgeted: 0,
              incomeActual: 0,
              remainingBudgeted: 0,
              remainingActual: 0,
              sections: [],
            },
          },
        })
      }),
    )

    renderBudgetPage()

    await screen.findByLabelText('Income budget summary')
    await waitFor(() => expect(seen.length).toBeGreaterThan(0))
    const initialMonth = seen[0]
    seen.length = 0

    await user.click(screen.getByRole('button', { name: /previous month/i }))
    await waitFor(() => expect(seen.length).toBeGreaterThan(0))
    expect(seen[seen.length - 1]).not.toBe(initialMonth)
  })

  it('renders a horizontally scrollable yearly category breakdown', async () => {
    const historyInputs: unknown[] = []
    server.use(
      graphql.link('/query').query<Record<string, unknown>, { input: { startMonth: string; endMonth: string } }>('BudgetReportHistoryWithSections', ({ variables }) => {
        historyInputs.push(variables.input)
        return HttpResponse.json({
        data: {
          budgetReportHistory: {
            __typename: 'BudgetReportHistory',
            items: [{
              __typename: 'BudgetReport',
              month: '2026-06',
              expensesBudgeted: 600,
              expensesActual: 220,
              incomeBudgeted: 1200,
              incomeActual: 1200,
              remainingBudgeted: 600,
              remainingActual: 980,
              sections: [{
                __typename: 'BudgetSection',
                label: 'Food',
                budgeted: 600,
                actual: 220,
                remaining: 380,
                group: { __typename: 'CategoryGroup', id: '1', name: 'Food', emoji: '🍽️', kind: 'EXPENSE' },
                lines: [{
                  __typename: 'BudgetLine',
                  id: '1',
                  budgeted: 600,
                  actual: 220,
                  remaining: 380,
                  category: { __typename: 'Category', id: '1', name: 'Groceries', emoji: '🍏', groupName: 'Food', groupEmoji: '🍽️', kind: 'EXPENSE', sortOrder: 1, plaidPFC2Codes: [] },
                }],
              }],
            }],
          },
        },
        })
      }),
    )

    renderBudgetPage('/budgets/2026')

    expect(await screen.findByRole('heading', { name: /2026 budget breakdown/i })).toBeInTheDocument()
    await waitFor(() => expect(historyInputs).toContainEqual({ startMonth: '2026-01', endMonth: '2027-01' }))
    expect(screen.getByRole('columnheader', { name: 'Jun' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Food' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Groceries' })).toBeInTheDocument()
    expect(screen.getByText('Actual $220.00')).toBeInTheDocument()
    expect(screen.getAllByText('-').length).toBeGreaterThan(0)
  })

  it('restores the last month and year when toggling budget views', async () => {
    const user = userEvent.setup()

    renderBudgetPage('/budgets/2026-06')

    await screen.findByLabelText('Income budget summary')
    await user.click(screen.getAllByRole('radio', { name: 'Yearly' })[0])
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/budgets/2026'))

    await user.click(screen.getByRole('button', { name: /next year/i }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/budgets/2027'))

    await user.click(screen.getAllByRole('radio', { name: 'Monthly' })[0])
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/budgets/2026-06'))

    await user.click(screen.getAllByRole('radio', { name: 'Yearly' })[0])
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/budgets/2027'))
  }, 10000)

  it('fires setBudget mutation when the inline editor commits a new amount', async () => {
    const user = userEvent.setup()
    const setBudgetCalls: { month: string; categoryId: string; amount: number }[] = []
    server.use(
      graphql.link('/query').mutation<Record<string, unknown>, { input: { month: string; categoryId: string; amount: number } }>('SetBudget', ({ variables: { input } }) => {
        setBudgetCalls.push(input)
        return HttpResponse.json({
          data: {
            setBudget: {
              __typename: 'SetBudgetPayload',
              budget: {
                __typename: 'Budget',
                id: '1',
                month: input.month,
                amount: input.amount,
                category: { __typename: 'Category', id: '1', name: 'Groceries', emoji: '🍏', groupName: 'Food', groupEmoji: '🍽️', kind: 'EXPENSE', sortOrder: 1, plaidPFC2Codes: [] },
              },
            },
          },
        })
      }),
    )

    renderBudgetPage()

    const editButton = await screen.findByRole('button', { name: 'Edit budget for Groceries' })
    await user.click(editButton)
    const input = await screen.findByLabelText('Budget amount for Groceries') as HTMLInputElement
    await user.clear(input)
    await user.type(input, '525')
    await user.click(document.body)

    await waitFor(() => expect(setBudgetCalls.length).toBeGreaterThan(0))
    const last = setBudgetCalls[setBudgetCalls.length - 1]
    expect(last.amount).toBe(525)
    expect(last.categoryId).toBe('1')
  })

  it('hides copy controls when the routed month already has a budget', async () => {
    renderBudgetPage()

    expect(await screen.findByLabelText('Income budget summary')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /copy month/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /copy from/i })).not.toBeInTheDocument()
  })

  it('shows first-budget setup when there is no budget history', async () => {
    const user = userEvent.setup()
    const setBudgetCalls: { categoryId: string; amount: number }[] = []
    server.use(
      graphql.link('/query').mutation<Record<string, unknown>, { input: { month: string; categoryId: string; amount: number } }>('SetBudget', ({ variables: { input } }) => {
        setBudgetCalls.push(input)
        return HttpResponse.json({
          data: {
            setBudget: {
              __typename: 'SetBudgetPayload',
              budget: {
                __typename: 'Budget',
                id: input.categoryId,
                month: input.month,
                amount: input.amount,
                category: { __typename: 'Category', id: input.categoryId, name: 'Groceries', emoji: '🍏', groupName: 'Food', groupEmoji: '🍽️', kind: 'EXPENSE', sortOrder: 1, plaidPFC2Codes: [] },
              },
            },
          },
        })
      }),
    )
    mockQuery('BudgetReportHistory', { budgetReportHistory: { __typename: 'BudgetReportHistory', items: [] } })

    renderBudgetPage('/budgets/2026-06')

    expect(await screen.findByRole('heading', { name: /set up your first monthly budget/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /copy month/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: /budget view/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /setup budget/i }))

    expect(await screen.findByRole('heading', { name: /review your starting targets/i })).toBeInTheDocument()
    expect(await screen.findByText('Last month: $390.00')).toBeInTheDocument()
    expect(screen.getByLabelText('Budget amount for Groceries')).toHaveValue('390.00')

    await user.click(screen.getByRole('button', { name: /remove restaurants & bars/i }))
    expect(screen.queryByLabelText('Budget amount for Restaurants & Bars')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /add category/i }))
    await user.click(screen.getByRole('button', { name: /restaurants & bars/i }))
    await user.click(screen.getByRole('button', { name: /^add$/i }))
    expect(screen.getByLabelText('Budget amount for Restaurants & Bars')).toHaveValue('250.00')

    await user.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => expect(setBudgetCalls.length).toBeGreaterThan(0))
    expect(setBudgetCalls.some((call) => call.categoryId === '1' && call.amount === 390)).toBe(true)
  })

  it('shows copy/setup options for a routed month without saved budgets when history exists', async () => {
    const user = userEvent.setup()
    const copyCalls: { fromMonth: string; toMonth: string }[] = []
    server.use(
      graphql.link('/query').mutation<Record<string, unknown>, { input: { fromMonth: string; toMonth: string } }>('CopyBudgets', ({ variables }) => {
        copyCalls.push(variables.input)
        return HttpResponse.json({ data: { copyBudgets: { __typename: 'CopyBudgetsPayload', copiedCount: 3 } } })
      }),
    )
    mockQuery('BudgetReportHistory', {
      budgetReportHistory: {
        __typename: 'BudgetReportHistory',
        items: [
          { __typename: 'BudgetReport', month: '2026-04', expensesBudgeted: 400, expensesActual: 100, incomeBudgeted: 0, incomeActual: 0, remainingBudgeted: -400, remainingActual: -100 },
          { __typename: 'BudgetReport', month: '2026-05', expensesBudgeted: 500, expensesActual: 200, incomeBudgeted: 0, incomeActual: 0, remainingBudgeted: -500, remainingActual: -200 },
        ],
      },
    })

    renderBudgetPage('/budgets/2026-06')

    expect(await screen.findByRole('heading', { name: 'No budget for June 2026' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy from May 2026' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set up manually' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /set up your first monthly budget/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Income budget summary')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Expenses budget summary')).not.toBeInTheDocument()

    const select = screen.getByRole('combobox', { name: 'Month to copy from' })
    expect(select).toHaveValue('2026-05')

    await user.click(screen.getByRole('button', { name: 'Copy from May 2026' }))
    await waitFor(() => expect(copyCalls.length).toBeGreaterThan(0))
    expect(copyCalls[0].fromMonth).toBe('2026-05')
    expect(copyCalls[0].toMonth).toBe('2026-06')
  })

  it('shows an error state when the query fails', async () => {
    mockGraphqlError('BudgetReport', 'boom', { status: 500 })

    renderBudgetPage()

    expect(await screen.findByText(/could not load budget/i)).toBeInTheDocument()
  })
})
