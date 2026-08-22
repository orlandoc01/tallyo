import { BarChart3, ClipboardCheck, CreditCard, Landmark, PieChart, Repeat2, Target, TrendingUp, WalletCards } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { currentBudgetPath } from '../utils/dates'

export type NavItemId =
  | 'expenses'
  | 'net-worth'
  | 'portfolio'
  | 'cash-flow'
  | 'transactions'
  | 'review'
  | 'recurring'
  | 'accounts'
  | 'budgets'

export interface NavItemDef {
  id: NavItemId
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  requiresWrite?: string
  requiresAnyWrite?: string[]
  requiresRead?: string
  feature?: 'transactions' | 'wealth'
}

export const MAX_NAVBAR_ITEMS = 4

export const ALL_NAV_ITEMS: NavItemDef[] = [
  { id: 'net-worth', to: '/net-worth', label: 'Net Worth', icon: TrendingUp, requiresRead: 'wealth', feature: 'wealth' },
  { id: 'portfolio', to: '/portfolio', label: 'Portfolio', icon: PieChart, requiresRead: 'portfolio', feature: 'wealth' },
  { id: 'expenses', to: '/expenses/breakdown', label: 'Expenses', icon: BarChart3, requiresRead: 'spending', feature: 'transactions' },
  { id: 'cash-flow', to: '/cash-flow', label: 'Cash Flow', icon: WalletCards, requiresRead: 'cashflow', feature: 'transactions' },
  { id: 'budgets', to: currentBudgetPath(), label: 'Budget', icon: Target, requiresRead: 'budgets', feature: 'transactions' },
  { id: 'transactions', to: '/transactions', label: 'Transactions', icon: CreditCard, requiresRead: 'transactions', feature: 'transactions' },
  { id: 'review', to: '/review/transactions', label: 'Review', icon: ClipboardCheck, requiresAnyWrite: ['transactions', 'accounts', 'wealth', 'assets'] },
  { id: 'recurring', to: '/recurring', label: 'Recurring', icon: Repeat2, requiresRead: 'transactions', feature: 'transactions' },
  { id: 'accounts', to: '/accounts', label: 'Accounts', icon: Landmark, requiresRead: 'accounts' },
]

export function navItemVisible(item: NavItemDef, disableTransactionTracking: boolean, disableWealthTracking: boolean) {
  if (item.feature === 'transactions' && disableTransactionTracking) return false
  if (item.feature === 'wealth' && disableWealthTracking) return false
  return true
}

export function navItemAllowed(item: NavItemDef, canRead: (resource: string) => boolean, canWrite: (resource: string) => boolean) {
  if (item.requiresRead && !canRead(item.requiresRead)) return false
  if (item.requiresWrite && !canWrite(item.requiresWrite)) return false
  if (item.requiresAnyWrite && !item.requiresAnyWrite.some((resource) => canWrite(resource))) return false
  return true
}

export function reviewRoute(disableTransactionTracking: boolean, canWriteTransactions = true, canWriteAccounts = true, canReviewBalances = true, canReviewAssets = true) {
  if (!disableTransactionTracking && canWriteTransactions) return '/review/transactions'
  if (canWriteAccounts) return '/review/accounts'
  if (canReviewBalances) return '/review/balances'
  if (canReviewAssets) return '/review/assets'
  return '/'
}
