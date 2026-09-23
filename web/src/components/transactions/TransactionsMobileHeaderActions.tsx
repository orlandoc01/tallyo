import { CheckSquare, Plus, X } from 'lucide-react'
import { Button, IconButton } from '../common/Button'
import { MobileFilterButton } from '../common/MobileFilterDropdown'

export function TransactionsMobileHeaderActions({ activeFilterCount, canWrite, filterOpen, isBulkMode, onCreate, onToggleBulk, onToggleFilter }: {
  activeFilterCount: number
  canWrite: boolean
  filterOpen: boolean
  isBulkMode: boolean
  onCreate: () => void
  onToggleBulk: () => void
  onToggleFilter: () => void
}) {
  return (
    <>
      {canWrite ? (
        <IconButton ariaLabel={isBulkMode ? 'Exit bulk select' : 'Bulk actions'} className="touch-manipulation" onClick={onToggleBulk} pressed={isBulkMode}>
          {isBulkMode ? <X className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />}
        </IconButton>
      ) : null}
      <MobileFilterButton active={filterOpen} count={activeFilterCount} onClick={onToggleFilter} />
      {canWrite ? (
        <Button aria-label="Create transaction" className="touch-manipulation" onClick={onCreate}>
          <Plus aria-hidden className="h-4 w-4" />
          Create
        </Button>
      ) : null}
    </>
  )
}
