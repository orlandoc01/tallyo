import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from 'urql'
import { PageHeader } from '../components/common/PageHeader'
import { QueryGate } from '../components/common/QueryGate'
import { RecurringCadenceCard, RecurringStatsCard } from '../components/transactions/RecurringCards'
import { RecurringDetailSheet } from '../components/transactions/RecurringDetailSheet'
import { groupByCadence, recurringStats } from '../components/transactions/recurringCadence'
import { RECURRING_CHARGES_QUERY } from '../graphql/queries'
import { useIsMobile } from '../hooks/useIsMobile'
import type { RecurringCharge } from '../types/graphql'

export function RecurringPage() {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [selected, setSelected] = useState<RecurringCharge | null>(null)
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
        {groups.map((group) => <RecurringCadenceCard group={group} key={group.label} onSelect={isMobile ? setSelected : openTransactions} selectAction={isMobile ? 'details' : 'transactions'} />)}
      </QueryGate>
      {selected ? <RecurringDetailSheet charge={selected} key={selected.id} onClose={() => setSelected(null)} onViewTransactions={openTransactions} /> : null}
    </div>
  )
}
