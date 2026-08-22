import type { TransactionsFilter } from '../types/graphql'
import { getApiBaseUrl } from './apiUrl'
import { authorizedFetch } from '../auth/tokenStore'

export async function downloadTransactionsCsv(filter: TransactionsFilter): Promise<void> {
  const params = filterToParams(filter)
  const qs = params.size > 0 ? '?' + params.toString() : ''
  const response = await authorizedFetch(`${getApiBaseUrl()}/transactions/export${qs}`)
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `Export failed (${response.status})`)
  }
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(objectUrl)
}

function filterToParams(filter: TransactionsFilter): URLSearchParams {
  const p = new URLSearchParams()
  if (filter.datetimeRange?.from) p.set('datetimeFrom', filter.datetimeRange.from)
  if (filter.datetimeRange?.to) p.set('datetimeTo', filter.datetimeRange.to)
  if (filter.categoryIds?.length) p.set('categoryIds', filter.categoryIds.join(','))
  if (filter.accountIds?.length) p.set('accountIds', filter.accountIds.join(','))
  if (filter.ownerIds?.length) p.set('ownerIds', filter.ownerIds.join(','))
  if (filter.isReviewed != null) p.set('isReviewed', String(filter.isReviewed))
  if (filter.isRecurring != null) p.set('isRecurring', String(filter.isRecurring))
  if (filter.isPending != null) p.set('isPending', String(filter.isPending))
  if (filter.isHidden != null) p.set('isHidden', String(filter.isHidden))
  if (filter.merchantPrefix) p.set('merchantPrefix', filter.merchantPrefix)
  if (filter.originalPrefix) p.set('originalPrefix', filter.originalPrefix)
  if (filter.search) p.set('search', filter.search)
  if (filter.excludeTransfers != null) p.set('excludeTransfers', String(filter.excludeTransfers))
  if (filter.excludeIncome != null) p.set('excludeIncome', String(filter.excludeIncome))
  if (filter.amountMin != null) p.set('amountMin', String(filter.amountMin))
  if (filter.amountMax != null) p.set('amountMax', String(filter.amountMax))
  if (filter.exactAmount != null) p.set('exactAmount', String(filter.exactAmount))
  return p
}
