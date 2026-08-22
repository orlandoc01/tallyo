import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from '@simplewebauthn/browser'
import { PKCE_VERIFIER_KEY, completeOAuthCallback, locationAssigner } from './oauth'
import { authorizedFetch } from './tokenStore'
import { getApiBaseUrl } from '../utils/apiUrl'
import { pkceChallenge, randomString } from './pkce'

const OAUTH_STATE_KEY = 'tallyo-oauth-state'

type WrappedCreationOptions = { publicKey: PublicKeyCredentialCreationOptionsJSON }
type WrappedRequestOptions = { publicKey: PublicKeyCredentialRequestOptionsJSON }

export interface PasskeyCredential {
  id: string
  name: string
  createdAt: string
  lastUsedAt?: string
}

export async function beginPasskeyOAuthLogin() {
  const verifier = randomString(48)
  const state = randomString(24)
  localStorage.setItem(PKCE_VERIFIER_KEY, verifier)
  localStorage.setItem(OAUTH_STATE_KEY, state)

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: 'tallyo-web',
    redirect_uri: `${window.location.origin}/auth/callback`,
    scope: 'read write',
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256',
    auth_method: 'webauthn',
  })

  const res = await fetch(`${getApiBaseUrl()}/authorize?${params.toString()}`)
  if (!res.ok) {
    localStorage.removeItem(PKCE_VERIFIER_KEY)
    localStorage.removeItem(OAUTH_STATE_KEY)
    throw new Error(await res.text() || 'Failed to start passkey login')
  }
  const { login_session_id: loginSessionId } = await res.json() as { login_session_id: string }

  const options = await passkeyLoginBegin(loginSessionId)
  const assertion = await startAuthentication({ optionsJSON: options.publicKey })
  const { redirect_url } = await passkeyLoginFinish(loginSessionId, assertion)

  const url = new URL(redirect_url, window.location.origin)
  if (url.origin !== window.location.origin) throw new Error('Unexpected redirect origin')

  const callbackRes = await fetch(url.href, { headers: { Accept: 'application/json' } })
  if (!callbackRes.ok) throw new Error(await callbackRes.text() || 'Failed to complete authorization')
  const { callback_url: callbackUrl } = await callbackRes.json() as { callback_url: string }
  await completeOAuthCallback(new URL(callbackUrl).search)
  locationAssigner.assign('/expenses/breakdown')
}

async function passkeyLoginBegin(loginSessionId: string) {
  const response = await fetch(`${getApiBaseUrl()}/auth/webauthn/login/begin`, jsonInit({ login_session_id: loginSessionId }))
  return readJSON<WrappedRequestOptions>(response)
}

async function passkeyLoginFinish(loginSessionId: string, assertion: AuthenticationResponseJSON) {
  const response = await fetch(`${getApiBaseUrl()}/auth/webauthn/login/finish`, jsonInit({ login_session_id: loginSessionId, assertion }))
  return readJSON<{ redirect_url: string }>(response)
}

export async function runPasskeyAuthentication(loginSessionId: string) {
  const options = await passkeyLoginBegin(loginSessionId)
  const assertion = await startAuthentication({ optionsJSON: options.publicKey })
  return passkeyLoginFinish(loginSessionId, assertion)
}

export async function runPasskeyRegistration(name: string, email?: string) {
  const options = await passkeyRegisterBegin(name, email)
  const credential = await startRegistration({ optionsJSON: options.publicKey })
  return passkeyRegisterFinish(credential, email)
}

async function passkeyRegisterBegin(name: string, email?: string) {
  const response = await authorizedFetch(`${getApiBaseUrl()}/auth/webauthn/register/begin`, jsonInit({ name, ...(email ? { email } : {}) }))
  return readJSON<WrappedCreationOptions>(response)
}

async function passkeyRegisterFinish(credential: RegistrationResponseJSON, email?: string) {
  const url = `${getApiBaseUrl()}/auth/webauthn/register/finish${email ? `?email=${encodeURIComponent(email)}` : ''}`
  const response = await authorizedFetch(url, jsonInit(credential))
  return readJSON<PasskeyCredential>(response)
}

export async function listPasskeys() {
  const response = await authorizedFetch(`${getApiBaseUrl()}/auth/webauthn/credentials`)
  return readJSON<PasskeyCredential[]>(response)
}

export async function renamePasskey(id: string, name: string) {
  const response = await authorizedFetch(`${getApiBaseUrl()}/auth/webauthn/credentials/${encodeURIComponent(id)}`, jsonInit({ name }, 'PATCH'))
  if (!response.ok) throw new Error(await response.text() || 'Failed to rename passkey')
}

export async function deletePasskey(id: string) {
  const response = await authorizedFetch(`${getApiBaseUrl()}/auth/webauthn/credentials/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!response.ok) throw new Error(await response.text() || 'Failed to delete passkey')
}

function jsonInit(body: unknown, method = 'POST'): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

async function readJSON<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await response.text() || 'Request failed')
  return response.json() as Promise<T>
}
