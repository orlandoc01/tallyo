import { useRef, useState } from 'react'
import { ChevronDown, Download, Upload } from 'lucide-react'
import type { TransactionsFilter } from '../../types/graphql'
import { useDismiss } from '../../hooks/useDismiss'
import { downloadTransactionsCsv } from '../../utils/export'
import { Button } from '../common/Button'
import { ImportModal } from './ImportModal'

const menuItemClass = 'flex w-full items-center gap-2.5 rounded-[5px] px-2 py-2 text-[13px] text-text-1 hover:bg-hover'

export function ImportExportMenu({
  canImport,
  filter,
  onImportSuccess,
}: {
  canImport: boolean
  filter: TransactionsFilter
  onImportSuccess: () => void
}) {
  const [open, setOpen] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useDismiss(open, () => setOpen(false), [menuRef])

  async function handleExport() {
    setOpen(false)
    setExporting(true)
    setExportError(null)
    try {
      await downloadTransactionsCsv(filter)
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  if (!canImport) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button disabled={exporting} onClick={handleExport} variant="secondary">
          <Download aria-hidden className="h-3.5 w-3.5 text-text-muted" />
          {exporting ? 'Exporting…' : 'Export'}
        </Button>
        {exportError && <p className="text-xs text-negative">{exportError}</p>}
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <div className="relative" ref={menuRef}>
          <Button aria-expanded={open} disabled={exporting} onClick={() => setOpen((v) => !v)} variant="secondary">
            {exporting ? 'Exporting…' : 'Import / Export'}
            <ChevronDown aria-hidden className="h-3 w-3 text-text-muted" />
          </Button>
          {open && (
            <div className="absolute right-0 z-30 mt-1 w-40 rounded-lg border border-border-strong bg-raised p-1 shadow-dropdown">
              <button className={menuItemClass} onClick={() => { setOpen(false); setShowImport(true) }} type="button">
                <Upload aria-hidden className="h-3.5 w-3.5 text-text-muted" />
                Import
              </button>
              <button className={menuItemClass} onClick={handleExport} type="button">
                <Download aria-hidden className="h-3.5 w-3.5 text-text-muted" />
                Export
              </button>
            </div>
          )}
        </div>
        {exportError && <p className="text-xs text-negative">{exportError}</p>}
      </div>

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onSuccess={() => {
            setShowImport(false)
            onImportSuccess()
          }}
        />
      )}
    </>
  )
}
