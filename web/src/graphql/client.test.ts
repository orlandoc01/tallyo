import { describe, expect, it } from 'vitest'
import type { Cache } from '@urql/exchange-graphcache'
import type { Account, BudgetReport, Category, CategoryGroup, Connection, PlaidItem, Rule, Transaction, TransactionConnection, TransactionsFilter } from '../types/graphql'
import { createGraphqlClient } from './client'
import { accountMutationUpdaters, removeConnectionAndAccountsFromCachedLists, upsertAccountInCachedLists, upsertConnectionInCachedLists } from './cache/accounts'
import { removeBudgetFromCachedReports, updateCachedBudgetReports } from './cache/budgets'
import { removeCategoryFromCachedLists, upsertCategoryGroupInCachedLists, upsertCategoryInCachedLists } from './cache/categories'
import { removeRuleFromCachedLists, upsertRuleInCachedLists } from './cache/rules'
import { TRANSACTION_DERIVED_ROOTS, WEALTH_RESOLUTION_ROOTS } from './cache/shared'
import { removeTransactionsFromCachedConnections, transactionMatchesFilter, updateTransactionInCachedConnections } from './cache/transactions'
import { wealthMutationUpdaters } from './cache/wealth'
import { ACCOUNTS_QUERY, CONNECTIONS_QUERY, PLAID_ITEMS_QUERY } from './queries'

function transactionConnection(ids: string[]): TransactionConnection {
  return {
    edges: ids.map((id) => ({
      cursor: `cursor-${id}`,
      node: {
        __typename: 'Transaction',
        id,
        tags: [],
        amount: 1,
        datetime: '2026-06-01T12:00:00Z',
        postedDatetime: '2026-06-01T12:00:00Z',
        account: {
          __typename: 'Account',
          id: 'account-1',
          owner: { __typename: 'Owner', id: 'owner-1', name: 'Owner' },
          name: 'Checking',
          type: 'DEPOSITORY',
          closed: false,
          hidden: false,
          needsReview: false,
          manual: false,
          typeLocked: false,
          createdAt: '2026-06-01T12:00:00Z',
          updatedAt: '2026-06-01T12:00:00Z',
        },
        category: {
          __typename: 'Category',
          id: '1',
          name: 'Groceries',
          emoji: 'G',
          groupName: 'Needs',
          groupEmoji: 'N',
          kind: 'EXPENSE',
          sortOrder: 1,
          plaidPFC2Codes: [],
        },
        isRecurring: false,
        isReviewed: true,
        pending: false,
        isHidden: false,
        createdAt: '2026-06-01T12:00:00Z',
        updatedAt: '2026-06-01T12:00:00Z',
      },
    })),
    pageInfo: {
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: ids[0] ? `cursor-${ids[0]}` : null,
      endCursor: ids[ids.length - 1] ? `cursor-${ids[ids.length - 1]}` : null,
    },
    totalCount: ids.length,
  }
}

function transaction(id: string): Transaction {
  const connection = transactionConnection([id])
  return connection.edges[0].node
}

function transactionTag(id: string) {
  return { __typename: 'Tag' as const, id, name: `Tag ${id}`, color: '#22C55E', transactionCount: 1, createdAt: '2026-06-01T12:00:00Z', updatedAt: '2026-06-01T12:00:00Z' }
}

function account(id: string, connection: Connection | null = null): Account {
  return {
    __typename: 'Account',
    id,
    connection,
    owner: { __typename: 'Owner', id: 'owner-1', name: 'Owner' },
    name: `Account ${id}`,
    type: 'DEPOSITORY',
    subtype: 'checking',
    mask: '1234',
    notes: null,
    closed: false,
    hidden: false,
    needsReview: false,
    manual: false,
    typeLocked: false,
    createdAt: '2026-06-01T12:00:00Z',
    updatedAt: '2026-06-01T12:00:00Z',
  }
}

