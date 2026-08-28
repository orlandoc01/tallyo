import { useState } from 'react'
import { OneLevelGroup, OneLevelGroupRow } from '../common/OneLevelGroup'
import { displayAmount } from './amountDisplay'
import { formatCurrency, formatSignedCurrency } from '../../utils/currency'
import { accountBalanceUSD, accountNetContributionUSD } from '../../utils/accounts'
import type { Account, ClassifierBreakdown, LiabilityBreakdown } from '../../types/graphql'
import { formatAccountType } from '../../utils/accountSubtypes'
import { accountMatchesAccountGroup, ASSET_ACCOUNT_GROUPS, type AccountGroupId } from '../../utils/accountGroups'
import { formatRelativeTime } from '../../utils/dates'

interface AccountGroup {
  id: string
  label: string
  accounts: Account[]
  total: number
  isLiability?: boolean
  accountGroupId?: AccountGroupId
}

function uniqueAssetAccounts(breakdown: ClassifierBreakdown[]): Account[] {
  const accounts = new Map<string, Account>()
  for (const group of breakdown) {
    for (const rollup of group.holdings) {
      for (const holding of rollup.holdings ?? []) {
        accounts.set(holding.account.id, holding.account)
      }
    }
  }
  return [...accounts.values()].sort((a, b) => (accountNetContributionUSD(b) ?? 0) - (accountNetContributionUSD(a) ?? 0))
}

// Non-expandable fallback when the caller lacks read:holdings: one bar per
// classifier showing its aggregate value, with no per-account rows.
function classifierGroups(breakdown: ClassifierBreakdown[]): AccountGroup[] {
  return breakdown.map((group) => ({ id: group.classifier, label: group.label, accounts: [], total: group.valueUSD }))
}

function assetGroups(accounts: Account[]): AccountGroup[] {
  return ASSET_ACCOUNT_GROUPS
    .map(({ id, label }) => {
      const groupAccounts = accounts.filter((account) => accountMatchesAccountGroup(account, id))
      return {
        id,
        label,
        accounts: groupAccounts,
        total: groupAccounts.reduce((sum, account) => sum + (accountNetContributionUSD(account) ?? accountBalanceUSD(account) ?? 0), 0),
        accountGroupId: id,
      }
    })
    .filter((group) => group.accounts.length > 0)
    .sort((a, b) => b.total - a.total)
}

function liabilityGroups(liabilityBreakdown: LiabilityBreakdown[]): AccountGroup[] {
  return liabilityBreakdown.map((item) => ({
    id: item.category,
    label: item.label,
    accounts: item.accounts,
    total: -item.valueUSD,
    isLiability: true,
  }))
}

export function AccountSidebar({
  netWorth,
  breakdown,
  liabilityBreakdown,
  onAccountClick,
  onAccountGroupClick,
  amountsHidden = false,
  className,
  heading = 'Net Worth',
  showSummary = true,
  selectedAccountGroupIds = [],
  selectedAccountIds = [],
  canReadHoldings = true,
}: {
  netWorth: number
  breakdown: ClassifierBreakdown[]
  liabilityBreakdown: LiabilityBreakdown[]
  onAccountClick?: (account: Account) => void
  onAccountGroupClick?: (accountGroupId: AccountGroupId | null, accountIds: string[]) => void
  amountsHidden?: boolean
  className?: string
  heading?: string
  showSummary?: boolean
  selectedAccountGroupIds?: AccountGroupId[]
  selectedAccountIds?: string[]
  canReadHoldings?: boolean
}) {
  const groups: AccountGroup[] = [
    ...(canReadHoldings ? assetGroups(uniqueAssetAccounts(breakdown)) : classifierGroups(breakdown)),
    ...liabilityGroups(liabilityBreakdown),
  ]
  const [open, setOpen] = useState<Record<string, boolean>>({})

  return (
    <aside className={className ?? 'hidden w-80 shrink-0 rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-none lg:block'} data-account-sidebar>
      <p className="text-sm font-semibold text-neutral-500">{heading}</p>
      {showSummary ? <p className="mt-2 text-3xl font-bold text-neutral-950 dark:text-neutral-100">{displayAmount(amountsHidden, formatCurrency(netWorth))}</p> : null}
      <div className="mt-4 space-y-2">
        {groups.map((group) => {
          const expanded = open[group.id] ?? false
          const canExpand = group.accounts.length > 0
          const groupAccountIds = group.accounts.map((account) => account.id)
          const selected = group.accountGroupId ? selectedAccountGroupIds.includes(group.accountGroupId) : groupAccountIds.length > 0 && groupAccountIds.every((accountId) => selectedAccountIds.includes(accountId))
          return (
            <OneLevelGroup
              expanded={expanded}
              expandable={canExpand}
              expandButtonLabel={`${expanded ? 'Collapse' : 'Expand'} ${group.label} accounts`}
              header={(
                <>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{group.label}</span>
                    {canExpand ? <span className="block text-xs text-neutral-500 dark:text-neutral-400">{group.accounts.length} accounts</span> : null}
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-neutral-950 dark:text-neutral-100">
                    {displayAmount(amountsHidden, group.isLiability ? formatSignedCurrency(group.total) : formatCurrency(group.total))}
                  </span>
                </>
              )}
              headerActive={selected}
              headerPressed={selected}
              key={group.id}
              onHeaderClick={onAccountGroupClick && groupAccountIds.length > 0 ? () => onAccountGroupClick(group.accountGroupId ?? null, groupAccountIds) : undefined}
              onToggle={() => setOpen((current) => ({ ...current, [group.id]: !expanded }))}
            >
              {group.accounts.map((account) => {
                const accountKind = account.subtype || formatAccountType(account.type)
                const institution = account.connection?.name || (account.manual ? 'Manual' : accountKind)
                const amount = group.isLiability
                  ? formatSignedCurrency(-(accountBalanceUSD(account) ?? 0))
                  : formatCurrency(accountNetContributionUSD(account) ?? accountBalanceUSD(account) ?? 0)
                const selectedAccount = selectedAccountIds.includes(account.id)
                return (
                  <OneLevelGroupRow
                    ariaLabel={`Open details for ${account.name}`}
                    key={account.id}
                    onClick={onAccountClick ? () => onAccountClick(account) : undefined}
                    pressed={selectedAccount}
                    selected={selectedAccount}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{account.name}</p>
                        <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{institution}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold text-neutral-950 dark:text-neutral-100">{displayAmount(amountsHidden, amount)}</p>
                        {account.lastSyncedAt ? <p className="text-[11px] text-neutral-500">{formatRelativeTime(account.lastSyncedAt)}</p> : null}
                      </div>
                    </div>
                  </OneLevelGroupRow>
                )
              })}
            </OneLevelGroup>
          )
        })}
        {groups.length === 0 ? (
          <div className="rounded-2xl border border-neutral-100 bg-neutral-50 p-3 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/70 dark:text-neutral-400">No visible accounts with balances.</div>
        ) : null}
      </div>
    </aside>
  )
}
