import { stringifyVariables } from '@urql/core'
import type { Cache, FieldArgs, Resolver } from '@urql/exchange-graphcache'
import type { Transaction, TransactionConnection, TransactionsFilter, TransactionsInput } from '../../types/graphql'
import { TRANSACTIONS_QUERY } from '../queries'
import { forEachCachedQuery, invalidateRoot, invalidateRoots, TRANSACTION_RECURRING_ROOTS, TRANSACTION_ROOTS, type MutationUpdaters, type QueryCache } from './shared'

type TransactionQueryData = {
  transactions: TransactionConnection
}

type CachedPageInfo = {
  __typename: 'PageInfo'
  hasNextPage: boolean
  hasPreviousPage: boolean
  startCursor: string | null
  endCursor: string | null
}

type CachedTransactionPage = {
  __typename: string
  edges: string[]
  pageInfo: CachedPageInfo
  totalCount: number | null
}

function ensureKey(value: unknown) {
  return typeof value === 'string' ? value : null
}

function transactionInputFromArgs(args: FieldArgs) {
  if (!args || typeof args !== 'object') return undefined
  return (args as { input?: TransactionsInput | null }).input
}

function transactionPaginationIdentity(args: FieldArgs) {
  const input = transactionInputFromArgs(args)
  if (!input || typeof input !== 'object') return { input }

  const unpaginatedInput: TransactionsInput = { ...input }
  delete unpaginatedInput.first
  delete unpaginatedInput.after
  delete unpaginatedInput.last
  delete unpaginatedInput.before
  return { input: unpaginatedInput }
}

function transactionPaginationArgsMatch(fieldArgs: FieldArgs, cachedArgs: FieldArgs) {
  return stringifyVariables(transactionPaginationIdentity(fieldArgs)) === stringifyVariables(transactionPaginationIdentity(cachedArgs))
}

function edgeCursor(cache: Cache, edgeKey: string | undefined) {
  return edgeKey ? ensureKey(cache.resolve(edgeKey, 'cursor')) : null
}

function cachedTransactionPage(cache: Cache, entityKey: string, fieldKey: string): CachedTransactionPage | null {
  const connectionKey = ensureKey(cache.resolve(entityKey, fieldKey))
  if (!connectionKey) return null

  const typename = ensureKey(cache.resolve(connectionKey, '__typename'))
  if (!typename) return null

  const edgeValue = cache.resolve(connectionKey, 'edges')
  const edges = Array.isArray(edgeValue) ? edgeValue.filter((edge): edge is string => typeof edge === 'string') : []
  const pageInfoKey = ensureKey(cache.resolve(connectionKey, 'pageInfo'))
  const totalCount = cache.resolve(connectionKey, 'totalCount')

  const pageInfo: CachedPageInfo = {
    __typename: 'PageInfo',
    hasNextPage: false,
    hasPreviousPage: false,
    startCursor: edgeCursor(cache, edges[0]),
    endCursor: edgeCursor(cache, edges[edges.length - 1]),
  }

  if (pageInfoKey) {
    const hasNextPage = cache.resolve(pageInfoKey, 'hasNextPage')
    const hasPreviousPage = cache.resolve(pageInfoKey, 'hasPreviousPage')
    pageInfo.hasNextPage = typeof hasNextPage === 'boolean' ? hasNextPage : pageInfo.hasNextPage
    pageInfo.hasPreviousPage = typeof hasPreviousPage === 'boolean' ? hasPreviousPage : pageInfo.hasPreviousPage
    pageInfo.startCursor = ensureKey(cache.resolve(pageInfoKey, 'startCursor')) ?? pageInfo.startCursor
    pageInfo.endCursor = ensureKey(cache.resolve(pageInfoKey, 'endCursor')) ?? pageInfo.endCursor
  }

  return {
    __typename: typename,
    edges,
    pageInfo,
    totalCount: typeof totalCount === 'number' ? totalCount : null,
  }
}

function concatTransactionEdges(cache: Cache, leftEdges: string[], rightEdges: string[]) {
  const nodeKeys = new Set<string>()
  for (const edge of leftEdges) {
    const nodeKey = ensureKey(cache.resolve(edge, 'node'))
    if (nodeKey) nodeKeys.add(nodeKey)
  }

  const edges = [...leftEdges]
  for (const edge of rightEdges) {
    const nodeKey = ensureKey(cache.resolve(edge, 'node'))
    if (!nodeKey || nodeKeys.has(nodeKey)) continue
    nodeKeys.add(nodeKey)
    edges.push(edge)
  }
  return edges
}

