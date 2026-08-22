import type { Account, Asset, NetWorthInput, NetWorthPoint, NetWorthReport } from '../types/graphql'
import { accountIdsForAccountGroupIds, ASSET_ACCOUNT_GROUPS, type AccountGroupId } from './accountGroups'

interface NetWorthChange {
  changeUSD: number
  changePct: number
}

/**
 * Computes the net-worth change over the selected range by comparing the current
 * net worth against the first point of the historical series for that range.
 *
 * The `netWorth` query is range-agnostic, so the change must be derived from the
 * `historicalNetWorth` series (which is driven by the selected range). Returns a
 * zero change when there is no historical data to compare against. The percentage
 * is relative to the magnitude of the starting value to stay meaningful when net
 * worth is negative.
 */
export function netWorthChangeOverRange(currentNetWorthUSD: number, series?: NetWorthPoint[]): NetWorthChange {
  const start = series?.[0]?.netWorthUSD
  if (start === undefined) {
    return { changeUSD: 0, changePct: 0 }
  }
  const changeUSD = currentNetWorthUSD - start
  const changePct = start === 0 ? 0 : (changeUSD / Math.abs(start)) * 100
  return { changeUSD, changePct }
}

export function netWorthInputFromFilters(ownerIds: string[], accountIds: string[]): NetWorthInput {
  return {
    ...(ownerIds.length ? { ownerIds } : {}),
    ...(accountIds.length ? { accountIds } : {}),
  }
}

export function hasNetWorthFilters(input: NetWorthInput) {
  return Boolean(input.ownerIds?.length || input.accountIds?.length)
}

export function assetFromNetWorthReport(report: NetWorthReport, assetID: string): Asset | null {
  for (const group of report.classifierBreakdown) {
    const holding = group.holdings.find((item) => item.asset.id === assetID)
    if (holding) return holding.asset
  }
  return null
}

// Every account appearing in the report's holdings or liabilities, deduplicated.
// A rollup's per-account holdings are null when the caller lacks read:holdings
// ("details unavailable"), not an empty account list — skip it rather than
// treating it as zero accounts.
export function accountsFromNetWorthReport(report: NetWorthReport): Account[] {
  const accountsById = new Map<string, Account>()
  for (const group of report.classifierBreakdown) {
    for (const rollup of group.holdings) {
      for (const holding of rollup.holdings ?? []) {
        accountsById.set(holding.account.id, holding.account)
      }
    }
  }
  for (const liability of report.liabilityBreakdown) {
    for (const account of liability.accounts) {
      accountsById.set(account.id, account)
    }
  }
  return [...accountsById.values()]
}

// Account groups whose member accounts are all selected — used to reflect
// account-level selections back onto the group toggles.
export function accountGroupIdsFromAccountIds(accounts: Account[], accountIds: string[]): AccountGroupId[] {
  const selected = new Set(accountIds)
  return ASSET_ACCOUNT_GROUPS.flatMap((group) => {
    const groupAccountIds = accountIdsForAccountGroupIds(accounts, [group.id])
    return groupAccountIds.length > 0 && groupAccountIds.every((accountId) => selected.has(accountId)) ? [group.id] : []
  })
}
