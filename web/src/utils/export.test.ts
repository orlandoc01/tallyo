import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../mocks/server'
import { downloadTransactionsCsv } from './export'

Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:mock'), writable: true })
Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true })
vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

describe('export', () => {
  it('downloadTransactionsCsv serializes filters and downloads CSV', async () => {
    let requestUrl: URL | undefined
    server.use(http.get('/transactions/export', ({ request }) => {
      requestUrl = new URL(request.url)
      return new HttpResponse('account_id,date,amount\nacct-1,2026-05-14,62.30\n', { headers: { 'Content-Type': 'text/csv' } })
    }))
    await downloadTransactionsCsv({ datetimeRange: { from: '2026-01-01', to: '2026-06-30' }, categoryIds: ['cat-1', 'cat-2'], accountIds: ['acct-1', 'acct-2'], ownerIds: ['owner-1', 'owner-2'] })
    expect(Object.fromEntries(requestUrl?.searchParams ?? [])).toEqual({ datetimeFrom: '2026-01-01', datetimeTo: '2026-06-30', categoryIds: 'cat-1,cat-2', accountIds: 'acct-1,acct-2', ownerIds: 'owner-1,owner-2' })
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock')
  })

  it('downloadTransactionsCsv reports response errors', async () => {
    let emptyBody = false
    server.use(http.get('/transactions/export', () => new HttpResponse(emptyBody ? '' : 'bad filter', { status: emptyBody ? 503 : 400 })))

    await expect(downloadTransactionsCsv({})).rejects.toThrow('bad filter')

    emptyBody = true
    await expect(downloadTransactionsCsv({})).rejects.toThrow('Export failed (503)')
  })
})
