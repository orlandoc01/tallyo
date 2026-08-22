import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SecurityTab } from './SecurityTab'
import { deletePasskey, listPasskeys, renamePasskey, runPasskeyRegistration } from '../../auth/webauthn'

vi.mock('../../auth/webauthn', () => ({
  deletePasskey: vi.fn(),
  listPasskeys: vi.fn(),
  renamePasskey: vi.fn(),
  runPasskeyRegistration: vi.fn(),
}))

describe('SecurityTab', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists and renames passkeys', async () => {
    const user = userEvent.setup()
    vi.mocked(listPasskeys).mockResolvedValue([{ id: 'cred-1', name: 'iPhone', createdAt: '2026-05-20T12:00:00Z' }])
    vi.mocked(renamePasskey).mockResolvedValue()

    render(<SecurityTab />)

    expect(await screen.findByText('iPhone')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /rename/i }))
    await user.clear(screen.getByDisplayValue('iPhone'))
    await user.type(screen.getByDisplayValue(''), 'MacBook')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(renamePasskey).toHaveBeenCalledWith('cred-1', 'MacBook'))
  })

  it('adds and deletes passkeys', async () => {
    const user = userEvent.setup()
    vi.mocked(listPasskeys).mockResolvedValue([{ id: 'cred-1', name: 'iPhone', createdAt: '2026-05-20T12:00:00Z' }])
    vi.mocked(runPasskeyRegistration).mockResolvedValue({ id: 'cred-2', name: 'iPad', createdAt: '2026-05-21T12:00:00Z' })
    vi.mocked(deletePasskey).mockResolvedValue()

    render(<SecurityTab />)

    await screen.findByText('iPhone')
    await user.click(screen.getByRole('button', { name: /add passkey/i }))
    await user.type(screen.getByPlaceholderText('iPhone'), 'iPad')
    await user.click(screen.getByRole('button', { name: /next/i }))
    await waitFor(() => expect(runPasskeyRegistration).toHaveBeenCalledWith('iPad'))

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: /confirm delete/i }))
    await waitFor(() => expect(deletePasskey).toHaveBeenCalledWith('cred-1'))
  })
})
