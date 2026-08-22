import { describe, expect, it, vi } from 'vitest'
import type { Cache, ResolveInfo } from '@urql/exchange-graphcache'
import { categories, tags, transactions } from '../mocks/fixtures'
import type { Transaction, TransactionConnection } from '../types/graphql'
import type { InvalidatingCache } from './cache/shared'
import {
  removeTransactionsFromCachedConnections,
  transactionMatchesFilter,
  transactionMutationUpdaters,
  transactionsPagination,
  updateTransactionInCachedConnections,
} from './cache/transactions'

const target = transactions[0]

describe('transactionMatchesFilter', () => {
  it('accepts when there is no filter', () => {
    expect(transactionMatchesFilter(target)).toBe(true)
    expect(transactionMatchesFilter(target, null)).toBe(true)
  })

  it('applies datetime range bounds', () => {
    expect(transactionMatchesFilter(target, { datetimeRange: { from: '2026-05-15T00:00:00Z' } })).toBe(false)
    expect(transactionMatchesFilter(target, { datetimeRange: { from: '2026-05-01T00:00:00Z' } })).toBe(true)
    expect(transactionMatchesFilter(target, { datetimeRange: { to: '2026-05-14T00:00:00Z' } })).toBe(false)
    expect(transactionMatchesFilter(target, { datetimeRange: { to: '2026-06-01T00:00:00Z' } })).toBe(true)
  })

  it('applies id filters', () => {
    expect(transactionMatchesFilter(target, { categoryIds: ['999'] })).toBe(false)
    expect(transactionMatchesFilter(target, { categoryIds: [target.category.id] })).toBe(true)
    expect(transactionMatchesFilter(target, { accountIds: ['nope'] })).toBe(false)
    expect(transactionMatchesFilter(target, { accountIds: [target.account.id] })).toBe(true)
    expect(transactionMatchesFilter(target, { ownerIds: ['nope'] })).toBe(false)
    expect(transactionMatchesFilter(target, { ownerIds: [target.account.owner.id] })).toBe(true)
  })

  it('applies boolean flags', () => {
    expect(transactionMatchesFilter(target, { isReviewed: false })).toBe(false)
    expect(transactionMatchesFilter(target, { isReviewed: true })).toBe(true)
    expect(transactionMatchesFilter(target, { isRecurring: true })).toBe(false)
    expect(transactionMatchesFilter(target, { isPending: true })).toBe(false)
    expect(transactionMatchesFilter(target, { isHidden: true })).toBe(false)
  })

  it('matches merchant and original prefixes case-insensitively', () => {
    expect(transactionMatchesFilter(target, { merchantPrefix: 'targ' })).toBe(true)
    expect(transactionMatchesFilter(target, { merchantPrefix: 'walmart' })).toBe(false)
    expect(transactionMatchesFilter(target, { merchantPrefix: '   ' })).toBe(true)
    expect(transactionMatchesFilter(target, { originalPrefix: 'target store' })).toBe(true)
    expect(transactionMatchesFilter(target, { originalPrefix: 'return' })).toBe(false)
  })

  it('falls back to originalName when merchantName is missing', () => {
    const unnamed: Transaction = { ...target, merchantName: null }
    expect(transactionMatchesFilter(unnamed, { merchantPrefix: 'target store' })).toBe(true)
    const blank: Transaction = { ...unnamed, originalName: null }
    expect(transactionMatchesFilter(blank, { merchantPrefix: 'target' })).toBe(false)
  })

  it('excludes transfers and income by category kind', () => {
    const transfer: Transaction = { ...target, category: categories[3] }
    const income: Transaction = { ...target, category: categories[2] }
    expect(transactionMatchesFilter(transfer, { excludeTransfers: true })).toBe(false)
    expect(transactionMatchesFilter(target, { excludeTransfers: true })).toBe(true)
    expect(transactionMatchesFilter(income, { excludeIncome: true })).toBe(false)
    expect(transactionMatchesFilter(target, { excludeIncome: true })).toBe(true)
  })

  it('applies amount bounds', () => {
    expect(transactionMatchesFilter(target, { amountMin: 100 })).toBe(false)
    expect(transactionMatchesFilter(target, { amountMin: 10 })).toBe(true)
    expect(transactionMatchesFilter(target, { amountMax: 10 })).toBe(false)
    expect(transactionMatchesFilter(target, { amountMax: 100 })).toBe(true)
    expect(transactionMatchesFilter(target, { exactAmount: 1 })).toBe(false)
    expect(transactionMatchesFilter(target, { exactAmount: target.amount })).toBe(true)
  })

  it('applies tag filters', () => {
    const tagged: Transaction = { ...target, tags: [tags[0]] }
    expect(transactionMatchesFilter(target, { tagIds: [tags[0].id] })).toBe(false)
    expect(transactionMatchesFilter(tagged, { tagIds: [tags[0].id] })).toBe(true)
    expect(transactionMatchesFilter(tagged, { tagIds: [tags[1].id] })).toBe(false)
    expect(transactionMatchesFilter(tagged, { untagged: true })).toBe(false)
    expect(transactionMatchesFilter(target, { untagged: true })).toBe(true)
  })
})

