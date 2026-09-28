import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { listPasskeys, runPasskeyRegistration } from '../../auth/webauthn'
import { TestProviders } from '../../test/renderWithProviders'
import { SecurityTab } from './SecurityTab'

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }))
vi.mock('../../auth/webauthn', () => ({
  deletePasskey: vi.fn(),
  listPasskeys: vi.fn(),
  renamePasskey: vi.fn(),
  runPasskeyRegistration: vi.fn(),
}))

describe('AddPasskeySheet', () => {
  it('adds a passkey from the sheet and closes on the scrim', async () => {
    const user = userEvent.setup()
    vi.mocked(listPasskeys).mockResolvedValue([{ id: 'cred-1', name: 'iPhone', createdAt: '2026-05-20T12:00:00Z' }])
    vi.mocked(runPasskeyRegistration).mockResolvedValue({ id: 'cred-2', name: 'iPad', createdAt: '2026-05-21T12:00:00Z' })
    render(<SecurityTab />)

    await screen.findByText('iPhone')
    await user.click(screen.getByRole('button', { name: /add passkey/i }))
    const sheet = screen.getByRole('dialog', { name: 'Add passkey' })
    expect(within(sheet).queryByRole('button', { name: 'Close filters' })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /^passkey name/i })).toHaveAttribute('aria-expanded', 'true')
    expect(within(sheet).getByRole('button', { name: 'Next' })).toBeDisabled()
    await user.type(within(sheet).getByRole('textbox', { name: 'Passkey name' }), 'iPad')
    await user.click(within(sheet).getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(runPasskeyRegistration).toHaveBeenCalledWith('iPad'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /add passkey/i }))
    await user.click(screen.getByRole('dialog'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('cannot be dismissed while passkeys are the only sign-in method', async () => {
    const user = userEvent.setup()
    vi.mocked(listPasskeys).mockResolvedValue([])
    render(
      <TestProviders auth={{ webauthnEnabled: true, emailAuthEnabled: false, googleAuthEnabled: false }}>
        <SecurityTab />
      </TestProviders>,
    )

    const sheet = await screen.findByRole('dialog', { name: 'Add passkey' })
    expect(within(sheet).getByText(/only sign-in method/)).toBeInTheDocument()
    await user.click(sheet)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'Add passkey' })).toBeInTheDocument()
  })
})
