import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { PageToolbarButton } from '../common/PageToolbar'
import type { TransactionsSummary } from '../../types/graphql'
import { formatCurrency } from '../../utils/currency'
import { formatDisplayDate } from '../../utils/dates'

export function TransactionSummaryDropdown({ summary }: { summary: TransactionsSummary | null }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <PageToolbarButton
        aria-expanded={open}
        disabled={!summary}
        onClick={() => setOpen((current) => !current)}
      >
        Summary
        <ChevronDown className="h-4 w-4 text-neutral-400" />
      </PageToolbarButton>
      {open && summary ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-80">
            <TransactionSummaryCard summary={summary} />
          </div>
        </>
      ) : null}
    </div>
  )
}

export function TransactionSummaryCard({ className = 'rounded-3xl border border-neutral-200 bg-white p-5 shadow-card', showTitle = true, summary }: { className?: string; showTitle?: boolean; summary: TransactionsSummary }) {
  return (
    <aside aria-label="Transaction summary" className={className}>
      {showTitle ? <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">Summary</h2> : null}
      <dl className="space-y-3">
        <SummaryRow label="Transactions" value={String(summary.totalCount)} />
        <SummaryRow label="Total" value={formatCurrency(summary.totalAmount)} />
        <SummaryRow label="Average" value={formatCurrency(summary.averageAmount)} />
        <SummaryRow label="Largest" value={formatCurrency(summary.largestAmount)} />
        {summary.firstDate ? <SummaryRow label="First" value={formatDisplayDate(summary.firstDate)} /> : null}
        {summary.lastDate ? <SummaryRow label="Last" value={formatDisplayDate(summary.lastDate)} /> : null}
      </dl>
    </aside>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  )
}