type FakeField = { fieldName: string; fieldKey: string; arguments: Record<string, unknown> | null }

function fakeResolverCache(fields: FakeField[], records: Record<string, Record<string, unknown>>, argsResolved: unknown = 'present') {
  return {
    inspectFields: () => fields,
    resolve: (key: unknown, field: string, args?: unknown) => {
      if (args !== undefined) return argsResolved
      return records[key as string]?.[field] ?? null
    },
  } as unknown as Cache
}

function resolverInfo(): ResolveInfo {
  return { parentKey: 'Query', fieldName: 'transactions', partial: undefined } as unknown as ResolveInfo
}

describe('transactionsPagination', () => {
  const resolve = transactionsPagination()

  it('returns undefined when nothing is cached', () => {
    const cache = fakeResolverCache([{ fieldName: 'other', fieldKey: 'other', arguments: null }], {})
    expect(resolve({}, {}, cache, resolverInfo())).toBeUndefined()
  })

  it('merges forward pages, deduplicates nodes, and takes the smallest total', () => {
    const input = { filter: { search: 't' } }
    const fields: FakeField[] = [
      { fieldName: 'transactions', fieldKey: 'transactions(a)', arguments: { input: { ...input, first: 2 } } },
      { fieldName: 'transactions', fieldKey: 'transactions(b)', arguments: { input: { ...input, first: 2, after: 'c2' } } },
      { fieldName: 'transactions', fieldKey: 'transactions(c)', arguments: { input: { filter: { search: 'other' } } } },
      { fieldName: 'transactions', fieldKey: 'transactions(d)', arguments: { input } },
      { fieldName: 'transactions', fieldKey: 'transactions(e)', arguments: { input } },
    ]
    const records = {
      Query: { 'transactions(a)': 'conn1', 'transactions(b)': 'conn2', 'transactions(d)': null, 'transactions(e)': 'conn3' },
      conn1: { __typename: 'TransactionConnection', edges: ['e1', 'e2'], pageInfo: 'pi1', totalCount: 10 },
      conn2: { __typename: 'TransactionConnection', edges: ['e2', 'e3'], pageInfo: null, totalCount: 4 },
      conn3: { __typename: null },
      pi1: { hasNextPage: true, hasPreviousPage: false, startCursor: 'c1', endCursor: 'c2' },
      e1: { cursor: 'c1', node: 'n1' },
      e2: { cursor: 'c2', node: 'n2' },
      e3: { cursor: 'c3', node: 'n3' },
    }
    const info = resolverInfo()
    const page = resolve({}, { input }, fakeResolverCache(fields, records, null), info) as TransactionConnection
    expect(page.edges).toEqual(['e1', 'e2', 'e3'])
    expect(page.totalCount).toBe(4)
    expect(page.pageInfo).toMatchObject({ startCursor: 'c1', endCursor: 'c3', hasNextPage: false, hasPreviousPage: false })
    expect(info.partial).toBe(true)
  })

  it('prepends backward pages and keeps their start cursor', () => {
    const fields: FakeField[] = [
      { fieldName: 'transactions', fieldKey: 'transactions(a)', arguments: { input: { last: 2 } } },
      { fieldName: 'transactions', fieldKey: 'transactions(b)', arguments: { input: { before: 'c1' } } },
    ]
    const records = {
      Query: { 'transactions(a)': 'conn1', 'transactions(b)': 'conn2' },
      conn1: { __typename: 'TransactionConnection', edges: ['e2'], pageInfo: 'pi1', totalCount: null },
      conn2: { __typename: 'TransactionConnection', edges: 'not-a-list', pageInfo: 'pi2', totalCount: null },
      pi1: { hasNextPage: 'not-a-bool', hasPreviousPage: true, startCursor: 'c2', endCursor: 'c2' },
      pi2: { hasNextPage: false, hasPreviousPage: true, startCursor: 'c0', endCursor: null },
      e2: { cursor: 'c2', node: 'n2' },
    }
    const info = resolverInfo()
    const page = resolve({}, { input: { last: 2 } }, fakeResolverCache(fields, records), info) as TransactionConnection
    expect(page.edges).toEqual(['e2'])
    expect(page.totalCount).toBe(1)
    expect(page.pageInfo).toMatchObject({ startCursor: 'c0', hasPreviousPage: true })
    expect(info.partial).toBeUndefined()
  })

  it('treats non-object args as an unpaginated identity', () => {
    const fields: FakeField[] = [{ fieldName: 'transactions', fieldKey: 'transactions', arguments: null }]
    const records = {
      Query: { transactions: 'conn1' },
      conn1: { __typename: 'TransactionConnection', edges: ['e1'], pageInfo: null, totalCount: 1 },
      e1: { cursor: 'c1', node: 'n1' },
    }
    const page = resolve({}, null as never, fakeResolverCache(fields, records), resolverInfo()) as TransactionConnection
    expect(page.edges).toEqual(['e1'])
  })
})

