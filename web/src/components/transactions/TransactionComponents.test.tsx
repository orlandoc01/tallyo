import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { graphql, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { accounts, categories, categoryGroups, normalizeAccountForGraphql, normalizeTransactionForGraphql, owners, tags, transactions, uncategorizedCategory } from '../../mocks/fixtures'
import { usePermissions } from '../../hooks/usePermissions'
import { configuration } from '../../mocks/handlers'
import { allowAllPermissionResult } from '../../test/permissions'
import { captureMutation, captureQuery, mockGraphqlError, mockMutation, mockQuery } from '../../test/msw'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import { transactionConnection } from '../../test/transactionConnection'
import type { Account, Transaction, TransactionsFilter } from '../../types/graphql'
import { formatDatetimeAsLocalDate, formatTransactionDatetime } from '../../utils/dates'
import { server } from '../../mocks/server'
import { AccountCheckboxList } from './AccountCheckboxList'
import { BulkEditTransactionsModal } from './BulkEditTransactionsModal'
import { CategoryDropdown } from './CategoryDropdown'
import { CategoryPicker } from './CategoryPicker'
import { CreateTransactionModal } from './CreateTransactionModal'
import { TransactionDetailsPane } from './TransactionDetailsPane'
import { TransactionFilters } from './TransactionFilters'
import { TransactionList } from './TransactionList'
import { UncategorizedQueue } from './UncategorizedQueue'

const mockAuth = vi.hoisted(() => ({ hideOwners: false }))

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => mockAuth,
}))

vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

afterEach(() => {
  vi.mocked(usePermissions).mockReturnValue(allowAllPermissionResult)
  mockAuth.hideOwners = false
})

function makeCloudflareReviewTransaction(): Transaction {
  return {
    ...normalizeTransactionForGraphql(transactions[0]),
    id: 'txn-cloudflare',
    merchantName: 'Cloudflare',
    originalName: 'CLOUDFLARE',
    category: uncategorizedCategory,
    isReviewed: false,
  }
}

function renderTransactionFilters(filter: TransactionsFilter = {}) {
  const onChange = vi.fn()
  const view = (nextFilter: TransactionsFilter) => (
    <TransactionFilters accounts={accounts} categoryGroups={categoryGroups} filter={nextFilter} onChange={onChange} owners={owners} />
  )
  const { rerender } = render(view(filter))
  return { onChange, rerenderFilters: (nextFilter: TransactionsFilter) => rerender(view(nextFilter)) }
}

function renderReviewQueue() {
  const cloudflareTransaction = makeCloudflareReviewTransaction()
  let queueIsEmpty = false
  const transactionsQuery = captureQuery('Transactions', () => ({
    transactions: transactionConnection(queueIsEmpty ? [] : [cloudflareTransaction]),
  }))
  const updateTransaction = captureMutation('UpdateTransaction', {
    updateTransaction: {
      __typename: 'UpdateTransactionPayload',
      transaction: normalizeTransactionForGraphql({ ...cloudflareTransaction, category: categories[0], isReviewed: true }),
    },
  })
  render(<UncategorizedQueue />, { wrapper: GraphqlTestProvider })
  return { cloudflareTransaction, emptyQueue: () => { queueIsEmpty = true }, transactionsQuery, updateTransaction }
}

