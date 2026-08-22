import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../mocks/server'
import { ImportExportMenu } from './ImportExportMenu'
import { ImportModal } from './ImportModal'

// Mock the export utility so we don't need to deal with blob/anchor in jsdom
vi.mock('../../utils/export', () => ({
  downloadTransactionsCsv: vi.fn().mockResolvedValue(undefined),
}))

// Stub out blob URL APIs unavailable in jsdom
Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:mock'), writable: true })
Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true })

function csvFile(name = 'txns.csv', content = 'account_id,datetime,amount,merchant_name\nacc1,2026-01-01,12.50,Coffee') {
  return new File([content], name, { type: 'text/csv' })
}

async function uploadAndImport() {
  const user = userEvent.setup()
  render(<ImportModal onClose={vi.fn()} onSuccess={vi.fn()} />)
  await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, csvFile())
  await user.click(screen.getByRole('button', { name: /^import$/i }))
}

describe('ImportExportMenu', () => {
  it('renders the Import / Export button', () => {
    render(<ImportExportMenu canImport filter={{}} onImportSuccess={vi.fn()} />)
    expect(screen.getByRole('button', { name: /import \/ export/i })).toBeInTheDocument()
  })

  it('opens dropdown showing Import and Export options', async () => {
    const user = userEvent.setup()
    render(<ImportExportMenu canImport filter={{}} onImportSuccess={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /import \/ export/i }))
    expect(screen.getByRole('button', { name: /^import$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^export$/i })).toBeInTheDocument()
  })

  it('calls downloadTransactionsCsv with current filter on Export click', async () => {
    const { downloadTransactionsCsv } = await import('../../utils/export')
    const user = userEvent.setup()
    const filter = { datetimeRange: { from: '2026-01-01T00:00:00Z', to: '2026-06-01T00:00:00Z' }, isHidden: false }

    render(<ImportExportMenu canImport filter={filter} onImportSuccess={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /import \/ export/i }))
    await user.click(screen.getByRole('button', { name: /^export$/i }))

    await waitFor(() => expect(downloadTransactionsCsv).toHaveBeenCalledWith(filter))
  })

  it('shows a direct Export button without Import when importing is not allowed', async () => {
    const { downloadTransactionsCsv } = await import('../../utils/export')
    const user = userEvent.setup()
    const filter = { isHidden: false }

    render(<ImportExportMenu canImport={false} filter={filter} onImportSuccess={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /import \/ export/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^import$/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^export$/i }))

    await waitFor(() => expect(downloadTransactionsCsv).toHaveBeenCalledWith(filter))
  })

  it('opens ImportModal on Import click and closes on Cancel', async () => {
    const user = userEvent.setup()
    render(<ImportExportMenu canImport filter={{}} onImportSuccess={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /import \/ export/i }))
    await user.click(screen.getByRole('button', { name: /^import$/i }))

    expect(screen.getByRole('dialog', { name: /import transactions/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('ImportModal', () => {
  it('renders with required column information', () => {
    render(<ImportModal onClose={vi.fn()} onSuccess={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: /import transactions/i })).toBeInTheDocument()
    expect(screen.getByText('account_id')).toBeInTheDocument()
    expect(screen.getByText('datetime')).toBeInTheDocument()
    expect(screen.getByText('amount')).toBeInTheDocument()
  })

  it('Import button is disabled until a file is selected', () => {
    render(<ImportModal onClose={vi.fn()} onSuccess={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^import$/i })).toBeDisabled()
  })

  it('rejects non-CSV files dropped onto the drop zone', async () => {
    render(<ImportModal onClose={vi.fn()} onSuccess={vi.fn()} />)

    const dropZone = screen.getByRole('button', { name: /choose csv file or drag and drop/i })
    const txtFile = new File(['data'], 'data.txt', { type: 'text/plain' })
    fireEvent.drop(dropZone, { dataTransfer: { files: [txtFile] } })

    expect(await screen.findByText(/\.csv file/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^import$/i })).toBeDisabled()
  })

  it('accepts a CSV file and enables the Import button', async () => {
    const user = userEvent.setup()
    render(<ImportModal onClose={vi.fn()} onSuccess={vi.fn()} />)

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, csvFile())

    expect(screen.getByText('txns.csv')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^import$/i })).not.toBeDisabled()
  })

  it('shows processed/skipped counts after a successful import', async () => {
    server.use(
      http.post('/transactions/import', () =>
        HttpResponse.json({ processed: 5, skipped: 2, errors: [] }),
      ),
    )

    await uploadAndImport()

    await waitFor(() =>
      expect(screen.getByText(/5 imported, 2 skipped/i)).toBeInTheDocument(),
    )
  })

  it('handles a successful import response with null errors', async () => {
    server.use(
      http.post('/transactions/import', () => HttpResponse.json({ processed: 5, errors: null })),
    )

    await uploadAndImport()

    await waitFor(() =>
      expect(screen.getByText(/5 imported, 0 skipped/i)).toBeInTheDocument(),
    )
  })

  it('shows row-level errors returned by the server', async () => {
    server.use(
      http.post('/transactions/import', () =>
        HttpResponse.json({
          processed: 1,
          skipped: 0,
          errors: [{ row: 3, message: 'account_id "bad-id" not found' }],
        }),
      ),
    )

    await uploadAndImport()

    await waitFor(() => expect(screen.getByText(/1 row had errors/i)).toBeInTheDocument())
    expect(screen.getByText(/row 3.*account_id/i)).toBeInTheDocument()
  })

  it('shows an error message on HTTP failure', async () => {
    server.use(
      http.post('/transactions/import', () =>
        new HttpResponse('csv parse error: missing required column "amount"', { status: 400 }),
      ),
    )

    await uploadAndImport()

    await waitFor(() =>
      expect(screen.getByText(/csv parse error/i)).toBeInTheDocument(),
    )
  })

  it('accepts a file dropped onto the drop zone', async () => {
    render(<ImportModal onClose={vi.fn()} onSuccess={vi.fn()} />)

    const dropZone = screen.getByRole('button', { name: /choose csv file or drag and drop/i })
    fireEvent.drop(dropZone, {
      dataTransfer: { files: [csvFile()] },
    })

    await waitFor(() => expect(screen.getByText('txns.csv')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /^import$/i })).not.toBeDisabled()
  })

  it('closes when the backdrop is clicked', async () => {
    const onClose = vi.fn()
    render(<ImportModal onClose={onClose} onSuccess={vi.fn()} />)

    fireEvent.click(screen.getByRole('presentation'))
    expect(onClose).toHaveBeenCalled()
  })
})
