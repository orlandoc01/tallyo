// Shared graphcache helpers used across the per-domain cache update modules.

import type { Cache } from '@urql/exchange-graphcache'

export type QueryCache = {
  inspectFields(entity: string): Array<{ fieldName: string; arguments?: Record<string, unknown> | null }>
  updateQuery<T>(input: { query: unknown; variables?: Record<string, unknown> }, updater: (data: T | null) => T | null): void
}

export type InvalidatingCache = QueryCache & {
  invalidate(entity: string, fieldName?: string, args?: Record<string, unknown> | null): void
}

export type MutationUpdater = (result: unknown, args: Record<string, unknown>, cache: Cache) => void

export type MutationUpdaters = Record<string, MutationUpdater>

type ListQueryData<T> = Record<string, { items: T[] } | undefined>

export const TRANSACTION_DERIVED_ROOTS = ['transactionsSummary', 'transactionsStagedForCategorization', 'spendingByCategory', 'cashFlow'] as const
export const TRANSACTION_ROOTS = ['transactions', ...TRANSACTION_DERIVED_ROOTS] as const
export const TRANSACTION_RECURRING_ROOTS = [...TRANSACTION_DERIVED_ROOTS, 'recurringCharges'] as const
export const ACCOUNT_ROOTS = ['accounts', 'connections'] as const
export const ACCOUNT_DERIVED_ROOTS = [...ACCOUNT_ROOTS, 'netWorth'] as const
export const LINKED_ACCOUNT_ROOTS = ['plaidItems', ...ACCOUNT_ROOTS] as const
export const WEALTH_RESOLUTION_ROOTS = [
  'balanceSnapshotReviews',
  'accounts',
  'account',
  'accountSnapshot',
  'accountSnapshots',
  'assets',
  'netWorth',
  'historicalNetWorth',
  'analysis',
  'node',
] as const

export function invalidateRoot(cache: InvalidatingCache, fieldName: string) {
  cache.invalidate('Query', fieldName)
}

export function invalidateRoots(cache: InvalidatingCache, ...fieldNames: readonly string[]) {
  for (const fieldName of fieldNames) invalidateRoot(cache, fieldName)
}

function cachedQueryInput(field: { arguments?: Record<string, unknown> | null }) {
  const args = field.arguments as { input?: unknown } | null | undefined
  return args?.input
}

function queryVariablesForInput(input: unknown) {
  return input === undefined ? undefined : { input }
}

// Runs `update` against every cached instance of a root list query (one per
// distinct input). The cached query's input is passed through so updaters can
// decide whether an entity still belongs in that variant of the list.
export function forEachCachedQuery<TData>(
  cache: QueryCache,
  fieldName: string,
  query: unknown,
  update: (data: TData | null, input: unknown) => TData | null,
) {
  for (const field of cache.inspectFields('Query')) {
    if (field.fieldName !== fieldName) continue
    const input = cachedQueryInput(field)
    cache.updateQuery<TData>({ query, variables: queryVariablesForInput(input) }, (data) => update(data, input))
  }
}

export function mapCachedList<T>(cache: QueryCache, root: string, query: unknown, map: (items: T[]) => T[]) {
  cache.updateQuery<ListQueryData<T>>({ query }, (data) => {
    const list = data?.[root]
    if (!list?.items) return data
    return { ...data, [root]: { ...list, items: map(list.items) } }
  })
}

export function mapEachCachedList<T>(cache: QueryCache, root: string, query: unknown, map: (items: T[], input: unknown) => T[]) {
  forEachCachedQuery<ListQueryData<T>>(cache, root, query, (data, input) => {
    const list = data?.[root]
    if (!list?.items) return data
    return { ...data, [root]: { ...list, items: map(list.items, input) } }
  })
}

export function replaceOrAppendByID<T extends { id: string }>(items: T[], item: T) {
  const index = items.findIndex((existing) => existing.id === item.id)
  if (index === -1) return [...items, item]
  const next = [...items]
  next[index] = item
  return next
}
