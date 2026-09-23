import { BarChart3, CreditCard, DollarSign, House, Landmark, Package, PiggyBank, Receipt, type LucideIcon } from 'lucide-react'
import type { Account, ClassifierBreakdown, LiabilityBreakdown, LiabilityCategory } from '../../types/graphql'
import { accountBalanceUSD, accountNetContributionUSD } from '../../utils/accounts'
import { accountMatchesAccountGroup, ASSET_ACCOUNT_GROUPS, type AccountGroupId } from '../../utils/accountGroups'
import { formatAccountType } from '../../utils/accountSubtypes'
import { formatCurrency, formatSignedCurrency } from '../../utils/currency'
import { formatRelativeTime, isSyncStale } from '../../utils/dates'

export interface SidebarGroup {
  id: string
  label: string
  accounts: Account[]
  total: number
  isLiability: boolean
  accountGroupId?: AccountGroupId
  icon: LucideIcon
}

const ASSET_GROUP_ICONS: Record<AccountGroupId, LucideIcon> = {
  DEPOSITS: Landmark,
  TAX_ADVANTAGED: PiggyBank,
  INVESTMENTS: BarChart3,
  REAL_ESTATE: House,
  CRYPTO_WALLETS: DollarSign,
  OTHER_ASSETS: Package,
}

const LIABILITY_ICONS: Record<LiabilityCategory, LucideIcon> = {
  CARD: CreditCard,
  MORTGAGE: House,
  LOAN: Receipt,
  OTHER: Package,
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

// Non-expandable fallback when the caller lacks read:holdings: one row per
// classifier showing its aggregate value, with no per-account rows.
function classifierGroups(breakdown: ClassifierBreakdown[]): SidebarGroup[] {
  return breakdown.map((group) => ({ id: group.classifier, label: group.label, accounts: [], total: group.valueUSD, isLiability: false, icon: Package }))
}

function assetGroups(accounts: Account[]): SidebarGroup[] {
  return ASSET_ACCOUNT_GROUPS
    .map(({ id, label }) => {
      const groupAccounts = accounts.filter((account) => accountMatchesAccountGroup(account, id))
      return {
        id,
        label,
        accounts: groupAccounts,
        total: groupAccounts.reduce((sum, account) => sum + (accountNetContributionUSD(account) ?? accountBalanceUSD(account) ?? 0), 0),
        isLiability: false,
        accountGroupId: id,
        icon: ASSET_GROUP_ICONS[id],
      }
    })
    .filter((group) => group.accounts.length > 0)
    .sort((a, b) => b.total - a.total)
}

function liabilityGroups(liabilityBreakdown: LiabilityBreakdown[]): SidebarGroup[] {
  return liabilityBreakdown.map((item) => ({
    id: item.category,
    label: item.label,
    accounts: item.balances.map((balance) => balance.account),
    total: -item.valueUSD,
    isLiability: true,
    icon: LIABILITY_ICONS[item.category],
  }))
}

export function sidebarGroups(breakdown: ClassifierBreakdown[], liabilityBreakdown: LiabilityBreakdown[], canReadHoldings: boolean): SidebarGroup[] {
  return [
    ...(canReadHoldings ? assetGroups(uniqueAssetAccounts(breakdown)) : classifierGroups(breakdown)),
    ...liabilityGroups(liabilityBreakdown),
  ]
}

export function accountInstitution(account: Account) {
  return account.connection?.name || (account.manual ? 'Manual' : account.subtype || formatAccountType(account.type))
}

export function filterSidebarGroups(groups: SidebarGroup[], query: string): SidebarGroup[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return groups
  return groups
    .map((group) => ({ ...group, accounts: group.accounts.filter((account) => `${account.name} ${accountInstitution(account)}`.toLowerCase().includes(normalized)) }))
    .filter((group) => group.accounts.length > 0)
}

export function accountRowAmount(account: Account, isLiability: boolean) {
  return isLiability
    ? formatSignedCurrency(-(accountBalanceUSD(account) ?? 0))
    : formatCurrency(accountNetContributionUSD(account) ?? accountBalanceUSD(account) ?? 0)
}

export function accountSyncStatus(account: Account, now = Date.now()): { text: string; stale: boolean } | null {
  if (account.connection?.isActive === false) return { text: `${account.lastSyncedAt ? formatRelativeTime(account.lastSyncedAt, now) : 'not synced'} · Reconnect`, stale: true }
  if (!account.lastSyncedAt) return null
  return { text: formatRelativeTime(account.lastSyncedAt, now), stale: isSyncStale(account.lastSyncedAt, now) }
}
