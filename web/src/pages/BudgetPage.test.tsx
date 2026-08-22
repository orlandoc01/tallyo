import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { graphql, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../mocks/server'
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

describe('BudgetPage', () => {
  beforeEach(() => {
    useExistingBudgetHistory()
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

    expect(within(incomeSummary).getByText('Planned').compareDocumentPosition(within(incomeSummary).getByText('$1,600.00'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(within(incomeSummary).getByText('Actual').compareDocumentPosition(within(incomeSummary).getByText('$1,680.00'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(within(expensesSummary).getByText('Planned').compareDocumentPosition(within(expensesSummary).getByText('$780.00'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(within(expensesSummary).getByText('Actual').compareDocumentPosition(within(expensesSummary).getByText('$640.00'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(within(netSummary).getByText('Planned').compareDocumentPosition(within(netSummary).getByText('$820.00'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(within(netSummary).getByText('Actual').compareDocumentPosition(within(netSummary).getByText('$1,040.00'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(incomeProgress).toHaveAttribute('aria-valuenow', '100')
    expect(expensesProgress).toHaveAttribute('aria-valuenow', '82')
    expect(netProgress).toHaveAttribute('aria-valuenow', '100')
    expect(incomeProgress.compareDocumentPosition(expensesProgress)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(expensesProgress.compareDocumentPosition(netProgress)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(screen.getAllByText('Planned').length).toBeGreaterThanOrEqual(3)
    expect(screen.getAllByText('Actual').length).toBeGreaterThanOrEqual(3)
    expect(screen.getAllByText('105%').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('127%')).toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: /copy last month/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /copy month/i })).not.toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: /copy last month/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /budget view/i })).not.toBeInTheDocument()

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
        items: [{ __typename: 'BudgetReport', month: '2026-05', expensesBudgeted: 500, expensesActual: 200, incomeBudgeted: 0, incomeActual: 0, remainingBudgeted: -500, remainingActual: -200 }],
      },
    })

    renderBudgetPage('/budgets/2026-06')

    expect(await screen.findByRole('button', { name: /copy month/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^setup$/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /set up your first monthly budget/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Income budget summary')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Expenses budget summary')).not.toBeInTheDocument()

    // month picker defaults to the last budget month (May 2026)
    const select = screen.getByRole('combobox')
    expect(select).toHaveValue('2026-05')

    // copy button calls copyBudgets with the selected source month
    await user.click(screen.getByRole('button', { name: /copy month/i }))
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
