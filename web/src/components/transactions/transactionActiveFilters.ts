import type { Account, Category, Owner, Tag, TransactionsFilter } from '../../types/graphql'
import { accountDisplayLabel } from '../../utils/accounts'
import { amountSummary, dateRangeSummary, withAmountMode } from './transactionFilterPresets'

export interface FilterLookups {
  accounts: Account[]
  categories: Category[]
  owners: Owner[]
  tags?: Tag[]
}

export interface ActiveFilterPillModel {
  key: string
  kind: string
  value: string
  remove: (filter: TransactionsFilter) => TransactionsFilter
}

type IdField = 'categoryIds' | 'accountIds' | 'ownerIds' | 'tagIds'

function without(ids: string[] | null | undefined, id: string) {
  const next = (ids ?? []).filter((item) => item !== id)
  return next.length ? next : undefined
}

function idPills<T extends { id: string }>(kind: string, field: IdField, ids: string[] | null | undefined, items: T[], label: (item: T) => string): ActiveFilterPillModel[] {
  return (ids ?? []).map((id) => {
    const item = items.find((candidate) => candidate.id === id)
    return {
      key: `${field}:${id}`,
      kind,
      value: item ? label(item) : id,
      remove: (filter) => ({ ...filter, [field]: without(filter[field], id) }),
    }
  })
}

function flagPill(key: string, kind: string, value: string, remove: (filter: TransactionsFilter) => TransactionsFilter): ActiveFilterPillModel {
  return { key, kind, value, remove }
}

export function activeFilterPills(filter: TransactionsFilter, lookups: FilterLookups, now: Date, dateValue = dateRangeSummary(filter, now)): ActiveFilterPillModel[] {
  const date = dateValue
  const amount = amountSummary(filter)
  return [
    ...idPills('Category', 'categoryIds', filter.categoryIds, lookups.categories, (category) => `${category.emoji} ${category.name}`),
    ...idPills('Account', 'accountIds', filter.accountIds, lookups.accounts, accountDisplayLabel),
    ...idPills('Owner', 'ownerIds', filter.ownerIds, lookups.owners, (owner) => owner.name),
    ...idPills('Tag', 'tagIds', filter.tagIds, lookups.tags ?? [], (tag) => tag.name),
    ...(filter.untagged ? [flagPill('untagged', 'Tag', 'Untagged', (next) => ({ ...next, untagged: undefined }))] : []),
    ...(date ? [flagPill('date', 'Date', date, (next) => ({ ...next, datetimeRange: undefined }))] : []),
    ...(amount ? [flagPill('amount', 'Amount', amount, (next) => ({ ...withAmountMode(next, 'both'), amountMin: undefined, amountMax: undefined, exactAmount: undefined }))] : []),
    ...(filter.merchantPrefix ? [flagPill('merchant', 'Merchant', filter.merchantPrefix, (next) => ({ ...next, merchantPrefix: undefined }))] : []),
    ...(filter.originalPrefix ? [flagPill('original', 'Original', filter.originalPrefix, (next) => ({ ...next, originalPrefix: undefined }))] : []),
    ...(filter.isHidden !== false ? [flagPill('hidden', 'Hidden', 'Shown', (next) => ({ ...next, isHidden: false }))] : []),
    ...(filter.excludeTransfers ? [flagPill('transfers', 'Transfers', 'Excluded', (next) => ({ ...next, excludeTransfers: undefined }))] : []),
  ]
}
