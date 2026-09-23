import clsx from 'clsx'
import type { Ref } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '../common/Button'
import { FiltersButton } from '../common/FiltersButton'
import { ToggleSwitch } from '../common/ToggleSwitch'
import type { TransactionsFilter } from '../../types/graphql'
import { ImportExportMenu } from './ImportExportMenu'

export function TransactionsHeader({ activeFilterCount, canWrite, filter, filtersButtonRef, filtersOpen, isBulkMode, onCancelBulkMode, onCreate, onEnterBulkMode, onImportSuccess, onToggleFilters, onToggleSummary, summaryAvailable, summaryOpen }: {
  activeFilterCount: number
  canWrite: boolean
  filter: TransactionsFilter
  filtersButtonRef: Ref<HTMLButtonElement>
  filtersOpen: boolean
  isBulkMode: boolean
  onCancelBulkMode: () => void
  onCreate: () => void
  onEnterBulkMode: () => void
  onImportSuccess: () => void
  onToggleFilters: () => void
  onToggleSummary: () => void
  summaryAvailable: boolean
  summaryOpen: boolean
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <h1 className="sr-only text-base font-semibold tracking-[-0.2px] text-text-1 lg:not-sr-only">Transactions</h1>
        <label className="hidden cursor-pointer items-center gap-2 border-l border-border pl-3 lg:flex">
          <ToggleSwitch checked={summaryOpen} disabled={!summaryAvailable} label="Summary" onChange={onToggleSummary} />
          <span className={clsx('text-[13px] font-medium', summaryOpen ? 'text-text-1' : 'text-text-muted')}>Summary</span>
        </label>
      </div>
      <div className="hidden items-center gap-2 lg:flex">
        <ImportExportMenu canImport={canWrite} filter={filter} onImportSuccess={onImportSuccess} />
        {canWrite ? (
          isBulkMode
            ? <Button onClick={onCancelBulkMode} variant="secondary">Cancel</Button>
            : <Button onClick={onEnterBulkMode} variant="secondary">Edit Multiple</Button>
        ) : null}
        <FiltersButton count={activeFilterCount} onClick={onToggleFilters} open={filtersOpen} ref={filtersButtonRef} />
        {canWrite ? (
          <Button aria-label="Create transaction" onClick={onCreate}>
            <Plus aria-hidden className="h-4 w-4" />
            Create
          </Button>
        ) : null}
      </div>
    </div>
  )
}
