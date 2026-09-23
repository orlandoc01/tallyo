import { ArrowUpRight } from 'lucide-react'
import { Navigate, useParams } from 'react-router'
import { ButtonLink } from '../components/common/Button'
import { Card } from '../components/common/FormControls'
import { PillTabs, type PillTab } from '../components/common/PillTabs'
import { ConnectionReviewQueue } from '../components/institutions/ConnectionReviewQueue'
import { UncategorizedQueue } from '../components/transactions/UncategorizedQueue'
import { AssetReviewQueue } from '../components/wealth/AssetReviewQueue'
import { BalanceReviewQueue } from '../components/wealth/BalanceReviewQueue'
import { useAuth } from '../auth/useAuth'
import { useIsMobile } from '../hooks/useIsMobile'
import { usePermissions } from '../hooks/usePermissions'
import { useReviewStatus } from '../hooks/useReviewStatus'

type ReviewTab = 'accounts' | 'assets' | 'balances' | 'transactions'

const tabLabels: Record<ReviewTab, string> = { transactions: 'Transactions', accounts: 'Accounts', balances: 'Balances', assets: 'Assets' }
const reviewTabs = Object.keys(tabLabels) as ReviewTab[]

export function ReviewPage() {
  const { tab: tabParam, asset_id: assetId } = useParams()
  const { disableTransactionTracking, disableWealthTracking } = useAuth()
  const { canRead, canWrite } = usePermissions()
  const isMobile = useIsMobile()
  const canReviewTransactions = canWrite('transactions') && !disableTransactionTracking
  const canWriteAccounts = canWrite('accounts')
  const canReviewBalances = canWrite('wealth') && !disableWealthTracking
  const canReviewAssets = canWrite('assets') && !disableWealthTracking
  const enabledTabs: Record<ReviewTab, boolean> = {
    transactions: canReviewTransactions,
    accounts: canWriteAccounts,
    balances: canReviewBalances,
    assets: canReviewAssets,
  }
  const { counts, refetchTransactions } = useReviewStatus({
    transactions: canReviewTransactions,
    accounts: canWriteAccounts,
    balances: canReviewBalances,
    assets: canReviewAssets,
  })
  const badges: Record<ReviewTab, number> = {
    transactions: counts.transactions,
    accounts: counts.connections,
    balances: counts.balances,
    assets: counts.assets,
  }
  const visibleTabs = reviewTabs.filter((candidate) => enabledTabs[candidate])
  const requestedTab = tabParam ?? (assetId ? 'assets' : undefined)
  const tab = visibleTabs.find((candidate) => candidate === requestedTab)

  if (visibleTabs.length === 0) return <Navigate replace to="/" />
  if (!tab) return <Navigate replace to={`/review/${visibleTabs[0]}`} />

  const tabs: PillTab<ReviewTab>[] = visibleTabs.map((value) => ({
    value,
    to: `/review/${value}`,
    label: isMobile ? <span className="truncate text-xs">{tabLabels[value]}</span> : tabLabels[value],
    badge: badges[value] > 0 ? badges[value] : undefined,
  }))
  const configureLlm = tab === 'transactions' && canRead('settings') ? (
    <ButtonLink aria-label="Open LLM categorization settings" size={isMobile ? 'sm' : 'md'} to="/settings/ai-integration" variant="secondary">
      Configure LLM
      <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
    </ButtonLink>
  ) : null

  return (
    <Card padded>
      <h1 className="sr-only">Review</h1>
      {isMobile ? (
        <>
          <PillTabs ariaLabel="Review sections" fitContent tabs={tabs} value={tab} variant="track" />
          {configureLlm ? <div className="mt-3 flex justify-end">{configureLlm}</div> : null}
        </>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <PillTabs ariaLabel="Review sections" tabs={tabs} value={tab} />
          {configureLlm}
        </div>
      )}
      <div className="mt-4 lg:mt-5">
        {tab === 'assets' ? <AssetReviewQueue /> : null}
        {tab === 'balances' ? <BalanceReviewQueue /> : null}
        {tab === 'accounts' ? <ConnectionReviewQueue /> : null}
        {tab === 'transactions' ? <UncategorizedQueue onReviewed={refetchTransactions} /> : null}
      </div>
    </Card>
  )
}
