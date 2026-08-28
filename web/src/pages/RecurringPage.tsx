import { useQuery } from 'urql'
import { Card } from '../components/common/FormControls'
import { PageHeader } from '../components/common/PageHeader'
import { QueryGate } from '../components/common/QueryGate'
import { RECURRING_CHARGES_QUERY } from '../graphql/queries'
import type { RecurrenceInterval, RecurringCharge } from '../types/graphql'
import { formatCurrency } from '../utils/currency'
import { formatDisplayDate } from '../utils/dates'
import { accountDisplayLabel } from '../utils/accounts'

const INTERVAL_ORDER: Array<RecurrenceInterval | null> = ['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', null]
const INTERVAL_LABELS: Record<string, string> = {
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Biweekly',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  YEARLY: 'Yearly',
}

export function RecurringPage() {
  const [{ data, fetching, error }, reexecuteQuery] = useQuery<{ recurringCharges: { items: RecurringCharge[] } }>({ query: RECURRING_CHARGES_QUERY })
  const groups = (data?.recurringCharges.items ?? []).filter((g) => g.isActive)

  const byInterval = INTERVAL_ORDER.map((interval) => ({
    interval,
    label: interval ? (INTERVAL_LABELS[interval] ?? interval) : 'Unknown',
    items: groups.filter((g) => (g.interval ?? null) === interval),
  })).filter((section) => section.items.length > 0)

  return (
    <div className="space-y-6">
      <PageHeader title="Recurring" />
      <QueryGate
      data={data}
      empty={groups.length === 0}
      emptyTitle="No recurring charges detected"
      error={error}
      errorPrefix="Failed to load recurring charges"
      fetching={fetching}
      onRetry={() => reexecuteQuery({ requestPolicy: 'network-only' })}
    >
      <div className="space-y-6">
        {byInterval.map((section) => (
          <div key={section.label}>
            <h2 className="mb-3 text-sm font-semibold text-neutral-500">{section.label}</h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {section.items.map((group) => (
                <Card as="article" key={group.id} padded>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <h2 className="font-bold">{group.merchantName}</h2>
                      {group.status === 'EARLY_DETECTION' ? (
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-500">Early detection</span>
                      ) : null}
                    </div>
                    <div className="text-right font-semibold">{formatCurrency(group.estimatedAmount)}</div>
                  </div>
                  <div className="mt-4 text-sm text-neutral-600">Last seen {formatDisplayDate(group.lastDate)}</div>
                  {group.nextExpectedDate ? (
                    <div className="mt-1 text-sm text-neutral-600">Next expected: {formatDisplayDate(group.nextExpectedDate)}</div>
                  ) : null}
                  <div className="mt-2 text-sm">{group.category ? `${group.category.emoji} ${group.category.name}` : '❓ Uncategorized'}</div>
                  {group.transactions[0]?.account ? (
                    <div className="mt-2 text-sm text-neutral-600">
                      {accountDisplayLabel(group.transactions[0].account)}
                    </div>
                  ) : null}
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
      </QueryGate>
    </div>
  )
}
