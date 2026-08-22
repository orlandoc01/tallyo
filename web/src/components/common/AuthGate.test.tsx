import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthGate } from './AuthGate'

describe('AuthGate', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('hides the version when the build does not provide one', () => {
    render(<AuthGate onLogin={vi.fn()} onLoginWithEmail={vi.fn()} onLoginWithMasterPassword={vi.fn()} masterPasswordEnabled={false} emailAuthEnabled={false} googleAuthEnabled={true} />)

    expect(screen.queryByText(/^v\d+\.\d+\.\d+$/)).not.toBeInTheDocument()
  })

  it('shows the build version when provided', () => {
    vi.stubEnv('VITE_APP_VERSION', 'v1.2.3')

    render(<AuthGate onLogin={vi.fn()} onLoginWithEmail={vi.fn()} onLoginWithMasterPassword={vi.fn()} masterPasswordEnabled={false} emailAuthEnabled={false} googleAuthEnabled={true} />)

    expect(screen.getByText('v1.2.3')).toBeInTheDocument()
  })

  it('does not show sign-in method subtext on the landing page', () => {
    render(<AuthGate onLogin={vi.fn()} onLoginWithEmail={vi.fn()} onLoginWithMasterPassword={vi.fn()} masterPasswordEnabled={false} emailAuthEnabled={true} googleAuthEnabled={true} />)

    expect(screen.queryByText(/sign in with google or email/i)).not.toBeInTheDocument()
  })

  it('starts the OAuth login flow', async () => {
    const onLogin = vi.fn()
    const onLoginWithEmail = vi.fn()
    const onLoginWithMasterPassword = vi.fn()

    render(<AuthGate onLogin={onLogin} onLoginWithEmail={onLoginWithEmail} onLoginWithMasterPassword={onLoginWithMasterPassword} masterPasswordEnabled={false} emailAuthEnabled={false} googleAuthEnabled={true} />)

    screen.getByRole('button', { name: /sign in with google/i }).click()

    expect(onLogin).toHaveBeenCalled()
  })

  it('starts the email auth flow', async () => {
    const onLogin = vi.fn()
    const onLoginWithEmail = vi.fn()
    const onLoginWithMasterPassword = vi.fn()

    render(<AuthGate onLogin={onLogin} onLoginWithEmail={onLoginWithEmail} onLoginWithMasterPassword={onLoginWithMasterPassword} masterPasswordEnabled={false} emailAuthEnabled={true} googleAuthEnabled={false} />)

    screen.getByRole('button', { name: /sign in with email/i }).click()

    expect(onLoginWithEmail).toHaveBeenCalled()
  })

  it('starts the passkey auth flow when supported', async () => {
    const user = userEvent.setup()
    const onLoginWithPasskey = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: function PublicKeyCredential() {} })

    render(<AuthGate onLogin={vi.fn()} onLoginWithEmail={vi.fn()} onLoginWithPasskey={onLoginWithPasskey} onLoginWithMasterPassword={vi.fn()} masterPasswordEnabled={false} emailAuthEnabled={false} googleAuthEnabled={false} webauthnEnabled={true} />)

    await user.click(screen.getByRole('button', { name: /sign in with passkey/i }))

    expect(onLoginWithPasskey).toHaveBeenCalled()
  })

  it('shows master password option when enabled', async () => {
    const onLogin = vi.fn()
    const onLoginWithEmail = vi.fn()
    const onLoginWithMasterPassword = vi.fn()

    render(<AuthGate onLogin={onLogin} onLoginWithEmail={onLoginWithEmail} onLoginWithMasterPassword={onLoginWithMasterPassword} masterPasswordEnabled={true} emailAuthEnabled={false} googleAuthEnabled={true} />)

    expect(screen.getByRole('button', { name: /sign in with master password/i })).toBeInTheDocument()
  })

  it('validates and submits master password', async () => {
    const user = userEvent.setup()
    const onLogin = vi.fn()
    const onLoginWithEmail = vi.fn()
    const onLoginWithMasterPassword = vi.fn()
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { categories: { items: [{ id: 1 }] } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    render(<AuthGate onLogin={onLogin} onLoginWithEmail={onLoginWithEmail} onLoginWithMasterPassword={onLoginWithMasterPassword} masterPasswordEnabled={true} emailAuthEnabled={false} googleAuthEnabled={true} />)

    await user.click(screen.getByRole('button', { name: /sign in with master password/i }))
    await user.type(screen.getByLabelText(/master password/i), 'my-master-password')
    await user.click(screen.getByRole('button', { name: /unlock dashboard/i }))

    expect(onLoginWithMasterPassword).toHaveBeenCalledWith('my-master-password')
  })
})