describe('transaction components', () => {
  it('filters and selects categories', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(<CategoryPicker categories={categories} onSelect={onSelect} />)

    await user.type(screen.getByPlaceholderText(/search categories/i), 'groc')
    await user.click(screen.getByRole('button', { name: /groceries/i }))

    expect(screen.queryByRole('button', { name: /restaurants/i })).not.toBeInTheDocument()
    expect(onSelect).toHaveBeenCalledWith(categories[0])
  })

  it('submits the first visible category with Enter while searching', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(<CategoryPicker categories={categories} onSelect={onSelect} />)

    await user.type(screen.getByPlaceholderText(/search categories/i), 'bars{Enter}')

    expect(onSelect).toHaveBeenCalledWith(categories[1])
  })

  it('updates transaction filters and clears them', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const onSortChange = vi.fn()

    render(
      <TransactionFilters
        accounts={accounts}
        categoryGroups={categoryGroups}
        filter={{}}
        onChange={onChange}
        onSortChange={onSortChange}
        owners={owners}
        sort={{ field: 'DATE', direction: 'DESC' }}
      />,
    )

    await user.selectOptions(screen.getByLabelText(/sort/i), 'AMOUNT:ASC')
    expect(onSortChange).toHaveBeenCalledWith({ field: 'AMOUNT', direction: 'ASC' })

    await user.click(screen.getByRole('button', { name: 'Text' }))
    await user.click(screen.getByRole('button', { name: 'Amount' }))
    await user.click(screen.getByRole('button', { name: 'Date range' }))
    await user.click(screen.getByRole('button', { name: 'Owner' }))
    await user.click(screen.getByRole('button', { name: 'Accounts' }))
    await user.click(screen.getByRole('button', { name: 'Categories' }))

    await user.type(screen.getByPlaceholderText(/merchant name/i), 'Target')
    expect(onChange).toHaveBeenCalledWith({ merchantPrefix: 'T' })

    await user.type(screen.getByPlaceholderText(/original name/i), 'TARGET')
    expect(onChange).toHaveBeenCalledWith({ originalPrefix: 'T' })

    await user.type(screen.getByLabelText(/amount min/i), '10')
    expect(onChange).toHaveBeenCalledWith({ amountMin: 1 })

    await user.type(screen.getByLabelText(/amount max/i), '100')
    expect(onChange).toHaveBeenCalledWith({ amountMax: 1 })

    await user.type(screen.getByLabelText(/exact amount/i), '62.3')
    expect(onChange).toHaveBeenCalledWith({ exactAmount: 6 })

    fireEvent.change(screen.getByLabelText(/start date/i, { selector: 'input' }), { target: { value: '2026-05-01' } })
    expect(onChange).toHaveBeenCalledWith({ datetimeRange: { from: new Date(2026, 4, 1).toISOString(), to: undefined } })

    fireEvent.change(screen.getByLabelText(/end date/i, { selector: 'input' }), { target: { value: '2026-05-31' } })
    expect(onChange).toHaveBeenCalledWith({ datetimeRange: { from: undefined, to: new Date(2026, 5, 1).toISOString() } })

    await user.click(screen.getByRole('checkbox', { name: 'sam' }))
    expect(onChange).toHaveBeenCalledWith({ ownerIds: ['owner-2'] })

    await user.click(screen.getByLabelText('Checking (...9625)'))
    expect(onChange).toHaveBeenCalledWith({ accountIds: [accounts[0].id] })

    await user.click(screen.getByLabelText(/groceries/i))
    expect(onChange).toHaveBeenCalledWith({ categoryIds: [categories[0].id] })

    await user.click(screen.getByRole('button', { name: /clear filters/i }))
    expect(onChange).toHaveBeenCalledWith({ isHidden: false })
  })

  it('hides owner filter options when owners are hidden', () => {
    mockAuth.hideOwners = true

    render(
      <TransactionFilters
        accounts={accounts}
        categoryGroups={categoryGroups}
        filter={{}}
        onChange={() => {}}
        owners={owners}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Owner' })).not.toBeInTheDocument()
  })

  it('shows compact transaction date range pills that open date pickers', () => {
    render(
      <TransactionFilters
        accounts={accounts}
        categoryGroups={categoryGroups}
        filter={{
          datetimeRange: {
            from: new Date(2026, 4, 1).toISOString(),
            to: new Date(2026, 5, 1).toISOString(),
          },
        }}
        onChange={() => {}}
        owners={owners}
      />,
    )

    expect(screen.getByText('05-01-26')).toBeInTheDocument()
    expect(screen.getByText('05-31-26')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open start date picker/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open end date picker/i })).toBeInTheDocument()
  })

  it('selects and deselects all categories from transaction filters', async () => {
    const user = userEvent.setup()
    const allCategoryIds = categoryGroups.flatMap((group) => group.categories.map((category) => category.id))
    const { onChange, rerenderFilters } = renderTransactionFilters()

    await user.click(screen.getByRole('button', { name: 'Categories' }))
    await user.click(screen.getByLabelText(/select all/i))
    expect(onChange).toHaveBeenCalledWith({ categoryIds: allCategoryIds })

    rerenderFilters({ categoryIds: allCategoryIds })

    await user.click(screen.getByLabelText(/select all/i))
    expect(onChange).toHaveBeenLastCalledWith({ categoryIds: undefined })
  })

  it('toggles transaction filter category groups', async () => {
    const user = userEvent.setup()
    const foodCategoryIds = categoryGroups[0].categories.map((category) => category.id)
    const allCategoryIds = categoryGroups.flatMap((group) => group.categories.map((category) => category.id))
    const nonFoodCategoryIds = allCategoryIds.filter((categoryId) => !foodCategoryIds.includes(categoryId))
    const { onChange, rerenderFilters } = renderTransactionFilters()

    await user.click(screen.getByRole('button', { name: 'Categories' }))
    await user.click(screen.getByLabelText(/Food/i))
    expect(onChange).toHaveBeenCalledWith({ categoryIds: foodCategoryIds })

    rerenderFilters({ categoryIds: allCategoryIds })

    await user.click(screen.getByLabelText(/Food/i))
    expect(onChange).toHaveBeenLastCalledWith({ categoryIds: nonFoodCategoryIds })
  })

  it('filters transaction categories by search without narrowing select-all or group toggles', async () => {
    const user = userEvent.setup()
    const allCategoryIds = categoryGroups.flatMap((group) => group.categories.map((category) => category.id))
    const selectedCategoryId = categories[1].id
    const { onChange } = renderTransactionFilters({ categoryIds: [selectedCategoryId] })

    await user.type(screen.getByLabelText(/category search/i), 'bars')

    expect(screen.getByLabelText(/select all/i)).not.toBeChecked()
    expect(screen.getByLabelText('Food')).not.toBeChecked()
    expect(screen.getByLabelText(/restaurants & bars/i)).toBeChecked()
    expect(screen.queryByLabelText(/groceries/i)).not.toBeInTheDocument()

    await user.click(screen.getByLabelText(/select all/i))
    expect(onChange).toHaveBeenLastCalledWith({
      categoryIds: [selectedCategoryId, ...allCategoryIds.filter((id) => id !== selectedCategoryId)],
    })
  })

  it('selects and deselects all accounts from transaction filters', async () => {
    const user = userEvent.setup()
    const visibleAccountIds = accounts.filter((account) => !account.hidden).map((account) => account.id)
    const { onChange, rerenderFilters } = renderTransactionFilters()

    await user.click(screen.getByRole('button', { name: 'Accounts' }))
    await user.click(screen.getByLabelText(/select all accounts/i))
    expect(onChange).toHaveBeenCalledWith({ accountIds: visibleAccountIds })

    rerenderFilters({ accountIds: visibleAccountIds })

    await user.click(screen.getByLabelText(/select all accounts/i))
    expect(onChange).toHaveBeenLastCalledWith({ accountIds: undefined })
  })

  it('filters transaction accounts by search without narrowing select-all', async () => {
    const user = userEvent.setup()
    const visibleAccountIds = accounts.filter((account) => !account.hidden).map((account) => account.id)
    const vacationSavings = accounts.find((account) => account.name === 'Vacation Savings')
    if (!vacationSavings) throw new Error('Vacation Savings fixture missing')
    const { onChange } = renderTransactionFilters({ accountIds: [accounts[0].id] })

    await user.type(screen.getByLabelText(/account search/i), 'vacation')

    expect(screen.getByLabelText('Vacation Savings (...2007)')).not.toBeChecked()
    expect(screen.queryByLabelText('Checking (...9625)')).not.toBeInTheDocument()

    await user.click(screen.getByLabelText(/select all accounts/i))
    expect(onChange).toHaveBeenLastCalledWith({
      accountIds: [accounts[0].id, ...visibleAccountIds.filter((id) => id !== accounts[0].id)],
    })
  })

  it('filters account groups by search without narrowing group toggles', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const americanExpressAccountIds = accounts
      .filter((account) => !account.hidden && account.connection?.name === 'American Express')
      .map((account) => account.id)

    render(
      <AccountCheckboxList
        accounts={accounts}
        enableGroupToggle
        selectedAccountIds={[accounts[0].id]}
        onChange={onChange}
      />,
    )

    await user.type(screen.getByLabelText(/account search/i), 'checking')

    expect(screen.getByLabelText('American Express')).not.toBeChecked()
    expect(screen.getByLabelText('Checking (...9625)')).toBeChecked()
    expect(screen.queryByLabelText('Savings (...1234) (CLOSED)')).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('American Express'))
    expect(onChange).toHaveBeenLastCalledWith(americanExpressAccountIds)
  })

  it('toggles include hidden and resets it when clearing filters', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <TransactionFilters
        accounts={accounts}
        categoryGroups={categoryGroups}
        filter={{ isHidden: false }}
        onChange={onChange}
        owners={owners}
        sort={{ field: 'DATE', direction: 'DESC' }}
      />,
    )

    const toggle = screen.getByRole('switch', { name: /include hidden/i })
    expect(toggle).not.toBeChecked()

    await user.click(toggle)
    expect(onChange).toHaveBeenCalledWith({ isHidden: undefined })

    await user.click(screen.getByRole('button', { name: /clear filters/i }))
    expect(onChange).toHaveBeenLastCalledWith({ isHidden: false })
  })

  it('hides hidden accounts and shows (CLOSED) label on closed accounts in filter', async () => {
    const user = userEvent.setup()
    render(
      <TransactionFilters
        accounts={accounts}
        categoryGroups={categoryGroups}
        filter={{}}
        onChange={vi.fn()}
        onSortChange={vi.fn()}
        owners={owners}
        sort={{ field: 'DATE', direction: 'DESC' }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Accounts' }))
    expect(screen.getByText('American Express')).toBeInTheDocument()
    expect(screen.getByText('Chase')).toBeInTheDocument()
    expect(screen.getByText('Fidelity')).toBeInTheDocument()
    expect(screen.getByText('Capital One')).toBeInTheDocument()
    expect(screen.getByLabelText('Checking (...9625)')).toBeInTheDocument()
    expect(screen.getByLabelText('Savings (...1234) (CLOSED)')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Secret Fund/)).not.toBeInTheDocument()
  })

  it('puts manual institution accounts at the bottom of account selectors', () => {
    const manualAccount: Account = {
      ...accounts[0],
      id: 'manual-cash',
      name: 'Cash Wallet',
      mask: null,
      connection: null,
      manual: true,
    }

    render(
      <AccountCheckboxList
        accounts={[manualAccount, accounts[0], accounts[1]]}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getAllByText(/American Express|Manual/).map((node) => node.textContent)).toEqual(['American Express', 'Manual'])
  })

  it('handles connected accounts when provider details are not loaded', () => {
    const accountWithoutProvider: Account = {
      ...accounts[0],
      connection: {
        id: 'conn-without-provider',
        name: 'Connected accounts',
        owner: { id: 'owner-1', name: 'alex' },
        isActive: true,
        provider: { __typename: 'EVMWallet', address: '0x0', chainIds: ['eth'] },
      },
    }

    render(
      <AccountCheckboxList
        accounts={[accountWithoutProvider]}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByText('Connected accounts')).toBeInTheDocument()
    expect(screen.getByLabelText('Checking (...9625)')).toBeInTheDocument()
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

    render(
      <TransactionFilters
        accounts={accounts}
        categoryGroups={categoryGroups}
        filter={{ accountIds: [accounts[0].id, accounts[1].id], exactAmount: 62.3, merchantPrefix: 'Target', originalPrefix: 'TARGET STORE' }}
        onChange={vi.fn()}
        onRuleCreated={onRuleCreated}
        owners={owners}
      />,
      { wrapper: GraphqlTestProvider },
    )

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

    render(
      <TransactionFilters
        accounts={accounts}
        categoryGroups={categoryGroups}
        filter={{}}
        onChange={vi.fn()}
        owners={owners}
      />,
      { wrapper: GraphqlTestProvider },
    )

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

  it('renders grouped transactions with day totals', () => {
    render(<TransactionList transactions={transactions} />, { wrapper: GraphqlTestProvider })

    // Both desktop table and mobile list render the same data (CSS controls visibility)
    expect(screen.getAllByText(formatDatetimeAsLocalDate(transactions[0].datetime))[0]).toBeInTheDocument()
    expect(screen.getAllByText('Target')).toHaveLength(4) // 2 desktop rows + 2 mobile rows
    expect(screen.getAllByText('$10.18')[0]).toBeInTheDocument()
    // Hidden badge appears for the hidden transaction in both views
    expect(screen.getAllByText('Hidden')).toHaveLength(2)
  })

  it('renders amount-sorted transactions globally without date grouping', () => {
    const mixedTransactions: Transaction[] = [
      { ...transactions[0], id: 'txn-high', amount: 200, datetime: '2026-05-13T00:00:00Z', postedDatetime: '2026-05-13T00:00:00Z', merchantName: 'High' },
      { ...transactions[0], id: 'txn-low', amount: 10, datetime: '2026-05-15T00:00:00Z', postedDatetime: '2026-05-15T00:00:00Z', merchantName: 'Low' },
    ]

    const { container } = render(
      <TransactionList sort={{ field: 'AMOUNT', direction: 'DESC' }} transactions={mixedTransactions} />,
      { wrapper: GraphqlTestProvider },
    )

    const dataRows = container.querySelectorAll('tbody tr')
    expect(dataRows).toHaveLength(2)
    expect(dataRows[0]).toHaveTextContent('High')
    expect(dataRows[0]).toHaveTextContent(formatDatetimeAsLocalDate(mixedTransactions[0].datetime))
    expect(dataRows[1]).toHaveTextContent('Low')
    expect(dataRows[1]).toHaveTextContent(formatDatetimeAsLocalDate(mixedTransactions[1].datetime))

    const dateHeaders = container.querySelectorAll('tbody tr.bg-neutral-100')
    expect(dateHeaders).toHaveLength(0)
  })

  it('renders sort dropdown when onSortChange is provided and calls it on change', async () => {
    const user = userEvent.setup()
    const onSortChange = vi.fn()

    render(
      <TransactionList onSortChange={onSortChange} sort={{ field: 'DATE', direction: 'DESC' }} transactions={transactions} />,
      { wrapper: GraphqlTestProvider },
    )

    const selects = screen.getAllByLabelText(/sort/i)
    expect(selects.length).toBe(2)

    await user.selectOptions(selects[0], 'AMOUNT:ASC')
    expect(onSortChange).toHaveBeenCalledWith({ field: 'AMOUNT', direction: 'ASC' })

    onSortChange.mockClear()
    await user.selectOptions(selects[1], 'AMOUNT:DESC')
    expect(onSortChange).toHaveBeenCalledWith({ field: 'AMOUNT', direction: 'DESC' })
  })

  it('does not render sort dropdown when onSortChange is not provided', () => {
    render(<TransactionList transactions={transactions} />, { wrapper: GraphqlTestProvider })

    expect(screen.queryByLabelText(/sort/i)).not.toBeInTheDocument()
  })

  it('renders the list header and empty state together when there are no transactions', () => {
    render(
      <TransactionList
        emptyState={<div>No transactions found</div>}
        headerActions={<button type="button">Import / Export</button>}
        transactions={[]}
      />,
      { wrapper: GraphqlTestProvider },
    )

    expect(screen.getByRole('heading', { name: 'Transactions' })).toBeInTheDocument()
    expect(screen.getAllByText('No transactions found')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Import / Export' })).toBeInTheDocument()
  })

  it('renders amount-sorted view when sort is AMOUNT:DESC with onSortChange', () => {
    const onSortChange = vi.fn()
    const mixedTransactions: Transaction[] = [
      { ...transactions[0], id: 'txn-high', amount: 200, datetime: '2026-05-13T00:00:00Z', postedDatetime: '2026-05-13T00:00:00Z', merchantName: 'High' },
      { ...transactions[0], id: 'txn-low', amount: 10, datetime: '2026-05-15T00:00:00Z', postedDatetime: '2026-05-15T00:00:00Z', merchantName: 'Low' },
    ]

    const { container } = render(
      <TransactionList onSortChange={onSortChange} sort={{ field: 'AMOUNT', direction: 'DESC' }} transactions={mixedTransactions} />,
      { wrapper: GraphqlTestProvider },
    )

    const selects = screen.getAllByLabelText(/sort/i)
    expect(selects.length).toBeGreaterThanOrEqual(1)
    expect(selects[0]).toHaveValue('AMOUNT:DESC')

    const dateHeaders = container.querySelectorAll('tbody tr.bg-neutral-100')
    expect(dateHeaders).toHaveLength(0)
  })

  it('shows hidden badge for hidden transactions in the list', async () => {
    const user = userEvent.setup()

    mockMutation('UpdateTransaction', { updateTransaction: { __typename: 'UpdateTransactionPayload', transaction: normalizeTransactionForGraphql({ ...transactions[0], isHidden: true }) } })

    render(<TransactionList categories={categories} transactions={transactions} />, { wrapper: GraphqlTestProvider })

    // Initially 2 "Hidden" badges (txn-2 in desktop + mobile)
    expect(screen.getAllByText('Hidden')).toHaveLength(2)

    await user.click(screen.getAllByText('Target')[0])
    await user.click(screen.getAllByRole('switch', { name: 'Hidden' })[0])

    // After hiding txn-1 via modal: 4 list badges (desktop + mobile for two hidden rows) plus the modal toggle label.
    await waitFor(() => expect(screen.getAllByText('Hidden')).toHaveLength(5))
  })

  it('opens the details modal when a row is clicked', async () => {
    const user = userEvent.setup()

    render(<TransactionList categories={categories} transactions={transactions} />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getAllByText('Target')[0])

    expect(screen.getAllByRole('region', { name: /details for target/i })[0]).toBeInTheDocument()
    expect(screen.getAllByText('Merchant')[0]).toBeInTheDocument()
    expect(screen.getAllByText('Target')).toHaveLength(4) // 2 desktop rows + 2 mobile rows
    expect(screen.getAllByLabelText(/notes/i)[0]).toBeInTheDocument()
  })

  it('opens the details pane via keyboard on a mobile transaction row', async () => {
    const user = userEvent.setup()

    render(<TransactionList categories={categories} transactions={transactions} />, { wrapper: GraphqlTestProvider })

    // Mobile rows have role="button" — focus and press Enter
    const mobileRows = screen.getAllByRole('button').filter((el) => el.tagName === 'DIV')
    await user.type(mobileRows[0], '{Enter}')

    expect(screen.getAllByRole('region', { name: /details for target/i })[0]).toBeInTheDocument()
  })

  it('changes category inline in the list without refetching the list', async () => {
    const user = userEvent.setup()
    const reexecuteQuery = vi.fn()
    const updateTransaction = captureMutation('UpdateTransaction', { updateTransaction: { __typename: 'UpdateTransactionPayload', transaction: normalizeTransactionForGraphql({ ...transactions[0], category: categories[1] }) } })

    render(<TransactionList categories={categories} reexecuteQuery={reexecuteQuery} transactions={transactions} />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getAllByRole('button', { name: /groceries/i })[0])
    await user.click(screen.getByRole('button', { name: /restaurants/i }))

    await waitFor(() => expect(updateTransaction.variables).toEqual({ input: { id: 'txn-1', updates: { categoryId: '2' } } }))
    await waitFor(() => expect(screen.getAllByText('Restaurants & Bars')).toHaveLength(1))
    expect(reexecuteQuery).not.toHaveBeenCalled()
  })

  it('changes category from the mobile category icon without opening details', async () => {
    const user = userEvent.setup()
    const onCategoryUpdated = vi.fn()
    const reexecuteQuery = vi.fn()
    const updateTransaction = captureMutation('UpdateTransaction', { updateTransaction: { __typename: 'UpdateTransactionPayload', transaction: normalizeTransactionForGraphql({ ...transactions[0], category: categories[1] }) } })

    render(
      <TransactionList
        categories={categories}
        onCategoryUpdated={onCategoryUpdated}
        reexecuteQuery={reexecuteQuery}
        transactions={transactions}
      />,
      { wrapper: GraphqlTestProvider },
    )

    await user.click(screen.getAllByRole('button', { name: /change category for target/i })[0])
    const restaurantOption = screen.getAllByRole('button', { name: /restaurants/i }).find((element) => element.tagName === 'BUTTON')
    expect(restaurantOption).toBeDefined()
    await user.click(restaurantOption!)

    await waitFor(() => expect(updateTransaction.variables).toEqual({ input: { id: 'txn-1', updates: { categoryId: '2' } } }))
    await waitFor(() => expect(screen.getAllByText('Restaurants & Bars')).toHaveLength(1))
    expect(reexecuteQuery).not.toHaveBeenCalled()
    expect(onCategoryUpdated).toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: /details for target/i })).not.toBeInTheDocument()
  })

  it('deletes a transaction from the details pane without refetching the list', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const reexecuteQuery = vi.fn()

    mockMutation('DeleteTransaction', { deleteTransaction: { __typename: 'DeleteTransactionPayload', success: true } })

    render(<TransactionList categories={categories} reexecuteQuery={reexecuteQuery} transactions={transactions} />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getAllByText('Target')[0])
    await user.click(screen.getAllByRole('button', { name: /delete transaction/i })[0])

    await waitFor(() => expect(screen.queryByText('$62.30')).not.toBeInTheDocument())
    expect(screen.queryByRole('region', { name: /details for target/i })).not.toBeInTheDocument()
    expect(reexecuteQuery).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  it('opens details and categorizes transactions in the review queue', async () => {
    const user = userEvent.setup()
    const { cloudflareTransaction, updateTransaction } = renderReviewQueue()

    expect(await screen.findAllByText('Cloudflare')).toHaveLength(2)

    await user.click(screen.getAllByText('Cloudflare')[0])
    expect((await screen.findAllByRole('region', { name: /details for cloudflare/i }))[0]).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: /close details for cloudflare/i })[0])
    await user.click(screen.getAllByRole('button', { name: /groceries/i })[0])

    await waitFor(() => expect(updateTransaction.variables).toEqual({ input: { id: cloudflareTransaction.id, updates: { categoryId: categories[0].id } } }))
  })

  it('disables reprocessing and links to settings when LLM categorization is disabled', async () => {
    mockQuery('Configuration', {
      configuration: {
        ...configuration,
        llmCategorization: { ...configuration.llmCategorization, enabled: false },
      },
    })
    renderReviewQueue()

    expect(await screen.findByRole('button', { name: 'Reprocess All' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reprocess All' })).toHaveAttribute('title', 'LLM Categorization must be enabled in AI settings')
    expect(screen.getByRole('link', { name: 'Open LLM categorization settings' })).toHaveAttribute('href', '/settings/ai-integration')
  })

  it('does not focus a category picker when the review queue loads', async () => {
    renderReviewQueue()

    await screen.findAllByText('Cloudflare')
    expect(screen.getByPlaceholderText('Search categories...')).not.toHaveFocus()
  })

  it('reprocesses the queue when LLM categorization is enabled', async () => {
    const user = userEvent.setup()
    const { emptyQueue, transactionsQuery } = renderReviewQueue()
    const reprocess = captureMutation('ReprocessUncategorizedTransactions', {
      reprocessUncategorizedTransactions: { __typename: 'ReprocessUncategorizedTransactionsPayload', stagedCount: 1 },
    })

    const button = await screen.findByRole('button', { name: 'Reprocess All' })
    expect(button).toBeEnabled()
    expect(screen.getByRole('link', { name: 'Open LLM categorization settings' })).toHaveAttribute('href', '/settings/ai-integration')

    emptyQueue()
    await user.click(button)

    await waitFor(() => expect(reprocess.called).toBe(true))
    await waitFor(() => expect(transactionsQuery.calls).toBeGreaterThan(1))
    expect(await screen.findByText('Review queue is clear')).toBeInTheDocument()
    expect(screen.getByText('Sent 1 transaction for categorization')).toBeInTheDocument()
  })

  it('polls and shows the number of transactions being categorized', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval')
    const stagedQuery = captureQuery('TransactionsStagedForCategorization', {
      transactionsStagedForCategorization: { __typename: 'TransactionsStagedForCategorization', count: 2 },
    })
    mockQuery('Transactions', { transactions: transactionConnection([]) })
    render(<UncategorizedQueue />, { wrapper: GraphqlTestProvider })

    const processing = await screen.findByText('Processing 2 Transactions...')
    expect(processing).toHaveAttribute('role', 'status')
    expect(processing).toHaveTextContent('Processing 2 Transactions...')
    expect(processing.compareDocumentPosition(screen.getByRole('button', { name: 'Reprocess All' }))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(screen.getByText('Review queue is clear')).toBeInTheDocument()

    const poll = setIntervalSpy.mock.calls.find(([, delay]) => delay === 10_000)?.[0]
    expect(poll).toBeTypeOf('function')
    act(() => { if (typeof poll === 'function') poll() })
    await waitFor(() => expect(stagedQuery.calls).toBeGreaterThan(1))
    setIntervalSpy.mockRestore()
  })

  it('shows reprocessing errors while the staged queue is empty', async () => {
    const user = userEvent.setup()
    mockQuery('TransactionsStagedForCategorization', {
      transactionsStagedForCategorization: { __typename: 'TransactionsStagedForCategorization', count: 2 },
    })
    mockQuery('Transactions', { transactions: transactionConnection([]) })
    mockGraphqlError('ReprocessUncategorizedTransactions', 'Could not reprocess transactions', { kind: 'mutation' })
    render(<UncategorizedQueue />, { wrapper: GraphqlTestProvider })

    await user.click(await screen.findByRole('button', { name: 'Reprocess All' }))

    expect(await screen.findByText(/Could not reprocess transactions/)).toBeInTheDocument()
  })

  it('shows a configuration error when LLM status cannot be loaded', async () => {
    mockGraphqlError('Configuration', 'Could not load LLM status')
    renderReviewQueue()

    expect(await screen.findByText(/Could not load LLM status/)).toBeInTheDocument()
  })

  it('hides reprocessing controls without settings read access', async () => {
    vi.mocked(usePermissions).mockReturnValue({
      canRead: (resource) => resource !== 'settings',
      canWrite: () => true,
      hasScope: () => true,
    })
    renderReviewQueue()

    await screen.findAllByText('Cloudflare')
    expect(screen.queryByRole('button', { name: 'Reprocess All' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open LLM categorization settings' })).not.toBeInTheDocument()
  })

  it('hides reprocessing but keeps the settings link when the review queue is empty', async () => {
    mockQuery('Transactions', { transactions: transactionConnection([]) })
    render(<UncategorizedQueue />, { wrapper: GraphqlTestProvider })

    expect(await screen.findByText('Review queue is clear')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reprocess All' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open LLM categorization settings' })).toHaveAttribute('href', '/settings/ai-integration')
    expect(screen.queryByText(/Processing \d+ Transactions/)).not.toBeInTheDocument()
  })

  it('opens the mobile category picker in the review queue', async () => {
    const user = userEvent.setup()
    const { cloudflareTransaction, updateTransaction } = renderReviewQueue()

    await user.click(await screen.findByRole('button', { name: /pick category for cloudflare/i }))
    await user.click(screen.getAllByRole('button', { name: /groceries/i })[0])

    await waitFor(() => expect(updateTransaction.variables).toEqual({ input: { id: cloudflareTransaction.id, updates: { categoryId: categories[0].id } } }))
  })

  it('deletes a transaction from the review queue details pane', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderReviewQueue()
    mockMutation('DeleteTransaction', { deleteTransaction: { __typename: 'DeleteTransactionPayload', success: true } })

    await user.click((await screen.findAllByText('Cloudflare'))[0])
    expect((await screen.findAllByRole('region', { name: /details for cloudflare/i }))[0]).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: /delete transaction/i })[0])

    await waitFor(() => expect(screen.queryByRole('region', { name: /details for cloudflare/i })).not.toBeInTheDocument())
    confirmSpy.mockRestore()
  })
})