type CachedQueryData = {
  transactions: {
    __typename: string
    edges: Array<{ __typename: string; cursor: string; node: Transaction }>
    pageInfo: { __typename: string; startCursor: string | null; endCursor: string | null }
    totalCount: number
  }
} | null

function connectionData(rows: Transaction[], totalCount = rows.length): CachedQueryData {
  return {
    transactions: {
      __typename: 'TransactionConnection',
      edges: rows.map((row, index) => ({ __typename: 'TransactionEdge', cursor: `c${index + 1}`, node: row })),
      pageInfo: { __typename: 'PageInfo', startCursor: rows.length ? 'c1' : null, endCursor: rows.length ? `c${rows.length}` : null },
      totalCount,
    },
  }
}

function fakeQueryCache(entries: Array<{ input?: unknown; data: CachedQueryData }>) {
  let call = 0
  const results: CachedQueryData[] = []
  const inspectFields = vi.fn(() => [
    ...entries.map((entry) => ({ fieldName: 'transactions', arguments: entry.input === undefined ? null : { input: entry.input } })),
    { fieldName: 'somethingElse', arguments: null },
  ])
  const cache = {
    inspectFields,
    updateQuery: (_query: unknown, updater: (data: CachedQueryData) => CachedQueryData) => {
      results.push(updater(entries[call].data))
      call += 1
    },
    invalidate: vi.fn(),
  }
  return { cache: cache as unknown as InvalidatingCache & Cache, results, inspectFields, invalidate: cache.invalidate }
}

describe('updateTransactionInCachedConnections', () => {
  const other = transactions[2]

  it('patches matching edges and leaves unrelated lists untouched', () => {
    const untouched = connectionData([other])
    const { cache, results } = fakeQueryCache([
      { data: connectionData([target, other]) },
      { data: untouched },
      { data: null },
    ])
    const updated: Transaction = { ...target, notes: 'patched' }
    updateTransactionInCachedConnections(cache, updated)
    expect(results[0]?.transactions.edges[0]?.node.notes).toBe('patched')
    expect(results[1]).toBe(untouched)
    expect(results[2]).toBeNull()
  })

  it('drops edges that no longer match the cached query filter', () => {
    const { cache, results } = fakeQueryCache([
      { input: { filter: { categoryIds: ['999'] } }, data: connectionData([target], 0) },
    ])
    updateTransactionInCachedConnections(cache, target)
    expect(results[0]?.transactions.edges).toEqual([])
    expect(results[0]?.transactions.totalCount).toBe(0)
  })

  it('applies the cached search to decide membership', () => {
    const { cache, results } = fakeQueryCache([
      { input: { filter: { search: 'targ' } }, data: connectionData([target]) },
      { input: { filter: { search: 'zzz' } }, data: connectionData([target]) },
      { input: { filter: { search: '!!!' } }, data: connectionData([target]) },
    ])
    updateTransactionInCachedConnections(cache, target)
    expect(results[0]?.transactions.edges).toHaveLength(1)
    expect(results[1]?.transactions.edges).toHaveLength(0)
    expect(results[2]?.transactions.edges).toHaveLength(1)
  })
})

