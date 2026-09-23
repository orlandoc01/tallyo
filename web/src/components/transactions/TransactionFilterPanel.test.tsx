import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { accounts, categories, categoryGroups, normalizeAccountForGraphql, owners, tags } from '../../mocks/fixtures'
import { captureMutation } from '../../test/msw'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import type { TransactionsFilter, TransactionSort } from '../../types/graphql'
import { localDateRangeToUtcDateTimeRange } from '../../utils/dates'
import { TransactionFilterPanel } from './TransactionFilterPanel'
import { TransactionsMobileFilters } from './TransactionsMobileFilters'

const mockAuth = vi.hoisted(() => ({ hideOwners: false }))

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => mockAuth,
}))

afterEach(() => {
  mockAuth.hideOwners = false
})

const now = new Date(2026, 8, 20, 12)
const dateSort: TransactionSort = { field: 'DATE', direction: 'DESC' }

function renderPanel(filter: TransactionsFilter = {}, overrides: Partial<Parameters<typeof TransactionFilterPanel>[0]> = {}) {
  const onChange = vi.fn()
  const onClear = vi.fn()
  const onSortChange = vi.fn()
  const view = (nextFilter: TransactionsFilter) => (
    <TransactionFilterPanel accounts={accounts} categoryGroups={categoryGroups} clearable filter={nextFilter} now={now} onChange={onChange} onClear={onClear} onRuleCreated={vi.fn()} onSortChange={onSortChange} owners={owners} sort={dateSort} tags={tags} {...overrides} />
  )
  const { rerender } = render(view(filter), { wrapper: GraphqlTestProvider })
  return { onChange, onClear, onSortChange, rerender: (nextFilter: TransactionsFilter) => rerender(view(nextFilter)) }
}