export function transactionsPagination(): Resolver {
  return (_parent, fieldArgs, cache, info) => {
    const fields = cache.inspectFields(info.parentKey).filter((field) => field.fieldName === info.fieldName)
    if (fields.length === 0) return undefined

    let typename: string | null = null
    let edges: string[] = []
    let pageInfo: CachedPageInfo = {
      __typename: 'PageInfo',
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: null,
      endCursor: null,
    }
    let totalCount: number | null = null

    for (const field of fields) {
      if (!transactionPaginationArgsMatch(fieldArgs, field.arguments)) continue

      const page = cachedTransactionPage(cache, info.parentKey, field.fieldKey)
      if (!page) continue

      const input = transactionInputFromArgs(field.arguments)
      const isBackwardPage = !!input?.before || typeof input?.last === 'number'
      if (isBackwardPage) {
        edges = concatTransactionEdges(cache, page.edges, edges)
        pageInfo = {
          ...pageInfo,
          startCursor: page.pageInfo.startCursor,
          hasPreviousPage: page.pageInfo.hasPreviousPage,
        }
      } else {
        edges = concatTransactionEdges(cache, edges, page.edges)
        pageInfo = {
          ...pageInfo,
          startCursor: pageInfo.startCursor ?? page.pageInfo.startCursor,
          endCursor: page.pageInfo.endCursor,
          hasNextPage: page.pageInfo.hasNextPage,
          hasPreviousPage: pageInfo.hasPreviousPage || page.pageInfo.hasPreviousPage,
        }
      }

      typename = page.__typename
      if (page.totalCount !== null) totalCount = totalCount === null ? page.totalCount : Math.min(totalCount, page.totalCount)
    }

    if (!typename) return undefined

    if (!ensureKey(cache.resolve(info.parentKey, info.fieldName, fieldArgs))) {
      info.partial = true
    }

    return {
      __typename: typename,
      edges,
      pageInfo,
      totalCount: totalCount ?? edges.length,
    }
  }
}

function textMatchesContains(value: string | null | undefined, search: string) {
  const normalized = search.trim().toLowerCase()
  return normalized === '' || (value?.toLowerCase().includes(normalized) ?? false)
}

function searchTokens(value: string | null | undefined) {
  return value?.toLowerCase().match(/[a-z0-9_]+/g) ?? []
}

function transactionMatchesSearch(transaction: Transaction, search: string) {
  const terms = searchTokens(search)
  if (terms.length === 0) return true

  const fieldTokens = [
    ...searchTokens(transaction.merchantName),
    ...searchTokens(transaction.originalName),
    ...searchTokens(transaction.notes),
  ]
  return terms.every((term) => fieldTokens.some((token) => token.startsWith(term)))
}

export function transactionMatchesFilter(transaction: Transaction, filter?: TransactionsFilter | null) {
  if (!filter) return true

  // Keep this predicate aligned with transactionFilterConditions in
  // server/internal/transactions/db/jet_transactions.go.
  const transactionTime = new Date(transaction.datetime).getTime()
  if (filter.datetimeRange?.from && transactionTime < new Date(filter.datetimeRange.from).getTime()) return false
  if (filter.datetimeRange?.to && transactionTime >= new Date(filter.datetimeRange.to).getTime()) return false
  if (filter.categoryIds?.length && !filter.categoryIds.includes(transaction.category.id)) return false
  if (filter.accountIds?.length && !filter.accountIds.includes(transaction.account.id)) return false
  if (filter.ownerIds?.length && !filter.ownerIds.includes(transaction.account.owner.id)) return false
  if (filter.isReviewed != null && transaction.isReviewed !== filter.isReviewed) return false
  if (filter.isRecurring != null && transaction.isRecurring !== filter.isRecurring) return false
  if (filter.isPending != null && transaction.pending !== filter.isPending) return false
  if (filter.isHidden != null && transaction.isHidden !== filter.isHidden) return false
  if (filter.merchantPrefix && !textMatchesContains(transaction.merchantName ?? transaction.originalName, filter.merchantPrefix)) return false
  if (filter.originalPrefix && !textMatchesContains(transaction.originalName, filter.originalPrefix)) return false
  if (filter.excludeTransfers && transaction.category.kind === 'TRANSFER') return false
  if (filter.excludeIncome && transaction.category.kind === 'INCOME') return false
  if (filter.amountMin != null && transaction.amount < filter.amountMin) return false
  if (filter.amountMax != null && transaction.amount > filter.amountMax) return false
  if (filter.exactAmount != null && transaction.amount !== filter.exactAmount) return false
  if (filter.tagIds?.length) {
    const transactionTagIds = new Set((transaction.tags ?? []).map((tag) => tag.id))
    if (!filter.tagIds.some((tagId) => transactionTagIds.has(tagId))) return false
  }
  if (filter.untagged && (transaction.tags?.length ?? 0) > 0) return false

  return true
}

