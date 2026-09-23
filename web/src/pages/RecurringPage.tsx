import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from 'urql'
import { PageHeader } from '../components/common/PageHeader'
import { QueryGate } from '../components/common/QueryGate'
import { RecurringCadenceCard, RecurringStatsCard } from '../components/transactions/RecurringCards'
import { groupByCadence, recurringStats } from '../components/transactions/recurringCadence'
import { RECURRING_CHARGES_QUERY } from '../graphql/queries'
import type { RecurringCharge } from '../types/graphql'

export function RecurringPage() {
  const navigate = useNavigate()
  const [{ data, fetching, error }, reexecuteQuery] = useQuery<{ recurringCharges: { items: RecurringCharge[] } }>({ query: RECURRING_CHARGES_QUERY })
  const charges = useMemo(() => (data?.recurringCharges.items ?? []).filter((charge) => charge.isActive), [data])
  const groups = useMemo(() => groupByCadence(charges), [charges])
  const stats = useMemo(() => recurringStats(charges, new Date()), [charges])

  function openTransactions(charge: RecurringCharge) {
    navigate(`/transactions?${new URLSearchParams({ merchant_prefix: charge.merchantName })}`)
  }

  return (
    <div className="space-y-3">
      <PageHeader title="Recurring" />
      <QueryGate
        data={data}
        empty={charges.length === 0}
        emptyTitle="No recurring charges detected"
        error={error}
        errorPrefix="Failed to load recurring charges"
        fetching={fetching}
        onRetry={() => reexecuteQuery({ requestPolicy: 'network-only' })}
      >
        <RecurringStatsCard stats={stats} />
        {groups.map((group) => <RecurringCadenceCard group={group} key={group.label} onSelect={openTransactions} />)}
      </QueryGate>
    </div>
  )
}
