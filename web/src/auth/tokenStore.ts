import { getApiBaseUrl } from '../utils/apiUrl'
import { parseScopesFromToken } from './permissions'

const REFRESH_TOKEN_KEY = 'tallyo-refresh-token'
const MASTER_PASSWORD_STORAGE_KEY = 'tallyo-master-password'
const LAST_EMAIL_KEY = 'tallyo-last-email'

let accessToken: string | null = null

export function getScopes(): string[] {
  return parseScopesFromToken(accessToken)
}

export function hasAccessToken() {
  return Boolean(accessToken)
}

export function setTokens(nextAccessToken: string, refreshToken: string) {
  accessToken = nextAccessToken
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
}

export function clearTokens() {
  accessToken = null
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

export function hasRefreshToken() {
  return Boolean(localStorage.getItem(REFRESH_TOKEN_KEY))
}

let refreshPromise: Promise<boolean> | null = null

export async function refreshAccessToken(): Promise<boolean> {
  // De-duplicate concurrent refresh attempts: if a refresh is already in
  // flight, return the same promise so only one token exchange hits the server.
  if (refreshPromise) return refreshPromise
  refreshPromise = doRefresh().finally(() => { refreshPromise = null })
  return refreshPromise
}

async function doRefresh(): Promise<boolean> {
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY)
  if (!refreshToken) return false

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: 'tallyo-web',
  })
  const response = await fetch(`${getApiBaseUrl()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) {
    clearTokens()
    return false
  }
  const data = await response.json() as { access_token: string; refresh_token: string }
  setTokens(data.access_token, data.refresh_token)
  return true
}

export async function authorizedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const first = await fetchWithToken(input, init)
  if (first.status !== 401 || !(await refreshAccessToken())) {
    return first
  }
  return fetchWithToken(input, init)
}

function fetchWithToken(input: RequestInfo | URL, init: RequestInit) {
  const headers = new Headers(init.headers)
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  } else if (getMasterPassword()) {
    headers.set('X-API-Key', getMasterPassword()!)
  }
  return fetch(input, { ...init, headers })
}

export function getMasterPassword() {
  if (typeof localStorage === 'undefined') return null
  return localStorage.getItem(MASTER_PASSWORD_STORAGE_KEY)
}

export function setMasterPassword(password: string) {
  localStorage.setItem(MASTER_PASSWORD_STORAGE_KEY, password)
}

export function clearMasterPassword() {
  localStorage.removeItem(MASTER_PASSWORD_STORAGE_KEY)
}

export function hasMasterPassword() {
  return Boolean(getMasterPassword())
}

export function getLastEmail() {
  if (typeof localStorage === 'undefined') return ''
  return localStorage.getItem(LAST_EMAIL_KEY) ?? ''
}

export function setLastEmail(email: string) {
  localStorage.setItem(LAST_EMAIL_KEY, email)
}
