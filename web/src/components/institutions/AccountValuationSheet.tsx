import clsx from 'clsx'
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { Account, AccountSnapshot } from '../../types/graphql'
import { formatSignedCurrency } from '../../utils/currency'
import { DeltaText } from '../common/DeltaText'
import { AccountBalanceSparkline } from './AccountBalanceSparkline'
import { formatSnapshotDay, groupSnapshotsByMonth, snapshotSource, trailingYearPoints, type SnapshotTone } from './accountValuation'
import { SnapshotExpandedPanel } from './SnapshotExpandedPanel'
import { useSnapshotEditorResources } from './useSnapshotEditorResources'
import { useSnapshotHistory } from './useSnapshotHistory'

const FIRST_PAGE = 31
const TONE_DOT: Record<SnapshotTone, string> = { sync: 'bg-brand-600', manual: 'bg-border-emph', flagged: 'bg-warning' }

export function AccountValuationSheet({ account, onAccountUpdate }: { account: Account; onAccountUpdate: (account: Account) => void }) {
  const history = useSnapshotHistory(account, () => {}, FIRST_PAGE)
  const resources = useSnapshotEditorResources(account)
  const [openDate, setOpenDate] = useState<string | null>(null)
  const groups = groupSnapshotsByMonth(history.snapshots)
  const remaining = history.totalCount === null ? null : history.totalCount - history.snapshots.length

  function handleSaved(snapshot: AccountSnapshot, updatedAccount: Account | undefined) {
    history.applySavedSnapshot(snapshot)
    onAccountUpdate(updatedAccount ?? account)
  }

  return (
    <div>
      <AccountBalanceSparkline points={trailingYearPoints(history.snapshots)} />
      <div className="flex items-center justify-between pb-2.5 pt-4">
        <h3 className="text-sm font-semibold text-text-1">
          Snapshots{history.totalCount === null ? null : <span className="font-normal text-text-3"> · {history.totalCount}</span>}
        </h3>
        {history.loading ? <span className="text-xs text-text-3">Loading...</span> : null}
      </div>
      {groups.length === 0 && !history.loading ? (
        <div className="rounded-md border border-dashed border-border-emph px-3 py-3 text-sm text-text-3">No snapshot history yet.</div>
      ) : null}
      {groups.map((group) => (
        <section aria-label={group.label} key={group.key}>
          <div className="sticky top-10 z-[1] -mx-4 flex items-center justify-between border-y border-border bg-bg-deep px-4 py-[7px] text-xs font-medium text-text-3">
            <span>{group.label}</span>
            <span className="flex items-center gap-1">
              {group.snapshots.length} {group.snapshots.length === 1 ? 'snapshot' : 'snapshots'} · <DeltaText changePct={group.changePct} changeUSD={group.changeUSD} size="sm" />
            </span>
          </div>
          {group.snapshots.map((snapshot) => {
            const expanded = openDate === snapshot.date
            const source = snapshotSource(account, snapshot)
            return (
              <div key={snapshot.date}>
                <button
                  aria-expanded={expanded}
                  className={clsx('-mx-4 flex min-h-[46px] w-[calc(100%+2rem)] touch-manipulation items-center gap-2.5 border-b border-border px-4 text-left', expanded && 'bg-raised')}
                  onClick={() => setOpenDate(expanded ? null : snapshot.date)}
                  type="button"
                >
                  <span aria-hidden className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', TONE_DOT[source.tone])} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-text-1">{formatSnapshotDay(snapshot.date)}</span>
                    <span className="block text-[11px] text-text-3">{source.label}</span>
                  </span>
                  <span className="min-w-[84px] text-right text-sm tabular-nums text-text-1">{formatSignedCurrency(snapshot.netContributionUSD)}</span>
                  <ChevronRight aria-hidden className={clsx('h-2.5 w-2.5 shrink-0 text-text-3 transition-transform', expanded && 'rotate-90')} />
                </button>
                {expanded ? <SnapshotExpandedPanel account={account} key={snapshot.id} onSaved={handleSaved} resources={resources} snapshot={snapshot} /> : null}
              </div>
            )
          })}
        </section>
      ))}
      {!history.infinite && history.pageInfo?.hasNextPage ? (
        <button
          className="flex h-12 w-full touch-manipulation items-center justify-center text-[13px] font-medium text-text-2 disabled:opacity-50"
          disabled={history.loading}
          onClick={() => { history.setInfinite(true); void history.loadMore() }}
          type="button"
        >
          {remaining !== null && remaining > 0 ? `Load ${remaining} older snapshots` : 'Load older snapshots'}
        </button>
      ) : null}
      {history.infinite && history.pageInfo?.hasNextPage ? (
        <div className="py-2 text-center text-xs text-text-3" ref={history.sentinelRef}>{history.loading ? 'Loading more...' : ''}</div>
      ) : null}
      {history.error ? <p className="py-2 text-sm text-negative">Could not load history: {history.error}</p> : null}
    </div>
  )
}
