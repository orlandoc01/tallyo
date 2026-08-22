import { useRef, useState } from 'react'
import { ChevronDown, Download, Upload } from 'lucide-react'
import type { TransactionsFilter } from '../../types/graphql'
import { useDismiss } from '../../hooks/useDismiss'
import { downloadTransactionsCsv } from '../../utils/export'
import { PageToolbarButton } from '../common/PageToolbar'
import { ImportModal } from './ImportModal'

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
        <PageToolbarButton
          disabled={exporting}
          onClick={handleExport}
          type="button"
        >
          <Download className="h-4 w-4 text-neutral-400" />
          {exporting ? 'Exporting…' : 'Export'}
        </PageToolbarButton>
        {exportError && <p className="text-xs text-red-600">{exportError}</p>}
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <div className="relative" ref={menuRef}>
          <PageToolbarButton
            disabled={exporting}
            onClick={() => setOpen((v) => !v)}
            type="button"
          >
            {exporting ? 'Exporting…' : 'Import / Export'}
            <ChevronDown className="h-4 w-4 text-neutral-400" />
          </PageToolbarButton>
          {open && (
            <div className="absolute right-0 z-20 mt-1 w-40 rounded-xl border border-neutral-200 bg-white py-1 shadow-lg">
              <button
                className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
                onClick={() => {
                  setOpen(false)
                  setShowImport(true)
                }}
                type="button"
              >
                <Upload className="h-4 w-4 text-neutral-400" />
                Import
              </button>
              <button
                className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
                onClick={handleExport}
                type="button"
              >
                <Download className="h-4 w-4 text-neutral-400" />
                Export
              </button>
            </div>
          )}
        </div>
        {exportError && <p className="text-xs text-red-600">{exportError}</p>}
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