describe('TransactionFilterPanel', () => {
  it('writes date presets and custom ranges', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPanel()

    await user.click(screen.getByRole('button', { name: /^date/i }))
    await user.click(screen.getByRole('radio', { name: /last month/i }))
    expect(onChange).toHaveBeenLastCalledWith({ datetimeRange: localDateRangeToUtcDateTimeRange('2026-08-01', '2026-08-31') })
    expect(screen.queryByRole('radio', { name: /last month/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^date/i }))
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: '2026-05-01' } })
    expect(onChange).toHaveBeenLastCalledWith({ datetimeRange: localDateRangeToUtcDateTimeRange('2026-05-01', undefined) })
  })

  it('updates category, account, owner and tag selections', async () => {
    const user = userEvent.setup()
    const { onChange, rerender } = renderPanel()

    await user.click(screen.getByRole('button', { name: /^category/i }))
    await user.type(screen.getByLabelText(/category search/i), 'bars')
    expect(screen.queryByRole('checkbox', { name: 'Groceries' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Restaurants & Bars' }))
    expect(onChange).toHaveBeenLastCalledWith({ categoryIds: [categories[1].id] })

    rerender({ categoryIds: [categories[1].id] })
    expect(screen.getByRole('button', { name: 'Category Restaurants & Bars' })).toHaveClass('border-brand-600')
    await user.click(screen.getByRole('checkbox', { name: 'Food' }))
    expect([...onChange.mock.lastCall![0].categoryIds].sort()).toEqual(categoryGroups[0].categories.map((category) => category.id).sort())

    await user.click(screen.getByRole('button', { name: /^account/i }))
    await user.click(screen.getByRole('checkbox', { name: 'Checking (...9625)' }))
    expect(onChange).toHaveBeenLastCalledWith({ categoryIds: [categories[1].id], accountIds: [accounts[0].id] })
    expect(screen.queryByRole('checkbox', { name: /secret fund/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^owner/i }))
    await user.click(screen.getByRole('checkbox', { name: 'sam' }))
    expect(onChange).toHaveBeenLastCalledWith({ categoryIds: [categories[1].id], ownerIds: ['owner-2'] })

    await user.click(screen.getByRole('button', { name: /^tags/i }))
    await user.click(screen.getByRole('checkbox', { name: 'Untagged' }))
    expect(onChange).toHaveBeenLastCalledWith({ categoryIds: [categories[1].id], untagged: true, tagIds: undefined })
    await user.click(screen.getByRole('checkbox', { name: tags[0].name }))
    expect(onChange).toHaveBeenLastCalledWith({ categoryIds: [categories[1].id], tagIds: [tags[0].id], untagged: undefined })
  })

  it('selects and deselects all categories', async () => {
    const user = userEvent.setup()
    const allCategoryIds = categoryGroups.flatMap((group) => group.categories.map((category) => category.id))
    const { onChange, rerender } = renderPanel()

    await user.click(screen.getByRole('button', { name: /^category/i }))
    await user.click(screen.getByRole('checkbox', { name: 'Select all categories' }))
    expect([...onChange.mock.lastCall![0].categoryIds].sort()).toEqual([...allCategoryIds].sort())

    rerender({ categoryIds: allCategoryIds })
    expect(screen.getByRole('checkbox', { name: 'Select all categories' })).toBeChecked()
    await user.click(screen.getByRole('checkbox', { name: 'Select all categories' }))
    expect(onChange).toHaveBeenLastCalledWith({ categoryIds: undefined })
  })

  it('maps amount inputs, presets and kind radios onto filter fields', async () => {
    const user = userEvent.setup()
    const { onChange, rerender } = renderPanel()

    await user.click(screen.getByRole('button', { name: /^amount/i }))
    await user.type(screen.getByLabelText(/amount min/i), '1')
    expect(onChange).toHaveBeenLastCalledWith({ amountMin: 1, amountMax: undefined, exactAmount: undefined })

    await user.click(screen.getByRole('button', { name: '$50–$500' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ amountMin: 50, amountMax: 500 }))

    await user.click(screen.getByRole('button', { name: 'Income only' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ amountMax: 0 }))

    await user.click(screen.getByRole('radio', { name: 'Expenses' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ excludeIncome: true }))

    rerender({ amountMin: 50, amountMax: 500, excludeIncome: true })
    expect(screen.getByRole('button', { name: 'Amount $50.00–$500.00 · Expenses' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '$50–$500' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('radio', { name: 'Expenses' })).toBeChecked()

    await user.click(screen.getByRole('radio', { name: 'Both' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ amountMin: 50, amountMax: 500, excludeIncome: undefined }))
  })

  it('handles sort, text prefixes, transfers, show hidden and clearing', async () => {
    const user = userEvent.setup()
    const { onChange, onClear, onSortChange } = renderPanel({ isHidden: false })

    await user.click(screen.getByRole('button', { name: /^more/i }))
    await user.click(screen.getByRole('radio', { name: 'Smallest first' }))
    expect(onSortChange).toHaveBeenCalledWith({ field: 'AMOUNT', direction: 'ASC' })

    await user.type(screen.getByPlaceholderText(/merchant name/i), 'T')
    expect(onChange).toHaveBeenLastCalledWith({ isHidden: false, merchantPrefix: 'T' })
    await user.type(screen.getByPlaceholderText(/original name/i), 'T')
    expect(onChange).toHaveBeenLastCalledWith({ isHidden: false, originalPrefix: 'T' })
    await user.click(screen.getByRole('checkbox', { name: 'Exclude transfers' }))
    expect(onChange).toHaveBeenLastCalledWith({ isHidden: false, excludeTransfers: true })

    const toggle = screen.getByRole('switch', { name: /show hidden/i })
    expect(toggle).not.toBeChecked()
    await user.click(toggle)
    expect(onChange).toHaveBeenLastCalledWith({ isHidden: undefined })

    await user.click(screen.getByRole('button', { name: /clear filters/i }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('hides the owner chip when owners are hidden', () => {
    mockAuth.hideOwners = true
    renderPanel()
    expect(screen.queryByRole('button', { name: /^owner/i })).not.toBeInTheDocument()
  })

  it('creates a rule from matching filters', async () => {
    const user = userEvent.setup()
    const onRuleCreated = vi.fn()
    const createRule = captureMutation('CreateRule', {
      createRule: {
        __typename: 'CreateRulePayload',
        retroactivelyUpdated: 2,
        rule: {
          __typename: 'Rule',
          id: '9',
          merchantPattern: 'Target',
          originalPattern: 'TARGET STORE',
          merchantName: null,
          category: categories[0],
          tags: [tags[0], tags[1]],
          shouldHide: null,
          shouldBeRecurring: null,
          accounts: [normalizeAccountForGraphql(accounts[0]), normalizeAccountForGraphql(accounts[1])],
          amountMin: 62.3,
          amountMax: 62.3,
          priority: 10,
          createdAt: '2026-05-21T00:00:00Z',
        },
      },
    })

    renderPanel({ accountIds: [accounts[0].id, accounts[1].id], exactAmount: 62.3, merchantPrefix: 'Target', originalPrefix: 'TARGET STORE' }, { onRuleCreated })

    await user.click(screen.getByRole('button', { name: /create rule/i }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByLabelText(/merchant pattern/i)).toHaveValue('Target')
    expect(within(dialog).getByLabelText(/original name pattern/i)).toHaveValue('TARGET STORE')
    expect(within(dialog).getByLabelText(/amount min/i)).toHaveValue(62.3)
    expect(within(dialog).getByLabelText(/amount max/i)).toHaveValue(62.3)

    await user.click(within(dialog).getByRole('button', { name: /category/i }))
    await user.click(screen.getByRole('button', { name: new RegExp(categories[0].name, 'i') }))
    await user.click(within(dialog).getByRole('checkbox', { name: /work/i }))
    await user.click(within(dialog).getByRole('checkbox', { name: /travel/i }))
    await user.click(within(dialog).getByLabelText(/apply retroactively/i))
    await user.click(within(dialog).getByRole('button', { name: /submit rule/i }))

    await waitFor(() => expect(createRule.variables).toEqual({
      input: {
        merchantPattern: 'Target',
        originalPattern: 'TARGET STORE',
        changes: { categoryId: categories[0].id, tagIds: [tags[0].id, tags[1].id] },
        applyRetroactively: true,
        accountIds: [accounts[0].id, accounts[1].id],
        amountMin: 62.3,
        amountMax: 62.3,
      },
    }))
    await waitFor(() => expect(onRuleCreated).toHaveBeenCalled())
  })

  it('creates a rule without a merchant pattern', async () => {
    const user = userEvent.setup()
    const createRule = captureMutation('CreateRule', {
      createRule: {
        __typename: 'CreateRulePayload',
        retroactivelyUpdated: 0,
        rule: {
          __typename: 'Rule',
          id: '10',
          merchantPattern: null,
          originalPattern: null,
          merchantName: null,
          category: categories[1],
          tags: [],
          shouldHide: null,
          shouldBeRecurring: null,
          accounts: [],
          amountMin: null,
          amountMax: null,
          priority: 10,
          createdAt: '2026-05-21T00:00:00Z',
        },
      },
    })

    renderPanel()

    await user.click(screen.getByRole('button', { name: /create rule/i }))
    const dialog = screen.getByRole('dialog')

    await user.click(within(dialog).getByRole('button', { name: /category/i }))
    await user.click(screen.getByRole('button', { name: new RegExp(categories[1].name, 'i') }))
    await user.click(within(dialog).getByRole('button', { name: /submit rule/i }))

    await waitFor(() => expect(createRule.variables).toEqual({
      input: {
        changes: { categoryId: categories[1].id },
        applyRetroactively: false,
      },
    }))
  })
})

describe('TransactionsMobileFilters', () => {
  it('stages edits until Apply and clears from the header', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    const onClear = vi.fn()

    render(<TransactionsMobileFilters filter={{ isHidden: false }} now={now} onApply={onApply} onClear={onClear} onClose={vi.fn()} onRuleCreated={vi.fn()} sort={dateSort} />, { wrapper: GraphqlTestProvider })

    const dialog = screen.getByRole('dialog', { name: 'Filters' })
    await user.click(within(dialog).getByRole('button', { name: /^date/i }))
    await user.click(within(dialog).getByRole('radio', { name: /this month/i }))
    await user.click(within(dialog).getByRole('button', { name: /^sort/i }))
    await user.click(within(dialog).getByRole('radio', { name: 'Largest first' }))
    await user.click(within(dialog).getByRole('switch', { name: /show hidden/i }))
    expect(onApply).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: /^apply$/i }))
    expect(onApply).toHaveBeenCalledWith({ isHidden: undefined, datetimeRange: localDateRangeToUtcDateTimeRange('2026-09-01', '2026-09-30') }, { field: 'AMOUNT', direction: 'DESC' })

    expect(within(dialog).getByRole('button', { name: 'Create rule' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Clear filters' }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('keeps the sort section open while stepping through the radios with the keyboard', async () => {
    const user = userEvent.setup()
    render(<TransactionsMobileFilters filter={{ isHidden: false }} now={now} onApply={vi.fn()} onClear={vi.fn()} onClose={vi.fn()} onRuleCreated={vi.fn()} sort={dateSort} />, { wrapper: GraphqlTestProvider })

    const dialog = screen.getByRole('dialog', { name: 'Filters' })
    await user.click(within(dialog).getByRole('button', { name: /^sort/i }))
    within(dialog).getByRole('radio', { name: 'Newest first' }).focus()
    await user.keyboard('{ArrowDown}')
    expect(within(dialog).getByRole('radio', { name: 'Oldest first' })).toBeChecked()
    await user.keyboard('{ArrowDown}')
    expect(within(dialog).getByRole('radio', { name: 'Largest first' })).toBeChecked()
    expect(within(dialog).getByRole('radio', { name: 'Largest first' })).toHaveFocus()
  })
})
