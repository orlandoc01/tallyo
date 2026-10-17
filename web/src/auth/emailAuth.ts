import { beginAuthorize } from './oauth'
import { setLastEmail } from './tokenStore'
import { getApiBaseUrl } from '../utils/apiUrl'

export function beginEmailOAuthLogin() {
  return beginAuthorize('email')
}

export async function sendEmailOTP(loginSessionId: string, email: string): Promise<void> {
  setLastEmail(email)
  const response = await fetch(`${getApiBaseUrl()}/auth/email/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login_session_id: loginSessionId, email }),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(errorMessage(text) || 'Failed to send OTP email')
  }
}

// Session-expiry failures arrive as `{ error, message }` JSON; everything else is plain text.
function errorMessage(text: string): string {
  try {
    const data = JSON.parse(text) as { message?: string }
    return typeof data.message === 'string' ? data.message : text
  } catch {
    return text
  }
}

export async function verifyEmailOTP(
  loginSessionId: string,
  email: string,
  code: string,
): Promise<string> {
  const response = await fetch(`${getApiBaseUrl()}/auth/email/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login_session_id: loginSessionId, email, code }),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'unknown' }))
    throw new Error(data.error || 'Verification failed')
  }
  const data = await response.json() as { redirect_url: string }
  return data.redirect_url
}
