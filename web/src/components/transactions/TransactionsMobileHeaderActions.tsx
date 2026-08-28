import { CheckSquare, ClipboardList } from 'lucide-react'
import { MobileFilterButton } from '../common/MobileFilterDropdown'
import { mobileHeaderActionClass } from '../common/mobileHeaderActionClass'

// Mobile header actions for the transactions page: summary toggle, bulk-mode
// toggle, filter toggle, and create.
export function TransactionsMobileHeaderActions({
  canWrite,
  filterOpen,
  filtersActive,
  isBulkMode,
  showCreate,
  showMobileSummary,
  summaryAvailable,
  onCreate,
  onToggleBulk,
  onToggleFilter,
  onToggleSummary,
}: {
  canWrite: boolean
  filterOpen: boolean
  filtersActive: boolean
  isBulkMode: boolean
  showCreate: boolean
  showMobileSummary: boolean
  summaryAvailable: boolean
  onCreate: () => void
  onToggleBulk: () => void
  onToggleFilter: () => void
  onToggleSummary: () => void
}) {
  return (
    <>
      <button
        aria-expanded={showMobileSummary}
        aria-label="Open transaction summary"
        className={mobileHeaderActionClass('touch-manipulation rounded-xl p-2.5', showMobileSummary)}
        disabled={!summaryAvailable}
        onClick={onToggleSummary}
        type="button"
      >
        <ClipboardList className="h-5 w-5" />
      </button>
      {canWrite ? (
        <button
          aria-label={isBulkMode ? 'Exit bulk select' : 'Bulk actions'}
          aria-pressed={isBulkMode}
          className={mobileHeaderActionClass('touch-manipulation rounded-xl p-2.5', isBulkMode)}
          onClick={onToggleBulk}
          type="button"
        >
          <CheckSquare className="h-5 w-5" />
        </button>
      ) : null}
      <MobileFilterButton
        active={filterOpen}
        highlighted={filtersActive}
        onClick={onToggleFilter}
      />
      {canWrite ? (
        <button
          aria-label="Create transaction"
          className={mobileHeaderActionClass('rounded-xl px-4 py-2 text-lg font-semibold leading-none', showCreate)}
          onClick={onCreate}
          type="button"
        >
          +
        </button>
      ) : null}
    </>
  )
}