describe('removeTransactionsFromCachedConnections', () => {
  it('does nothing for an empty id list', () => {
    const { cache, inspectFields } = fakeQueryCache([])
    removeTransactionsFromCachedConnections(cache, [])
    expect(inspectFields).not.toHaveBeenCalled()
  })

  it('removes matching edges and rewrites the cursors', () => {
    const other = transactions[2]
    const untouched = connectionData([other])
    const { cache, results } = fakeQueryCache([
      { data: connectionData([target, other]) },
      { data: untouched },
      { data: null },
      { data: connectionData([target]) },
    ])
    removeTransactionsFromCachedConnections(cache, [target.id])
    expect(results[0]?.transactions.edges.map((edge) => edge.node.id)).toEqual([other.id])
    expect(results[0]?.transactions.pageInfo).toMatchObject({ startCursor: 'c2', endCursor: 'c2' })
    expect(results[0]?.transactions.totalCount).toBe(1)
    expect(results[1]).toBe(untouched)
    expect(results[2]).toBeNull()
    expect(results[3]?.transactions.edges).toEqual([])
    expect(results[3]?.transactions.pageInfo).toMatchObject({ startCursor: null, endCursor: null })
  })
})

describe('transactionMutationUpdaters', () => {
  it('updateTransaction patches from the payload and only invalidates without one', () => {
    const withPayload = fakeQueryCache([])
    transactionMutationUpdaters.updateTransaction({ updateTransaction: { transaction: target } }, { input: {} }, withPayload.cache)
    expect(withPayload.invalidate).not.toHaveBeenCalledWith('Query', 'transactions')

    const noPayload = fakeQueryCache([])
    transactionMutationUpdaters.updateTransaction({}, { input: { updates: { categoryId: '2' } } }, noPayload.cache)
    expect(noPayload.invalidate).toHaveBeenCalledWith('Query', 'transactions')

    const cosmetic = fakeQueryCache([])
    transactionMutationUpdaters.updateTransaction({}, { input: { updates: { notes: 'x' } } }, cosmetic.cache)
    expect(cosmetic.invalidate).not.toHaveBeenCalledWith('Query', 'transactions')
    expect(cosmetic.invalidate).toHaveBeenCalledWith('Query', 'recurringCharges')
  })

  it('bulkUpdateTransactions patches each transaction or falls back to invalidation', () => {
    const withPayload = fakeQueryCache([{ data: connectionData([target]) }])
    transactionMutationUpdaters.bulkUpdateTransactions({ bulkUpdateTransactions: { transactions: [{ ...target, notes: 'bulk' }] } }, {}, withPayload.cache)
    expect(withPayload.results[0]?.transactions.edges[0]?.node.notes).toBe('bulk')

    const noPayload = fakeQueryCache([])
    transactionMutationUpdaters.bulkUpdateTransactions({}, {}, noPayload.cache)
    expect(noPayload.invalidate).toHaveBeenCalledWith('Query', 'transactions')
  })

  it('create and reprocess invalidate the transaction roots', () => {
    const created = fakeQueryCache([])
    transactionMutationUpdaters.createTransaction({}, {}, created.cache)
    expect(created.invalidate).toHaveBeenCalledWith('Query', 'transactions')

    const reprocessed = fakeQueryCache([])
    transactionMutationUpdaters.reprocessUncategorizedTransactions({}, {}, reprocessed.cache)
    expect(reprocessed.invalidate).toHaveBeenCalledWith('Query', 'spendingByCategory')
  })

  it('deleteTransaction removes by id and invalidates without one', () => {
    const byID = fakeQueryCache([{ data: connectionData([target]) }])
    transactionMutationUpdaters.deleteTransaction({}, { id: target.id }, byID.cache)
    expect(byID.results[0]?.transactions.edges).toEqual([])
    expect(byID.invalidate).not.toHaveBeenCalledWith('Query', 'transactions')

    const noID = fakeQueryCache([])
    transactionMutationUpdaters.deleteTransaction({}, { id: 5 }, noID.cache)
    expect(noID.invalidate).toHaveBeenCalledWith('Query', 'transactions')
  })

  it('bulkDeleteTransactions removes listed ids and invalidates otherwise', () => {
    const byIDs = fakeQueryCache([{ data: connectionData([target]) }])
    transactionMutationUpdaters.bulkDeleteTransactions({}, { input: { transactionIds: [target.id] } }, byIDs.cache)
    expect(byIDs.results[0]?.transactions.edges).toEqual([])

    const emptyIDs = fakeQueryCache([])
    transactionMutationUpdaters.bulkDeleteTransactions({}, { input: { transactionIds: [] } }, emptyIDs.cache)
    expect(emptyIDs.invalidate).toHaveBeenCalledWith('Query', 'transactions')

    const noInput = fakeQueryCache([])
    transactionMutationUpdaters.bulkDeleteTransactions({}, {}, noInput.cache)
    expect(noInput.invalidate).toHaveBeenCalledWith('Query', 'transactions')
  })
})
