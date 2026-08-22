import { beginAuthorize, PKCE_VERIFIER_KEY } from './oauth'
import { setLastEmail } from './tokenStore'
import { getApiBaseUrl } from '../utils/apiUrl'

export function beginEmailOAuthLogin() {
  return beginAuthorize('email')
}

export async function sendEmailOTP(loginSessionId: string, email: string): Promise<void> {
  setLastEmail(email)
  const codeVerifier = localStorage.getItem(PKCE_VERIFIER_KEY) ?? ''
  const response = await fetch(`${getApiBaseUrl()}/auth/email/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login_session_id: loginSessionId, email, code_verifier: codeVerifier }),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || 'Failed to send OTP email')
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
