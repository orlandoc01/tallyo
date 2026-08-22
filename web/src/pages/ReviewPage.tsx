import { Navigate, useParams } from 'react-router'
import { SegmentedNavTabs, type SegmentedNavTab } from '../components/common/SegmentedNavTabs'
import { ConnectionReviewQueue } from '../components/institutions/ConnectionReviewQueue'
import { UncategorizedQueue } from '../components/transactions/UncategorizedQueue'
import { AssetReviewQueue } from '../components/wealth/AssetReviewQueue'
import { BalanceReviewQueue } from '../components/wealth/BalanceReviewQueue'
import { useAuth } from '../auth/useAuth'
import { usePermissions } from '../hooks/usePermissions'
import { useReviewStatus } from '../hooks/useReviewStatus'

type ReviewTab = 'accounts' | 'assets' | 'balances' | 'transactions'
const reviewTabs = ['transactions', 'accounts', 'balances', 'assets'] satisfies ReviewTab[]

export function ReviewPage() {
  const { tab: tabParam, asset_id: assetId } = useParams()
  const { disableTransactionTracking, disableWealthTracking } = useAuth()
  const { canWrite } = usePermissions()
  const canWriteTransactions = canWrite('transactions')
  const canWriteAccounts = canWrite('accounts')
  const canWriteWealth = canWrite('wealth')
  const canWriteAssets = canWrite('assets')
  const canReviewBalances = canWriteWealth && !disableWealthTracking
  const canReviewAssets = canWriteAssets && !disableWealthTracking
  const { counts } = useReviewStatus({
    transactions: canWriteTransactions && !disableTransactionTracking,
    accounts: canWriteAccounts,
    balances: canReviewBalances,
    assets: canReviewAssets,
  })
  const visibleTabs = reviewTabs.filter((candidate) => {
    if (candidate === 'transactions') return canWriteTransactions && !disableTransactionTracking
    if (candidate === 'assets') return canReviewAssets
    if (candidate === 'balances') return canReviewBalances
    return canWriteAccounts
  })
  const requestedTab = tabParam ?? (assetId ? 'assets' : undefined)
  const tab = visibleTabs.find((candidate) => candidate === requestedTab)

  if (visibleTabs.length === 0) {
    return <Navigate replace to="/" />
  }

  if (!tab) {
    return <Navigate replace to={`/review/${visibleTabs[0]}`} />
  }

  const tabItems: SegmentedNavTab[] = []
  if (canWriteTransactions && !disableTransactionTracking) {
    tabItems.push({
      to: '/review/transactions',
      children: <>Transactions{counts.transactions > 0 ? <ReviewBadge /> : null}</>,
    })
  }
  if (canWriteAccounts) {
    tabItems.push({
      to: '/review/accounts',
      children: <>Accounts{counts.connections > 0 ? <ReviewBadge count={counts.connections} /> : null}</>,
    })
  }
  if (canReviewBalances) {
    tabItems.push({
      to: '/review/balances',
      children: <>Balances{counts.balances > 0 ? <ReviewBadge count={counts.balances} /> : null}</>,
    })
  }
  if (canReviewAssets) {
    tabItems.push({
      to: '/review/assets',
      children: <>Assets{counts.assets > 0 ? <ReviewBadge count={counts.assets} /> : null}</>,
    })
  }

  return (
    <div className="space-y-6">
      <SegmentedNavTabs ariaLabel="Review sections" items={tabItems} />
      {tab === 'assets' ? <AssetReviewQueue /> : null}
      {tab === 'balances' ? <BalanceReviewQueue /> : null}
      {tab === 'accounts' ? <ConnectionReviewQueue /> : null}
      {tab === 'transactions' ? <UncategorizedQueue /> : null}
    </div>
  )
}

function ReviewBadge({ count }: { count?: number }) {
  return (
    <span aria-hidden className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 text-xs font-bold text-amber-800">
      {count ?? '!'}
    </span>
  )
}