function transactionMatchesInput(transaction: Transaction, input: unknown) {
  if (input === null || typeof input !== 'object') return true

  const transactionInput = input as TransactionsInput
  if (!transactionMatchesFilter(transaction, transactionInput.filter)) return false

  const search = transactionInput.filter?.search?.trim()
  if (!search) return true

  return transactionMatchesSearch(transaction, search)
}

export function updateTransactionInCachedConnections(cache: QueryCache, transaction: Transaction) {
  forEachCachedQuery<TransactionQueryData>(cache, 'transactions', TRANSACTIONS_QUERY, (data, input) => {
    if (!data?.transactions?.edges) return data

    const matchesInput = transactionMatchesInput(transaction, input)

    // We only patch existing edges. Newly matching rows and changed sort
    // positions need a server-issued cursor, so they wait for a refetch.
    let changed = false
    let removed = 0
    const nextEdges = data.transactions.edges.flatMap((edge) => {
      if (edge.node.id !== transaction.id) return [edge]
      changed = true
      if (!matchesInput) {
        removed += 1
        return []
      }
      return [{ ...edge, node: transaction }]
    })
    if (!changed) return data

    return {
      ...data,
      transactions: {
        ...data.transactions,
        edges: nextEdges,
        totalCount: Math.max(0, data.transactions.totalCount - removed),
      },
    }
  })
}

export function removeTransactionsFromCachedConnections(cache: QueryCache, transactionIds: string[]) {
  const ids = new Set(transactionIds)
  if (ids.size === 0) return

  forEachCachedQuery<TransactionQueryData>(cache, 'transactions', TRANSACTIONS_QUERY, (data) => {
    if (!data?.transactions?.edges) return data

    const nextEdges = data.transactions.edges.filter((edge) => !ids.has(edge.node.id))
    const removed = data.transactions.edges.length - nextEdges.length
    if (removed === 0) return data

    const firstCursor = nextEdges[0]?.cursor ?? null
    const lastCursor = nextEdges[nextEdges.length - 1]?.cursor ?? null
    return {
      ...data,
      transactions: {
        ...data.transactions,
        edges: nextEdges,
        totalCount: Math.max(0, data.transactions.totalCount - removed),
        pageInfo: {
          ...data.transactions.pageInfo,
          startCursor: firstCursor,
          endCursor: lastCursor,
        },
      },
    }
  })
}

export const transactionMutationUpdaters = {
  updateTransaction(result, args, cache) {
    const transaction = (result as { updateTransaction?: { transaction?: Transaction } }).updateTransaction?.transaction
    if (transaction) updateTransactionInCachedConnections(cache, transaction)

    const updates = (args.input as { updates?: { categoryId?: string; isHidden?: boolean; isRecurring?: boolean } } | undefined)?.updates
    if (!transaction && updates && ('categoryId' in updates || 'isHidden' in updates || 'isRecurring' in updates)) {
      invalidateRoot(cache, 'transactions')
    }
    invalidateRoots(cache, ...TRANSACTION_RECURRING_ROOTS)
  },
  bulkUpdateTransactions(result, _args, cache) {
    const transactions = (result as { bulkUpdateTransactions?: { transactions?: Transaction[] } }).bulkUpdateTransactions?.transactions
    if (transactions) {
      for (const transaction of transactions) updateTransactionInCachedConnections(cache, transaction)
    } else {
      invalidateRoot(cache, 'transactions')
    }
    invalidateRoots(cache, ...TRANSACTION_RECURRING_ROOTS)
  },
  createTransaction(_result, _args, cache) {
    invalidateRoots(cache, ...TRANSACTION_ROOTS)
  },
  reprocessUncategorizedTransactions(_result, _args, cache) {
    invalidateRoots(cache, ...TRANSACTION_ROOTS)
  },
  deleteTransaction(_result, args, cache) {
    const transactionId = typeof args.id === 'string' ? args.id : undefined
    if (transactionId) {
      removeTransactionsFromCachedConnections(cache, [transactionId])
    } else {
      invalidateRoot(cache, 'transactions')
    }
    invalidateRoots(cache, ...TRANSACTION_RECURRING_ROOTS)
  },
  bulkDeleteTransactions(_result, args, cache) {
    const input = args.input as { transactionIds?: string[] } | undefined
    if (input?.transactionIds?.length) {
      removeTransactionsFromCachedConnections(cache, input.transactionIds)
    } else {
      invalidateRoot(cache, 'transactions')
    }
    invalidateRoots(cache, ...TRANSACTION_RECURRING_ROOTS)
  },
} satisfies MutationUpdaters
