import { useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '../common/Button'
import type { Category, Tag } from '../../types/graphql'
import { BulkDeleteTransactionsModal } from './BulkDeleteTransactionsModal'
import { BulkEditTransactionsModal } from './BulkEditTransactionsModal'
import type { useBulkTransactionActions } from './useBulkTransactionActions'

export function BulkActionBar({ selectedCount, onDelete, onEdit }: { selectedCount: number; onDelete: () => void; onEdit: () => void }) {
  return (
    <div className="fixed bottom-20 left-1/2 z-30 flex w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 items-center justify-between gap-4 rounded-2xl border border-neutral-200 bg-white px-4 py-3 shadow-2xl lg:bottom-6">
      <span className="text-sm font-semibold text-neutral-700">{selectedCount} selected</span>
      <div className="flex items-center gap-2">
        <Button disabled={selectedCount === 0} onClick={onEdit}>Edit</Button>
        <Button disabled={selectedCount === 0} onClick={onDelete} variant="danger">Delete</Button>
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
    <label className="flex h-10 shrink-0 items-center gap-2 rounded-2xl border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-600">
      <input
        aria-label="Select all transactions in current filter"
        checked={allSelected}
        className="h-4 w-4 rounded accent-brand-600 disabled:opacity-50"
        disabled={selecting}
        onChange={onToggle}
        ref={checkboxRef}
        type="checkbox"
      />
      {selecting ? <Loader2 aria-hidden className="h-4 w-4 animate-spin text-brand-600" /> : null}
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