describe('TransactionDetailsPane', () => {
  it('renders all transaction fields', () => {
    const onClose = vi.fn()

    render(<TransactionDetailsPane categories={categories} onClose={onClose} transaction={transactions[0]} />, { wrapper: GraphqlTestProvider })

    expect(screen.getByRole('region', { name: /details for target/i })).toBeInTheDocument()
    expect(screen.getByText('Merchant')).toBeInTheDocument()
    expect(screen.getByLabelText(/^merchant name$/i)).toHaveValue('Target')
    expect(screen.getByText('Amount')).toBeInTheDocument()
    expect(screen.getByText('$62.30')).toBeInTheDocument()
    expect(screen.getByText('Authorized')).toBeInTheDocument()
    expect(screen.getByText(formatTransactionDatetime(transactions[0].datetime))).toBeInTheDocument()
    expect(screen.getByText('Account')).toBeInTheDocument()
    expect(screen.getByText('Checking (...9625)')).toBeInTheDocument()
    expect(screen.getByText('Owner')).toBeInTheDocument()
    expect(screen.getByText('alex')).toBeInTheDocument()
    expect(screen.getByText('Category')).toBeInTheDocument()
    expect(screen.getByText('Status')).toBeInTheDocument()
    expect(screen.getByText('Reviewed')).toBeInTheDocument()
    const transactionId = screen.getByText(transactions[0].id)
    expect(transactionId).toHaveClass('truncate')
    expect(transactionId).toHaveAttribute('title', transactions[0].id)
    expect(screen.getByLabelText(/notes/i)).toHaveValue('')
  })

  it('closes when the X button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(<TransactionDetailsPane categories={categories} onClose={onClose} transaction={transactions[0]} />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getByRole('button', { name: /close details/i }))

    expect(onClose).toHaveBeenCalled()
  })

  it('sends updateTransaction when notes are edited and blurred', async () => {
    const user = userEvent.setup()
    const updateTransaction = captureMutation('UpdateTransaction', { updateTransaction: { __typename: 'UpdateTransactionPayload', transaction: normalizeTransactionForGraphql({ ...transactions[0], notes: 'Grocery run' }) } })

    render(<TransactionDetailsPane categories={categories} onClose={vi.fn()} transaction={transactions[0]} />, { wrapper: GraphqlTestProvider })

    const notesField = screen.getByLabelText(/notes/i)
    await user.type(notesField, 'Grocery run')
    fireEvent.blur(notesField)

    await waitFor(() => expect(updateTransaction.variables).toEqual({ input: { id: 'txn-1', updates: { notes: 'Grocery run' } } }))
  })

  it('sends updateTransaction when the merchant name is edited and blurred', async () => {
    const user = userEvent.setup()
    const updateTransaction = captureMutation('UpdateTransaction', { updateTransaction: { __typename: 'UpdateTransactionPayload', transaction: normalizeTransactionForGraphql({ ...transactions[0], merchantName: 'Target Store' }) } })

    render(<TransactionDetailsPane categories={categories} onClose={vi.fn()} transaction={transactions[0]} />, { wrapper: GraphqlTestProvider })

    const merchantField = screen.getByLabelText(/^merchant name$/i)
    await user.clear(merchantField)
    await user.type(merchantField, 'Target Store')
    fireEvent.blur(merchantField)

    await waitFor(() => expect(updateTransaction.variables).toEqual({ input: { id: 'txn-1', updates: { merchantName: 'Target Store' } } }))
  })

  it('sends updateTransaction when the hidden toggle is changed', async () => {
    const user = userEvent.setup()
    const updateTransaction = captureMutation('UpdateTransaction', { updateTransaction: { __typename: 'UpdateTransactionPayload', transaction: normalizeTransactionForGraphql({ ...transactions[0], isHidden: true }) } })

    render(<TransactionDetailsPane categories={categories} onClose={vi.fn()} transaction={transactions[0]} />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getByRole('switch', { name: /hidden/i }))

    await waitFor(() => expect(updateTransaction.variables).toEqual({ input: { id: 'txn-1', updates: { isHidden: true } } }))
  })

  it('keeps merchant, hidden, recurring, and notes immutable without transaction write permission', async () => {
    vi.mocked(usePermissions).mockReturnValue({
      canRead: () => true,
      canWrite: (resource) => resource !== 'transactions',
      hasScope: () => true,
    })
    const user = userEvent.setup()
    const transaction = normalizeTransactionForGraphql({ ...transactions[0], notes: 'Original note' })
    const updateTransaction = captureMutation('UpdateTransaction', { updateTransaction: { __typename: 'UpdateTransactionPayload', transaction } })

    render(<TransactionDetailsPane categories={categories} onClose={vi.fn()} transaction={transaction} />, { wrapper: GraphqlTestProvider })

    expect(screen.getByRole('switch', { name: /hidden/i })).toBeDisabled()
    expect(screen.getByRole('switch', { name: /recurring/i })).toBeDisabled()
    expect(screen.queryByLabelText(/^merchant name$/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/notes/i)).toHaveValue('Original note')
    expect(screen.getByLabelText(/notes/i)).toHaveAttribute('readonly')

    await user.click(screen.getByRole('switch', { name: /hidden/i }))
    await user.click(screen.getByRole('switch', { name: /recurring/i }))
    await user.type(screen.getByLabelText(/notes/i), ' changed')
    fireEvent.blur(screen.getByLabelText(/notes/i))

    expect(screen.getByLabelText(/notes/i)).toHaveValue('Original note')
    expect(updateTransaction.called).toBe(false)
  })

  it('sends updateTransaction when category is changed', async () => {
    const user = userEvent.setup()
    const updateTransaction = captureMutation('UpdateTransaction', { updateTransaction: { __typename: 'UpdateTransactionPayload', transaction: normalizeTransactionForGraphql({ ...transactions[0], category: categories[1] }) } })

    render(<TransactionDetailsPane categories={categories} onClose={vi.fn()} transaction={transactions[0]} />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getByRole('button', { name: /groceries/i }))
    await user.click(screen.getByRole('button', { name: /restaurants/i }))

    await waitFor(() => expect(updateTransaction.variables).toEqual({ input: { id: 'txn-1', updates: { categoryId: '2' } } }))
  })

  it('sends updateTransaction when tags are changed', async () => {
    const user = userEvent.setup()
    const updateTransaction = captureMutation('UpdateTransaction', { updateTransaction: { __typename: 'UpdateTransactionPayload', transaction: normalizeTransactionForGraphql({ ...transactions[0], tags: [tags[0]] }) } })

    render(<TransactionDetailsPane categories={categories} onClose={vi.fn()} transaction={normalizeTransactionForGraphql({ ...transactions[0], tags: [] })} />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getByRole('button', { name: /tags/i }))
    await user.click(await screen.findByRole('button', { name: new RegExp(tags[0].name, 'i') }))

    await waitFor(() => expect(updateTransaction.variables).toEqual({ input: { id: 'txn-1', updates: { tagIds: [tags[0].id] } } }))
  })

  it('bulk edit modal sends only active sections', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(
      <BulkEditTransactionsModal
        categories={categories}
        selectedCount={2}
        tags={tags}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    )

    await user.type(screen.getByPlaceholderText(/replace notes/i), 'Shared memo')
    await user.click(screen.getAllByRole('button', { name: /^yes$/i })[0])
    await user.click(screen.getByRole('button', { name: /confirm/i }))

    expect(onConfirm).toHaveBeenCalledWith({ notes: 'Shared memo', isRecurring: true })
  })

  it('bulk edit modal can be closed from the header', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <BulkEditTransactionsModal
        categories={categories}
        selectedCount={2}
        tags={tags}
        onClose={onClose}
        onConfirm={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /close edit multiple/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes the tag dropdown explicitly, with Escape, and by clicking outside', async () => {
    const user = userEvent.setup()

    render(<TransactionDetailsPane categories={categories} onClose={vi.fn()} transaction={normalizeTransactionForGraphql({ ...transactions[0], tags: [] })} />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getByRole('button', { name: /tags/i }))
    expect(await screen.findByRole('button', { name: new RegExp(tags[0].name, 'i') })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^close$/i }))
    expect(screen.queryByRole('button', { name: new RegExp(tags[0].name, 'i') })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /tags/i }))
    expect(await screen.findByRole('button', { name: new RegExp(tags[0].name, 'i') })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('button', { name: new RegExp(tags[0].name, 'i') })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /tags/i }))
    expect(await screen.findByRole('button', { name: new RegExp(tags[0].name, 'i') })).toBeInTheDocument()

    await user.click(screen.getByText('Merchant'))
    expect(screen.queryByRole('button', { name: new RegExp(tags[0].name, 'i') })).not.toBeInTheDocument()
  })

  it('does not delete when browser confirmation is cancelled', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const deleteTransaction = captureMutation('DeleteTransaction', { deleteTransaction: { __typename: 'DeleteTransactionPayload', success: true } })

    render(<TransactionDetailsPane categories={categories} onClose={vi.fn()} transaction={transactions[0]} />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getByRole('button', { name: /delete transaction/i }))

    expect(confirmSpy).toHaveBeenCalled()
    expect(deleteTransaction.called).toBe(false)
    confirmSpy.mockRestore()
  })

  it('sends deleteTransaction when deletion is confirmed', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onDelete = vi.fn()
    const deleteTransaction = captureMutation('DeleteTransaction', { deleteTransaction: { __typename: 'DeleteTransactionPayload', success: true } })

    render(<TransactionDetailsPane categories={categories} onClose={vi.fn()} onDelete={onDelete} transaction={transactions[0]} />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getByRole('button', { name: /delete transaction/i }))

    await waitFor(() => expect(deleteTransaction.variables).toEqual({ id: 'txn-1' }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('txn-1'))
    confirmSpy.mockRestore()
  })

  it('shows deleteTransaction errors', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    mockGraphqlError('DeleteTransaction', 'delete failed', { kind: 'mutation' })

    render(<TransactionDetailsPane categories={categories} onClose={vi.fn()} transaction={transactions[0]} />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getByRole('button', { name: /delete transaction/i }))

    expect(await screen.findByText(/delete failed/i)).toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  it('shows (CLOSED) label for closed accounts in details pane', () => {
    const closedTransaction = { ...transactions[0], account: accounts[1] }

    render(<TransactionDetailsPane categories={categories} onClose={vi.fn()} transaction={closedTransaction} />, { wrapper: GraphqlTestProvider })

    expect(screen.getByText(/\(CLOSED\)/)).toBeInTheDocument()
  })
})

