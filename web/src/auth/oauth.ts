import { setTokens } from './tokenStore'
import { pkceChallenge, randomString } from './pkce'
import { getApiBaseUrl } from '../utils/apiUrl'
import { markActivity } from '../hooks/useIdleTimeout'

export const PKCE_VERIFIER_KEY = 'tallyo-pkce-verifier'
const STATE_KEY = 'tallyo-oauth-state'

/**
 * Starts the OAuth authorization-code + PKCE flow by navigating to the server
 * `/authorize` endpoint with a freshly generated verifier and state. Pass
 * `authMethod` (e.g. 'email') to pick a non-default server login method.
 */
export async function beginAuthorize(authMethod?: string) {
  const verifier = randomString(48)
  const state = randomString(24)
  localStorage.setItem(PKCE_VERIFIER_KEY, verifier)
  localStorage.setItem(STATE_KEY, state)

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: 'tallyo-web',
    redirect_uri: `${window.location.origin}/auth/callback`,
    scope: 'read write',
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256',
  })
  if (authMethod) params.set('auth_method', authMethod)
  locationAssigner.assign(`${getApiBaseUrl()}/authorize?${params.toString()}`)
}

export function beginOAuthLogin() {
  return beginAuthorize('google')
}

export async function completeOAuthCallback(search: string) {
  const params = new URLSearchParams(search)
  const code = params.get('code')
  const state = params.get('state')

  // Magic link flow: verifier arrives via a short-lived cookie set by the server.
  // Normal flow: verifier is in localStorage from when the auth was initiated.
  const cookieVerifier = getCookieVerifier()
  const verifier = cookieVerifier ?? localStorage.getItem(PKCE_VERIFIER_KEY)
  const expectedState = localStorage.getItem(STATE_KEY)

  if (!code || !state || !verifier) {
    throw new Error('Invalid OAuth callback state')
  }
  // Only enforce state match for non-magic-link flows; the magic token already verified identity.
  if (!cookieVerifier && state !== expectedState) {
    throw new Error('Invalid OAuth callback state')
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    client_id: 'tallyo-web',
    redirect_uri: `${window.location.origin}/auth/callback`,
  })
  const response = await fetch(`${getApiBaseUrl()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) {
    throw new Error('Token exchange failed')
  }
  const data = await response.json() as { access_token: string; refresh_token: string }
  setTokens(data.access_token, data.refresh_token)
  markActivity()
  if (cookieVerifier) {
    clearCookieVerifier()
  }
  localStorage.removeItem(PKCE_VERIFIER_KEY)
  localStorage.removeItem(STATE_KEY)
}

function getCookieVerifier(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)pkce-verifier=([^;]+)/)
  return match ? match[1] : null
}

function clearCookieVerifier() {
  document.cookie = 'pkce-verifier=; max-age=0; path=/auth/callback'
  document.cookie = 'pkce-verifier=; max-age=0; path=/'
}

export const locationAssigner = {
  assign(url: string) {
    window.location.assign(url)
  },
}
