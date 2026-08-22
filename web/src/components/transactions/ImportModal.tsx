import { useCallback, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { getApiBaseUrl } from '../../utils/apiUrl'
import { authorizedFetch } from '../../auth/tokenStore'
import { Button } from '../common/Button'
import { FormError } from '../common/FormControls'
import { Modal } from '../common/Modal'
import { ModalCloseButton } from '../common/ModalHeader'

interface ImportRowError {
  row: number
  message: string
}

interface ImportResult {
  processed: number
  skipped: number
  errors: ImportRowError[]
}

interface ImportResponse {
  processed: number
  skipped?: number
  errors?: ImportRowError[] | null
}

export function ImportModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback((f: File) => {
    if (!f.name.toLowerCase().endsWith('.csv')) {
      setError('Please select a .csv file.')
      return
    }
    if (f.size > 10 * 1024 * 1024) {
      setError('File is too large. Maximum size is 10 MB.')
      return
    }
    setFile(f)
    setError(null)
    setResult(null)
  }, [])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  async function handleSubmit() {
    if (!file) return
    setSubmitting(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const response = await authorizedFetch(`${getApiBaseUrl()}/transactions/import`, {
        method: 'POST',
        body: form,
      })
      if (!response.ok) {
        const text = await response.text()
        setError(text || `Import failed (${response.status})`)
        return
      }
      const data: ImportResponse = await response.json()
      const errors = data.errors ?? []
      setResult({ processed: data.processed, skipped: data.skipped ?? errors.length, errors })
      if (data.processed > 0) {
        setTimeout(onSuccess, 1200)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal label="Import transactions" onClose={onClose} size="lg">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-neutral-950">Import transactions</h2>
          <ModalCloseButton label="Close import dialog" onClick={onClose} />
        </div>

        <p className="mt-2 text-sm text-neutral-500">
          Upload a CSV with columns:{' '}
          {['account_id', 'datetime', 'amount', 'merchant_name / original_name'].map((col) => (
            <code key={col} className="mx-0.5 rounded bg-neutral-100 px-1 text-neutral-700">
              {col}
            </code>
          ))}
          . Optional:{' '}
          {['posted_datetime', 'category', 'notes', 'is_recurring', 'is_hidden'].map((col) => (
            <code key={col} className="mx-0.5 rounded bg-neutral-100 px-1 text-neutral-700">
              {col}
            </code>
          ))}
          . Bare dates are accepted for the transaction timestamp.
        </p>

        {!result && (
          <>
            <button
              aria-label="Choose CSV file or drag and drop"
              className={`mt-4 flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-sm transition ${
                dragging
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-neutral-200 text-neutral-400 hover:border-neutral-300 hover:text-neutral-500'
              }`}
              onClick={() => inputRef.current?.click()}
              onDragLeave={() => setDragging(false)}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDrop={handleDrop}
              type="button"
            >
              <Upload className="h-8 w-8" />
              {file ? (
                <span className="font-medium text-neutral-700">{file.name}</span>
              ) : (
                <span>
                  Drag &amp; drop a CSV or{' '}
                  <span className="text-brand-600 underline">browse</span>
                </span>
              )}
            </button>
            <input
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
              }}
              ref={inputRef}
              type="file"
            />
          </>
        )}

        {error ? <FormError className="mt-3">{error}</FormError> : null}

        {result && (
          <div className="mt-4 space-y-2">
            <div className="rounded-xl bg-green-50 px-4 py-3 text-sm">
              <p className="font-semibold text-green-800">
                {result.processed} imported, {result.skipped} skipped
              </p>
            </div>
            {result.errors.length > 0 && (
              <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm">
                <p className="mb-1 font-semibold text-amber-800">
                  {result.errors.length} row{result.errors.length !== 1 ? 's' : ''} had errors
                </p>
                <ul className="space-y-0.5 text-amber-700">
                  {result.errors.map((e) => (
                    <li key={`${e.row}-${e.message}`}>
                      Row {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button onClick={onClose} type="button" variant="ghost">
            {result ? 'Close' : 'Cancel'}
          </Button>
          {!result && (
            <Button className="gap-2" disabled={!file || submitting} onClick={handleSubmit} type="button">
              {submitting ? 'Importing…' : 'Import'}
            </Button>
          )}
        </div>
    </Modal>
  )
}
