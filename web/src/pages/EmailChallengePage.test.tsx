import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmailChallengePage } from './EmailChallengePage'

let originalLocation: Location | undefined

function setLoginSession() {
  originalLocation = window.location
  // @ts-expect-error replacing location for test
  delete window.location
  // @ts-expect-error search property spread conflict
  window.location = { ...originalLocation, search: '?login_session=test-session', pathname: '/auth/email-challenge' }
}

async function submitEmail() {
  const user = userEvent.setup()
  render(<EmailChallengePage />)
  await user.type(screen.getByLabelText(/email address/i), 'test@example.com')
  await user.click(screen.getByRole('button', { name: /send sign-in code/i }))
  return user
}

function sentResponse() {
  return new Response(JSON.stringify({ sent: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('EmailChallengePage', () => {
  afterEach(() => {
    if (originalLocation) {
      // @ts-expect-error restoring location after test
      window.location = originalLocation
      originalLocation = undefined
    }
    vi.restoreAllMocks()
  })

  it('shows error when login_session is missing', async () => {
    render(<EmailChallengePage />)

    expect(screen.getByText(/missing login session/i)).toBeInTheDocument()
  })

  it('renders email input step', async () => {
    setLoginSession()

    render(<EmailChallengePage />)

    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send sign-in code/i })).toBeInTheDocument()

  })

  it('sends OTP and shows code input step', async () => {
    setLoginSession()
    vi.spyOn(window, 'fetch').mockResolvedValue(sentResponse())
    await submitEmail()

    await waitFor(() => {
      expect(screen.getByLabelText(/sign-in code/i)).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: /verify code/i })).toBeInTheDocument()

  })

  it('handles send OTP failure', async () => {
    setLoginSession()
    vi.spyOn(window, 'fetch').mockRejectedValue(new Error('Network error'))
    await submitEmail()

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument()
    })

  })

  it('handles verify OTP error types', async () => {
    setLoginSession()

    // Mock send OTP
    vi.spyOn(window, 'fetch')
      .mockResolvedValueOnce(sentResponse())
      // Mock verify OTP with error
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'invalid_code' }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
      )

    const user = await submitEmail()

    await waitFor(() => {
      expect(screen.getByLabelText(/sign-in code/i)).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText(/sign-in code/i), '123456')
    await user.click(screen.getByRole('button', { name: /verify code/i }))

    await waitFor(() => {
      expect(screen.getByText(/incorrect code/i)).toBeInTheDocument()
    })

  })

  it('shows use a different email link', async () => {
    setLoginSession()
    vi.spyOn(window, 'fetch').mockResolvedValue(sentResponse())
    const user = await submitEmail()

    await waitFor(() => {
      expect(screen.getByText(/use a different email/i)).toBeInTheDocument()
    })

    await user.click(screen.getByText(/use a different email/i))

    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument()

  })
})
