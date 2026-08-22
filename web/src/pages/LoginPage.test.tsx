import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runPasskeyAuthentication } from '../auth/webauthn'
import { LoginPage } from './LoginPage'

vi.mock('../auth/webauthn', () => ({
  runPasskeyAuthentication: vi.fn(),
}))

describe('LoginPage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows error when login_session is missing', () => {
    render(<LoginPage />)

    expect(screen.getByText(/missing login session/i)).toBeInTheDocument()
  })

  it('renders enabled auth methods and routes clicks', async () => {
    const user = userEvent.setup()
    const originalLocation = window.location
    const assign = vi.fn()
    // @ts-expect-error replacing location for test
    delete window.location
    // @ts-expect-error location property spread conflict
    window.location = { ...originalLocation, search: '?login_session=test-session', assign }
    Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: function PublicKeyCredential() {} })

    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify({ google_auth_enabled: true, email_auth_enabled: true, webauthn_enabled: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    render(<LoginPage />)

    expect(await screen.findByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in with email/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in with passkey/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /sign in with google/i }))
    expect(assign).toHaveBeenCalledWith('http://localhost:3000/auth/google?login_session=test-session')

    await user.click(screen.getByRole('button', { name: /sign in with email/i }))
    expect(assign).toHaveBeenCalledWith('/auth/email-challenge?login_session=test-session')

    // @ts-expect-error restoring location after test
    window.location = originalLocation
  })

  it('runs passkey authentication and follows same-origin redirect', async () => {
    const user = userEvent.setup()
    const originalLocation = window.location
    const assign = vi.fn()
    // @ts-expect-error replacing location for test
    delete window.location
    // @ts-expect-error location property spread conflict
    window.location = { ...originalLocation, search: '?login_session=test-session', assign }
    Object.defineProperty(window, 'PublicKeyCredential', { configurable: true, value: function PublicKeyCredential() {} })

    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify({ google_auth_enabled: false, email_auth_enabled: false, webauthn_enabled: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.mocked(runPasskeyAuthentication).mockResolvedValue({ redirect_url: 'http://localhost:3000/authorize?session_id=done' })

    render(<LoginPage />)

    await user.click(await screen.findByRole('button', { name: /sign in with passkey/i }))

    await waitFor(() => expect(assign).toHaveBeenCalledWith('http://localhost:3000/authorize?session_id=done'))

    // @ts-expect-error restoring location after test
    window.location = originalLocation
  })
})
