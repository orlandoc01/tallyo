import type { useSnapshotHistory } from './useSnapshotHistory'
import { formatHistoryDate } from './accountSnapshotLines'
import { formatSignedCurrency } from '../../utils/currency'
import { FilterCheckboxList, type FilterCheckboxOption } from '../common/FilterCheckboxList'

export function SnapshotHistorySection({
  history,
  onSelectDate,
  selectedDate,
}: {
  history: ReturnType<typeof useSnapshotHistory>
  onSelectDate: (date: string) => void
  selectedDate: string
}) {
  const options = history.snapshots.map((snapshot): FilterCheckboxOption => {
    const displayDate = formatHistoryDate(snapshot.date)
    return {
      id: snapshot.date,
      label: displayDate,
      ariaLabel: `Select ${displayDate} snapshot`,
      trailing: formatSignedCurrency(snapshot.netContributionUSD),
    }
  })
  const selectedIds = history.snapshots.some((snapshot) => snapshot.date === selectedDate) ? [selectedDate] : []

  return (
    <div className="space-y-2 border-t border-neutral-100 pt-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-neutral-700">History</h3>
        {history.loading ? <span className="text-xs font-medium text-neutral-500">Loading...</span> : null}
      </div>
      {options.length > 0 ? (
        <FilterCheckboxList options={options} selectedIds={selectedIds} selectionMode="single" onChange={(ids) => { if (ids[0]) onSelectDate(ids[0]) }} />
      ) : (
        <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50 px-3 py-3 text-sm text-neutral-500">
          No snapshot history yet.
        </div>
      )}
      {!history.infinite && history.pageInfo?.hasNextPage ? (
        <button
          className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={history.loading}
          onClick={() => {
            history.setInfinite(true)
            void history.loadMore()
          }}
          type="button"
        >
          {history.loading ? 'Loading...' : 'Load more'}
        </button>
      ) : null}
      {history.infinite && history.pageInfo?.hasNextPage ? (
        <div ref={history.sentinelRef} className="py-1 text-center text-xs font-medium text-neutral-500">
          {history.loading ? 'Loading more...' : ''}
        </div>
      ) : null}
      {history.error ? <p className="text-sm text-red-600">Could not load history: {history.error}</p> : null}
    </div>
  )
}