function plaidItem(id: string, accounts: Account[]): PlaidItem {
  return {
    __typename: 'PlaidItem',
    id,
    credential: { __typename: 'PlaidCredential', id: 1, clientId: 'client', environment: 'DEVELOPMENT', label: 'Primary', itemCount: 1, createdAt: '2026-06-01T12:00:00Z' },
    institutionId: 'ins_1',
    accounts,
    lastSyncedAt: '2026-06-01T12:00:00Z',
    healthState: 'HEALTHY',
    healthErrorCode: null,
    healthErrorMessage: null,
    healthUpdatedAt: '2026-06-01T12:00:00Z',
    syncCron: '0 6 * * *',
    recurringSyncCron: '0 12 * * 0',
    nextSyncAt: '2026-06-02T06:00:00Z',
    nextRecurringSyncAt: '2026-06-07T12:00:00Z',
    isActive: true,
    createdAt: '2026-06-01T12:00:00Z',
    updatedAt: '2026-06-01T12:00:00Z',
  }
}

function connection(id: string, isActive = true, provider: Connection['provider'] = plaidItem(`item-${id}`, [])): Connection {
  return {
    __typename: 'Connection',
    id,
    name: `Connection ${id}`,
    owner: { __typename: 'Owner', id: 'owner-1', name: 'Owner' },
    isActive,
    provider,
  }
}

function category(id: string, name: string, sortOrder: number): Category {
  return {
    __typename: 'Category',
    id,
    name,
    emoji: name[0],
    groupName: 'Needs',
    groupEmoji: 'N',
    kind: 'EXPENSE',
    sortOrder,
    plaidPFC2Codes: [],
  }
}

function rule(id: string, priority: number): Rule {
  return {
    __typename: 'Rule',
    id,
    merchantPattern: `merchant-${id}`,
    originalPattern: null,
    category: category('cat-1', 'Groceries', 1),
    tags: [],
    shouldHide: null,
    shouldBeRecurring: null,
    accounts: [],
    amountMin: null,
    amountMax: null,
    priority,
    createdAt: '2026-06-01T12:00:00Z',
  }
}

function budgetReport(): BudgetReport {
  const groceries = category('cat-1', 'Groceries', 1)
  const dining = category('cat-2', 'Dining', 2)
  return {
    month: '2026-06',
    expensesBudgeted: 150,
    expensesActual: 120,
    incomeBudgeted: 0,
    incomeActual: 0,
    remainingBudgeted: -150,
    remainingActual: -120,
    sections: [
      {
        label: 'Needs',
        group: { __typename: 'CategoryGroup', id: 'group-1', name: 'Needs', emoji: 'N', kind: 'EXPENSE', categories: [groceries, dining] },
        budgeted: 150,
        actual: 120,
        remaining: 30,
        lines: [
          { id: 'budget-1', category: groceries, budgeted: 100, actual: 80, remaining: 20 },
          { id: null, category: dining, budgeted: 50, actual: 40, remaining: 10 },
        ],
      },
    ],
  }
}

function lineByCategory(report: BudgetReport, categoryID: string) {
  for (const section of report.sections) {
    const line = section.lines.find((item) => item.category.id === categoryID)
    if (line) return line
  }
  return null
}

function budgetCache() {
  const cached = {
    budgetReport: budgetReport(),
    budgetReportHistory: { items: [{ month: '2026-06', expensesBudgeted: 150, expensesActual: 120, incomeBudgeted: 0, incomeActual: 0, remainingBudgeted: -150, remainingActual: -120, sections: [] }] },
  }
  let updateCount = 0
  const cache = {
    inspectFields: () => [{ fieldName: 'budgetReport', arguments: { input: { month: '2026-06' } } }],
    updateQuery: <T,>(input: { query: unknown }, updater: (data: T | null) => T | null) => {
      void input
      updateCount += 1
      if (updateCount === 2) Object.assign(cached, updater({ budgetReportHistory: cached.budgetReportHistory } as T) as object)
      else Object.assign(cached, updater({ budgetReport: cached.budgetReport } as T) as object)
    },
  }
  return { cache, cached }
}

function invalidationCache() {
  const invalidated: string[] = []
  const cache = {
    inspectFields: () => [],
    updateQuery: () => {},
    invalidate: (_entity: string, fieldName?: string) => {
      if (fieldName) invalidated.push(fieldName)
    },
  }
  return { cache: cache as unknown as Cache, invalidated }
}

