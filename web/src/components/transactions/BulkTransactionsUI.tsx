import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { Button } from '../common/Button'
import { checkboxClass } from '../common/FormControls'
import type { Category, Tag } from '../../types/graphql'
import { BulkDeleteTransactionsModal } from './BulkDeleteTransactionsModal'
import { BulkEditTransactionsModal } from './BulkEditTransactionsModal'
import type { useBulkTransactionActions } from './useBulkTransactionActions'

export function BulkActionBar({ className, selectedCount, onDelete, onEdit }: { className?: string; selectedCount: number; onDelete: () => void; onEdit: () => void }) {
  return (
    <div className={clsx('sticky top-[68px] z-20 flex items-center justify-between gap-4 rounded-md border border-border-strong bg-raised px-4 py-2 lg:top-4', className)}>
      <span className="text-[13px] font-medium text-text-1">{selectedCount} selected</span>
      <div className="flex items-center gap-2">
        <Button disabled={selectedCount === 0} onClick={onEdit} size="sm">Edit</Button>
        <Button disabled={selectedCount === 0} onClick={onDelete} size="sm" variant="danger">Delete</Button>
      </div>
    </div>
  )
}

// Select-all-in-filter checkbox with indeterminate support and a spinner while
// the selection is being paged in.
export function BulkSelectAllCheckbox({
  allSelected,
  selecting,
  someSelected,
  onToggle,
}: {
  allSelected: boolean
  selecting: boolean
  someSelected: boolean
  onToggle: () => void
}) {
  const checkboxRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = someSelected
    }
  }, [someSelected])

  return (
    <label className="flex h-9 shrink-0 items-center gap-2 rounded-md border border-border-strong bg-raised px-3 lg:h-10">
      <input
        aria-label="Select all transactions in current filter"
        checked={allSelected}
        className={clsx(checkboxClass, 'h-4 w-4')}
        disabled={selecting}
        onChange={onToggle}
        ref={checkboxRef}
        type="checkbox"
      />
      {selecting ? <Loader2 aria-hidden className="h-4 w-4 animate-spin text-accent" /> : null}
    </label>
  )
}

// The bulk edit/delete confirmation modals, driven by useBulkTransactionActions.
export function BulkTransactionModals({
  actions,
  categories,
  selectedCount,
  tags,
}: {
  actions: ReturnType<typeof useBulkTransactionActions>
  categories: Category[]
  selectedCount: number
  tags: Tag[]
}) {
  return (
    <>
      {actions.showBulkEdit ? (
        <BulkEditTransactionsModal
          categories={categories}
          error={actions.bulkEditError}
          selectedCount={selectedCount}
          submitting={actions.bulkEditSubmitting}
          tags={tags}
          onClose={actions.closeBulkEdit}
          onConfirm={actions.confirmBulkUpdate}
        />
      ) : null}
      {actions.showBulkDelete ? (
        <BulkDeleteTransactionsModal
          error={actions.bulkDeleteError}
          selectedCount={selectedCount}
          submitting={actions.bulkDeleteSubmitting}
          onClose={actions.closeBulkDelete}
          onConfirm={actions.confirmBulkDelete}
        />
      ) : null}
    </>
  )
}
