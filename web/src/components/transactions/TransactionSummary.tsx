import clsx from 'clsx'
import type { TransactionsSummary } from '../../types/graphql'
import { formatCurrency } from '../../utils/currency'
import { formatDisplayDate } from '../../utils/dates'
import { Card } from '../common/FormControls'
import { StatBlock, StatGrid } from '../common/StatBlock'

export function TransactionSummaryCard({ open, summary }: { open: boolean; summary: TransactionsSummary }) {
  return (
    <div aria-hidden={!open} className={clsx('grid transition-[grid-template-rows,opacity,margin] duration-[280ms] ease-in-out', open ? 'grid-rows-[1fr] opacity-100' : '-mb-3 grid-rows-[0fr] opacity-0')}>
      <div className="min-h-0 overflow-hidden">
        <Card as="aside" aria-label="Transaction summary" className="p-4 lg:px-5 lg:py-4">
          <StatGrid>
            <StatBlock label="Transactions" value={summary.totalCount.toLocaleString('en-US')} />
            <StatBlock label="Total" value={formatCurrency(summary.totalAmount)} />
            <StatBlock label="Average" value={formatCurrency(summary.averageAmount)} />
            <StatBlock label="Largest" value={formatCurrency(summary.largestAmount)} />
            {summary.firstDate ? <StatBlock label="First" value={formatDisplayDate(summary.firstDate)} /> : null}
            {summary.lastDate ? <StatBlock label="Last" value={formatDisplayDate(summary.lastDate)} /> : null}
          </StatGrid>
        </Card>
      </div>
    </div>
  )
}