describe('graphql client', () => {
  it('createGraphqlClient returns a client', () => {
    const client = createGraphqlClient()
    expect(client).toBeDefined()
  })

  it('invalidates wealth resolution roots after resolving a balance review', () => {
    const { cache, invalidated } = invalidationCache()

    wealthMutationUpdaters.resolveBalanceReview({}, {}, cache)

    expect(invalidated).toEqual([...WEALTH_RESOLUTION_ROOTS])
  })

  it('invalidates wealth resolution roots after snapshot edits', () => {
    const { cache, invalidated } = invalidationCache()

    wealthMutationUpdaters.changeAccountSnapshot({}, {}, cache)

    expect(invalidated).toEqual([...WEALTH_RESOLUTION_ROOTS])
  })

  it('invalidates transaction and wealth roots after account visibility changes', () => {
    const { cache, invalidated } = invalidationCache()

    accountMutationUpdaters.updateAccount({ updateAccount: { account: account('account-1') } }, { input: { hidden: true } }, cache)

    expect(invalidated).toEqual(['transactions', ...TRANSACTION_DERIVED_ROOTS, ...WEALTH_RESOLUTION_ROOTS])
  })

  it('invalidates wealth roots after EVM wallet updates and unlinks', () => {
    const evmConnection = connection('conn-evm', true, { __typename: 'EVMWallet', address: '0xabc', chainIds: ['eth'] })
    const { cache: updateCache, invalidated: updateInvalidated } = invalidationCache()
    const { cache: unlinkCache, invalidated: unlinkInvalidated } = invalidationCache()

    accountMutationUpdaters.updateConnection({ updateConnection: { connection: evmConnection } }, {}, updateCache)
    wealthMutationUpdaters.unlinkEVMWallet({}, { id: evmConnection.id }, unlinkCache)

    expect(updateInvalidated).toEqual([...WEALTH_RESOLUTION_ROOTS])
    expect(unlinkInvalidated).toEqual([...WEALTH_RESOLUTION_ROOTS])
  })

  it('removes deleted transactions from cached transaction connections', () => {
    const cached = { transactions: transactionConnection(['txn-1', 'txn-2', 'txn-3']) }
    const cache = {
      inspectFields: () => [{ fieldName: 'transactions', fieldKey: 'transactions({"input":{"first":50}})', arguments: { input: { first: 50 } } }],
      updateQuery: <T,>(_query: unknown, updater: (data: T | null) => T | null) => {
        Object.assign(cached, updater(cached as T) as object)
      },
    }

    removeTransactionsFromCachedConnections(cache, ['txn-2'])

    expect(cached.transactions.edges.map((edge) => edge.node.id)).toEqual(['txn-1', 'txn-3'])
    expect(cached.transactions.totalCount).toBe(2)
    expect(cached.transactions.pageInfo.startCursor).toBe('cursor-txn-1')
    expect(cached.transactions.pageInfo.endCursor).toBe('cursor-txn-3')
  })

  it('clears cached transaction cursors when the last edge is removed', () => {
    const cached = { transactions: transactionConnection(['txn-1']) }
    const cache = {
      inspectFields: () => [{ fieldName: 'transactions', fieldKey: 'transactions({"input":{"first":50}})', arguments: { input: { first: 50 } } }],
      updateQuery: <T,>(_query: unknown, updater: (data: T | null) => T | null) => {
        Object.assign(cached, updater(cached as T) as object)
      },
    }

    removeTransactionsFromCachedConnections(cache, ['txn-1'])

    expect(cached.transactions.edges).toEqual([])
    expect(cached.transactions.totalCount).toBe(0)
    expect(cached.transactions.pageInfo.startCursor).toBeNull()
    expect(cached.transactions.pageInfo.endCursor).toBeNull()
  })

  it('updates matching transactions inside cached transaction connections', () => {
    const cached = { transactions: transactionConnection(['txn-1', 'txn-2']) }
    const dining = category('2', 'Dining', 2)
    const updated = { ...transaction('txn-2'), category: dining }
    const cache = {
      inspectFields: () => [{ fieldName: 'transactions', fieldKey: 'transactions({"input":{"first":50}})', arguments: { input: { first: 50 } } }],
      updateQuery: <T,>(_query: unknown, updater: (data: T | null) => T | null) => {
        Object.assign(cached, updater(cached as T) as object)
      },
    }

    updateTransactionInCachedConnections(cache, updated)

    expect(cached.transactions.edges.map((edge) => edge.node.category.name)).toEqual(['Groceries', 'Dining'])
    expect(cached.transactions.totalCount).toBe(2)
  })

  it('removes updated transactions from cached connections when they stop matching filters', () => {
    const cached = { transactions: transactionConnection(['txn-1', 'txn-2']) }
    const dining = category('2', 'Dining', 2)
    const updated = { ...transaction('txn-2'), category: dining }
    const cache = {
      inspectFields: () => [{ fieldName: 'transactions', fieldKey: 'transactions({"input":{"filter":{"categoryIds":["1"]},"first":50}})', arguments: { input: { filter: { categoryIds: ['1'] }, first: 50 } } }],
      updateQuery: <T,>(_query: unknown, updater: (data: T | null) => T | null) => {
        Object.assign(cached, updater(cached as T) as object)
      },
    }

    updateTransactionInCachedConnections(cache, updated)

    expect(cached.transactions.edges.map((edge) => edge.node.id)).toEqual(['txn-1'])
    expect(cached.transactions.totalCount).toBe(1)
    expect(cached.transactions.pageInfo.endCursor).toBe('cursor-txn-2')
  })

  it('matches server transaction filter semantics when patching cached connections', () => {
    const cached = { transactions: transactionConnection(['txn-1']) }
    const updated = {
      ...transaction('txn-1'),
      merchantName: null,
      originalName: 'TARGET STORE',
      tags: [{ __typename: 'Tag' as const, id: 'tag-2', name: 'Travel', color: '#22C55E', transactionCount: 1, createdAt: '2026-06-01T12:00:00Z', updatedAt: '2026-06-01T12:00:00Z' }],
    }
    const cache = {
      inspectFields: () => [{ fieldName: 'transactions', fieldKey: 'transactions', arguments: { input: { filter: { merchantPrefix: 'store', tagIds: ['tag-1', 'tag-2'], isHidden: null, search: 'tar sto' } } } }],
      updateQuery: <T,>(_query: unknown, updater: (data: T | null) => T | null) => {
        Object.assign(cached, updater(cached as T) as object)
      },
    }

    updateTransactionInCachedConnections(cache, updated)

    expect(cached.transactions.edges).toHaveLength(1)
    expect(cached.transactions.edges[0].node).toMatchObject({ merchantName: null, originalName: 'TARGET STORE' })
  })

  it('keeps transaction cache filter clauses aligned with the server', () => {
    const baseTransaction: Transaction = {
      ...transaction('txn-filter'),
      amount: 42.5,
      datetime: '2026-06-15T12:00:00Z',
      merchantName: 'Target Store',
      originalName: 'Original Market',
      notes: 'weekly groceries',
      tags: [transactionTag('tag-1')],
    }
    const cases: Array<{ name: string; filter: TransactionsFilter; mismatch: Transaction; matching?: Transaction }> = [
      { name: 'datetime from', filter: { datetimeRange: { from: '2026-06-01T00:00:00Z' } }, mismatch: { ...baseTransaction, datetime: '2026-05-31T23:59:59Z' } },
      { name: 'datetime to', filter: { datetimeRange: { to: '2026-07-01T00:00:00Z' } }, mismatch: { ...baseTransaction, datetime: '2026-07-01T00:00:00Z' } },
      { name: 'category ids', filter: { categoryIds: ['1'] }, mismatch: { ...baseTransaction, category: category('2', 'Dining', 2) } },
      { name: 'account ids', filter: { accountIds: ['account-1'] }, mismatch: { ...baseTransaction, account: { ...baseTransaction.account, id: 'account-2' } } },
      { name: 'owner ids', filter: { ownerIds: ['owner-1'] }, mismatch: { ...baseTransaction, account: { ...baseTransaction.account, owner: { ...baseTransaction.account.owner, id: 'owner-2' } } } },
      { name: 'reviewed state', filter: { isReviewed: true }, mismatch: { ...baseTransaction, isReviewed: false } },
      { name: 'recurring state', filter: { isRecurring: false }, mismatch: { ...baseTransaction, isRecurring: true } },
      { name: 'pending state', filter: { isPending: false }, mismatch: { ...baseTransaction, pending: true } },
      { name: 'hidden state', filter: { isHidden: false }, mismatch: { ...baseTransaction, isHidden: true } },
      { name: 'merchant contains', filter: { merchantPrefix: 'store' }, mismatch: { ...baseTransaction, merchantName: 'Cafe', originalName: 'Cafe' } },
      { name: 'merchant fallback contains', filter: { merchantPrefix: 'market' }, matching: { ...baseTransaction, merchantName: null }, mismatch: { ...baseTransaction, merchantName: null, originalName: 'Cafe' } },
      { name: 'original contains', filter: { originalPrefix: 'market' }, mismatch: { ...baseTransaction, originalName: 'Cafe' } },
      { name: 'transfer exclusion', filter: { excludeTransfers: true }, mismatch: { ...baseTransaction, category: { ...baseTransaction.category, kind: 'TRANSFER' } } },
      { name: 'income exclusion', filter: { excludeIncome: true }, mismatch: { ...baseTransaction, category: { ...baseTransaction.category, kind: 'INCOME' } } },
      { name: 'minimum amount', filter: { amountMin: 40 }, mismatch: { ...baseTransaction, amount: 39.99 } },
      { name: 'maximum amount', filter: { amountMax: 50 }, mismatch: { ...baseTransaction, amount: 50.01 } },
      { name: 'exact amount', filter: { exactAmount: 42.5 }, mismatch: { ...baseTransaction, amount: 42 } },
      { name: 'tag ids', filter: { tagIds: ['tag-1', 'tag-2'] }, mismatch: { ...baseTransaction, tags: [transactionTag('tag-3')] } },
      { name: 'untagged', filter: { untagged: true }, mismatch: baseTransaction },
    ]

    for (const testCase of cases) {
      const matching = testCase.filter.untagged ? { ...baseTransaction, tags: [] } : testCase.matching ?? baseTransaction

      expect(transactionMatchesFilter(matching, testCase.filter), testCase.name).toBe(true)
      expect(transactionMatchesFilter(testCase.mismatch, testCase.filter), testCase.name).toBe(false)
    }
  })

  it('upserts accounts into cached account and provider lists', () => {
    const baseConnection = connection('conn-1')
    const firstAccount = account('acct-1', baseConnection)
    const item = plaidItem('item-1', [firstAccount])
    const cachedConnection = { ...baseConnection, provider: item }
    const secondAccount = account('acct-2', baseConnection)
    const cached = {
      accounts: { items: [firstAccount] },
      connections: { items: [cachedConnection] },
      plaidItems: { items: [item] },
    }
    const cache = {
      inspectFields: () => [
        { fieldName: 'connections', arguments: { input: { includeInactive: true } } },
        { fieldName: 'plaidItems', arguments: { input: { includeInactive: true } } },
      ],
      updateQuery: <T,>(input: { query: unknown }, updater: (data: T | null) => T | null) => {
        if (input.query === ACCOUNTS_QUERY) Object.assign(cached, updater({ accounts: cached.accounts } as T) as object)
        if (input.query === CONNECTIONS_QUERY) Object.assign(cached, updater({ connections: cached.connections } as T) as object)
        if (input.query === PLAID_ITEMS_QUERY) Object.assign(cached, updater({ plaidItems: cached.plaidItems } as T) as object)
      },
    }

    upsertAccountInCachedLists(cache, secondAccount)

    expect(cached.accounts.items.map((item) => item.id)).toEqual(['acct-1', 'acct-2'])
    expect(cached.connections.items[0].provider).toMatchObject({ accounts: [expect.objectContaining({ id: 'acct-1' }), expect.objectContaining({ id: 'acct-2' })] })
    expect(cached.plaidItems.items[0].accounts.map((item) => item.id)).toEqual(['acct-1', 'acct-2'])
  })

  it('updates cached connection lists according to includeInactive', () => {
    const cached = {
      activeConnections: { items: [connection('conn-1')] },
      allConnections: { items: [connection('conn-1')] },
    }
    const cache = {
      inspectFields: () => [
        { fieldName: 'connections', arguments: { input: { includeInactive: false } } },
        { fieldName: 'connections', arguments: { input: { includeInactive: true } } },
      ],
      updateQuery: <T,>(input: { query: unknown; variables?: Record<string, unknown> }, updater: (data: T | null) => T | null) => {
        if (input.query !== CONNECTIONS_QUERY) return
        const includeInactive = (input.variables?.input as { includeInactive?: boolean } | undefined)?.includeInactive === true
        if (includeInactive) Object.assign(cached.allConnections, (updater({ connections: cached.allConnections } as T) as { connections: { items: Connection[] } }).connections)
        else Object.assign(cached.activeConnections, (updater({ connections: cached.activeConnections } as T) as { connections: { items: Connection[] } }).connections)
      },
    }

    upsertConnectionInCachedLists(cache, connection('conn-2', false))
    expect(cached.activeConnections.items.map((item) => item.id)).toEqual(['conn-1'])
    expect(cached.allConnections.items.map((item) => item.id)).toEqual(['conn-1', 'conn-2'])

    upsertConnectionInCachedLists(cache, connection('conn-2', true))
    expect(cached.activeConnections.items.map((item) => item.id)).toEqual(['conn-1', 'conn-2'])
    expect(cached.allConnections.items.map((item) => item.id)).toEqual(['conn-1', 'conn-2'])
  })

  it('removes deleted connections and their accounts from cached lists', () => {
    const deletedConnection = connection('conn-1')
    const keptConnection = connection('conn-2')
    const deletedAccount = account('acct-1', deletedConnection)
    const keptAccount = account('acct-2', keptConnection)
    const cached = {
      accounts: { items: [deletedAccount, keptAccount] },
      connections: { items: [deletedConnection, keptConnection] },
      plaidItems: { items: [plaidItem('item-1', [deletedAccount, keptAccount])] },
    }
    const cache = {
      inspectFields: () => [
        { fieldName: 'connections', arguments: { input: { includeInactive: true } } },
        { fieldName: 'plaidItems', arguments: { input: { includeInactive: true } } },
      ],
      updateQuery: <T,>(input: { query: unknown }, updater: (data: T | null) => T | null) => {
        if (input.query === ACCOUNTS_QUERY) Object.assign(cached, updater({ accounts: cached.accounts } as T) as object)
        if (input.query === CONNECTIONS_QUERY) Object.assign(cached, updater({ connections: cached.connections } as T) as object)
        if (input.query === PLAID_ITEMS_QUERY) Object.assign(cached, updater({ plaidItems: cached.plaidItems } as T) as object)
      },
    }

    removeConnectionAndAccountsFromCachedLists(cache, 'conn-1')

    expect(cached.accounts.items.map((item) => item.id)).toEqual(['acct-2'])
    expect(cached.connections.items.map((item) => item.id)).toEqual(['conn-2'])
    expect(cached.plaidItems.items[0].accounts.map((item) => item.id)).toEqual(['acct-2'])
  })

  it('upserts categories into cached category and group lists', () => {
    const groceries = category('cat-1', 'Groceries', 2)
    const dining = category('cat-2', 'Dining', 1)
    const cached = {
      categories: { items: [groceries] },
      categoryGroups: { items: [{ __typename: 'CategoryGroup', id: 'group-1', name: 'Needs', emoji: 'N', kind: 'EXPENSE', categories: [groceries] }] as CategoryGroup[] },
    }
    let updateCount = 0
    const cache = {
      inspectFields: () => [],
      updateQuery: <T,>(input: { query: unknown }, updater: (data: T | null) => T | null) => {
        void input
        updateCount += 1
        if (updateCount === 2) Object.assign(cached, updater({ categoryGroups: cached.categoryGroups } as T) as object)
        else Object.assign(cached, updater({ categories: cached.categories } as T) as object)
      },
    }

    upsertCategoryInCachedLists(cache, dining, 'group-1')

    expect(cached.categories.items.map((item) => item.id)).toEqual(['cat-2', 'cat-1'])
    expect(cached.categoryGroups.items[0].categories.map((item) => item.id)).toEqual(['cat-2', 'cat-1'])
  })

  it('updates cached categories from category group payloads', () => {
    const groceries = category('cat-1', 'Groceries', 1)
    const renamedGroupGroceries = { ...groceries, groupName: 'Essentials', groupEmoji: 'E' }
    const cached = {
      categories: { items: [groceries] },
      categoryGroups: { items: [{ __typename: 'CategoryGroup', id: 'group-1', name: 'Needs', emoji: 'N', kind: 'EXPENSE', categories: [groceries] }] as CategoryGroup[] },
    }
    let updateCount = 0
    const cache = {
      inspectFields: () => [],
      updateQuery: <T,>(input: { query: unknown }, updater: (data: T | null) => T | null) => {
        void input
        updateCount += 1
        if (updateCount === 1) Object.assign(cached, updater({ categoryGroups: cached.categoryGroups } as T) as object)
        else Object.assign(cached, updater({ categories: cached.categories } as T) as object)
      },
    }

    upsertCategoryGroupInCachedLists(cache, {
      __typename: 'CategoryGroup',
      id: 'group-1',
      name: 'Essentials',
      emoji: 'E',
      kind: 'EXPENSE',
      categories: [renamedGroupGroceries],
    })

    expect(cached.categoryGroups.items[0]).toMatchObject({ name: 'Essentials', emoji: 'E' })
    expect(cached.categories.items[0]).toMatchObject({ groupName: 'Essentials', groupEmoji: 'E' })
  })

  it('removes categories from cached category and group lists', () => {
    const groceries = category('cat-1', 'Groceries', 1)
    const dining = category('cat-2', 'Dining', 2)
    const cached = {
      categories: { items: [groceries, dining] },
      categoryGroups: { items: [{ __typename: 'CategoryGroup', id: 'group-1', name: 'Needs', emoji: 'N', kind: 'EXPENSE', categories: [groceries, dining] }] as CategoryGroup[] },
    }
    let updateCount = 0
    const cache = {
      inspectFields: () => [],
      updateQuery: <T,>(input: { query: unknown }, updater: (data: T | null) => T | null) => {
        void input
        updateCount += 1
        if (updateCount === 2) Object.assign(cached, updater({ categoryGroups: cached.categoryGroups } as T) as object)
        else Object.assign(cached, updater({ categories: cached.categories } as T) as object)
      },
    }

    removeCategoryFromCachedLists(cache, 'cat-1')

    expect(cached.categories.items.map((item) => item.id)).toEqual(['cat-2'])
    expect(cached.categoryGroups.items[0].categories.map((item) => item.id)).toEqual(['cat-2'])
  })

  it('upserts and removes rules in priority order', () => {
    const low = rule('rule-1', 1)
    const high = rule('rule-2', 10)
    const cached = { rules: { items: [low] } }
    const cache = {
      inspectFields: () => [],
      updateQuery: <T,>(_input: { query: unknown }, updater: (data: T | null) => T | null) => {
        Object.assign(cached, updater(cached as T) as object)
      },
    }

    upsertRuleInCachedLists(cache, high)
    expect(cached.rules.items.map((item) => item.id)).toEqual(['rule-2', 'rule-1'])

    removeRuleFromCachedLists(cache, 'rule-2')
    expect(cached.rules.items.map((item) => item.id)).toEqual(['rule-1'])
  })

  it('updates cached budget reports and history for setBudget', () => {
    const { cache, cached } = budgetCache()

    updateCachedBudgetReports(cache, { id: 'budget-2', month: '2026-06', category: category('cat-2', 'Dining', 2), amount: 75 })

    expect(cached.budgetReport.expensesBudgeted).toBe(175)
    expect(lineByCategory(cached.budgetReport, 'cat-2')).toMatchObject({ id: 'budget-2', budgeted: 75, remaining: 35 })
    expect(cached.budgetReportHistory.items[0]).toMatchObject({ expensesBudgeted: 175, remainingBudgeted: -175 })
  })

  it('removes deleted budgets from cached reports and history', () => {
    const { cache, cached } = budgetCache()

    removeBudgetFromCachedReports(cache, 'budget-1')

    expect(cached.budgetReport.expensesBudgeted).toBe(50)
    expect(lineByCategory(cached.budgetReport, 'cat-1')).toMatchObject({ id: null, budgeted: 0, remaining: -80 })
    expect(cached.budgetReportHistory.items[0]).toMatchObject({ expensesBudgeted: 50, remainingBudgeted: -50 })
  })
})
