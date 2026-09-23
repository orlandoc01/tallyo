import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { accounts, categories, categoryGroups, normalizeAccountForGraphql, owners } from '../../mocks/fixtures'
import { captureMutation } from '../../test/msw'
import { renderWithProviders } from '../../test/renderWithProviders'
import type { TransactionsFilter } from '../../types/graphql'
import { localDateRangeToUtcDateTimeRange } from '../../utils/dates'
import { ExpensesFilterPanel } from './ExpensesFilterPanel'
import { ExpensesMobileFilters } from './ExpensesMobileFilters'

const now = new Date(2026, 8, 20, 12)
const filter: TransactionsFilter = { datetimeRange: localDateRangeToUtcDateTimeRange('2026-05-01', '2026-05-31'), isHidden: false, accountIds: [accounts[0].id], categoryIds: [categories[0].id] }

function createRuleResponse() {
  return captureMutation('CreateRule', {
    createRule: {
      __typename: 'CreateRulePayload',
      retroactivelyUpdated: 0,
      rule: { __typename: 'Rule', id: '9', merchantPattern: null, originalPattern: null, merchantName: null, category: categories[0], tags: [], shouldHide: null, shouldBeRecurring: null, accounts: [normalizeAccountForGraphql(accounts[0])], amountMin: null, amountMax: null, priority: 10, createdAt: '2026-05-21T00:00:00Z' },
    },
  })
}

async function submitPrefilledRule(user: ReturnType<typeof userEvent.setup>) {
  const dialog = (await screen.findAllByRole('dialog')).at(-1)!
  expect(within(dialog).getAllByRole('checkbox', { name: new RegExp(accounts[0].name) })[0]).toBeChecked()
  await user.click(within(dialog).getByRole('button', { name: /category/i }))
  await user.click(screen.getByRole('button', { name: `${categories[0].emoji} ${categories[0].name}` }))
  await user.click(within(dialog).getByRole('button', { name: /submit rule/i }))
}

describe('Expenses filter create-rule flows', () => {
  it('opens the rule modal prefilled from the desktop panel filter and refetches on create', async () => {
    const user = userEvent.setup()
    const onRuleCreated = vi.fn()
    const createRule = createRuleResponse()
    renderWithProviders(
      <ExpensesFilterPanel accounts={accounts} categoryGroups={categoryGroups} clearable dateFiltered filter={filter} now={now} onChange={vi.fn()} onClear={vi.fn()} onRuleCreated={onRuleCreated} owners={owners} showDate />,
      { auth: {}, withGraphql: true },
    )

    await user.click(screen.getByRole('button', { name: 'Create rule from filters' }))
    await submitPrefilledRule(user)

    await waitFor(() => expect(createRule.variables?.input).toMatchObject({ accountIds: [accounts[0].id], changes: { categoryId: categories[0].id } }))
    await waitFor(() => expect(onRuleCreated).toHaveBeenCalled())
  })

  it('opens the rule modal from the mobile sheet footer and refetches on create', async () => {
    const user = userEvent.setup()
    const onRuleCreated = vi.fn()
    const createRule = createRuleResponse()
    renderWithProviders(
      <ExpensesMobileFilters filter={filter} isDateFiltered={() => true} now={now} onApply={vi.fn()} onClear={vi.fn()} onClose={vi.fn()} onRuleCreated={onRuleCreated} showDate />,
      { auth: {}, withGraphql: true },
    )

    await user.click(screen.getByRole('button', { name: 'Create rule' }))
    await submitPrefilledRule(user)

    await waitFor(() => expect(createRule.variables?.input).toMatchObject({ accountIds: [accounts[0].id] }))
    await waitFor(() => expect(onRuleCreated).toHaveBeenCalled())
  })

  it('omits the Date section from the mobile sheet on Comparison', () => {
    renderWithProviders(
      <ExpensesMobileFilters filter={filter} isDateFiltered={() => false} now={now} onApply={vi.fn()} onClear={vi.fn()} onClose={vi.fn()} onRuleCreated={vi.fn()} showDate={false} />,
      { auth: {}, withGraphql: true },
    )

    expect(screen.queryByRole('button', { name: /^Date/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Category/ })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Show hidden' })).toBeInTheDocument()
  })
})