describe('CreateTransactionModal', () => {
  it('creates a manual transaction and returns the created transaction', async () => {
    const user = userEvent.setup()
    const onCreated = vi.fn()
    const createTransaction = captureMutation('CreateTransaction', {
      createTransaction: {
        __typename: 'CreateTransactionPayload',
        transaction: normalizeTransactionForGraphql({
          ...transactions[0],
          id: 'manual-created',
          amount: 12.34,
          datetime: '2026-05-22T12:00:00Z',
          postedDatetime: '2026-05-22T12:00:00Z',
          merchantName: 'Manual Coffee',
          category: categories[1],
          notes: 'Latte',
        }),
      },
    })

    render(<CreateTransactionModal accounts={accounts} categories={categories} onClose={vi.fn()} onCreated={onCreated} />, { wrapper: GraphqlTestProvider })

    expect(screen.queryByRole('option', { name: /secret fund/i })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-05-22' } })
    await user.type(screen.getByLabelText('Amount'), '12.34')
    await user.type(screen.getByLabelText('Merchant'), 'Manual Coffee')
    await user.selectOptions(screen.getByLabelText('Category'), categories[1].id)
    await user.type(screen.getByLabelText('Notes'), 'Latte')
    await user.click(screen.getByRole('button', { name: 'Create transaction' }))

    await waitFor(() => expect(createTransaction.variables).toEqual({
      input: {
        accountId: accounts[0].id,
        date: '2026-05-22',
        amount: 12.34,
        merchantName: 'Manual Coffee',
        originalName: null,
        categoryId: categories[1].id,
        notes: 'Latte',
        isRecurring: false,
        isHidden: false,
      },
    }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'manual-created' })))
  })

  it('requires a merchant or original name', async () => {
    const user = userEvent.setup()

    render(<CreateTransactionModal accounts={accounts} categories={categories} onClose={vi.fn()} onCreated={vi.fn()} />, { wrapper: GraphqlTestProvider })

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-05-22' } })
    await user.type(screen.getByLabelText('Amount'), '12.34')
    await user.click(screen.getByRole('button', { name: 'Create transaction' }))

    expect(await screen.findByText('Enter a merchant or original name.')).toBeInTheDocument()
  })

  it('shows invalid amount validation', async () => {
    const user = userEvent.setup()

    render(<CreateTransactionModal accounts={accounts} categories={categories} onClose={vi.fn()} onCreated={vi.fn()} />, { wrapper: GraphqlTestProvider })

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-05-22' } })
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: 'Infinity' } })
    await user.type(screen.getByLabelText('Merchant'), 'Manual Coffee')
    await user.click(screen.getByRole('button', { name: 'Create transaction' }))

    expect(await screen.findByText('Enter a valid amount.')).toBeInTheDocument()
  })

  it('submits original-name-only transactions and shows create errors', async () => {
    const user = userEvent.setup()
    const createTransaction = vi.fn()

    server.use(
      graphql.link('/query').mutation('CreateTransaction', ({ variables }) => {
        createTransaction(variables)
        return HttpResponse.json({ errors: [{ message: 'create failed' }] })
      }),
    )

    render(<CreateTransactionModal accounts={accounts} categories={categories} onClose={vi.fn()} onCreated={vi.fn()} />, { wrapper: GraphqlTestProvider })

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-05-22' } })
    await user.type(screen.getByLabelText('Amount'), '12.34')
    await user.type(screen.getByLabelText('Original name'), 'POS COFFEE')
    await user.click(screen.getByRole('switch', { name: 'Hidden' }))
    await user.click(screen.getByRole('switch', { name: 'Recurring' }))
    await user.click(screen.getByRole('button', { name: 'Create transaction' }))

    await waitFor(() => expect(createTransaction).toHaveBeenCalledWith({
      input: {
        accountId: accounts[0].id,
        date: '2026-05-22',
        amount: 12.34,
        merchantName: null,
        originalName: 'POS COFFEE',
        categoryId: null,
        notes: null,
        isRecurring: true,
        isHidden: true,
      },
    }))
    expect(await screen.findByText(/create failed/i)).toBeInTheDocument()
  })
})

describe('CategoryDropdown', () => {
  it('calls onClose when Escape key is pressed while open', () => {
    const onClose = vi.fn()
    const anchorEl = document.createElement('button')
    document.body.appendChild(anchorEl)
    const anchorRef = { current: anchorEl }

    render(
      <CategoryDropdown
        anchorRef={anchorRef}
        categories={categories}
        isOpen
        onClose={onClose}
        onSelect={vi.fn()}
      />,
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()

    document.body.removeChild(anchorEl)
  })

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn()
    const anchorEl = document.createElement('button')
    document.body.appendChild(anchorEl)
    const anchorRef = { current: anchorEl }

    const { container } = render(
      <CategoryDropdown
        anchorRef={anchorRef}
        categories={categories}
        isOpen
        onClose={onClose}
        onSelect={vi.fn()}
      />,
    )

    const backdrop = container.ownerDocument.querySelector('.fixed.inset-0.z-40')
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop!)
    expect(onClose).toHaveBeenCalledOnce()

    document.body.removeChild(anchorEl)
  })
})
