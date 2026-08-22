import { afterEach, describe, expect, it, vi } from 'vitest'
import { beginOAuthLogin, completeOAuthCallback, locationAssigner } from '../../auth/oauth'
import { authorizedFetch, clearMasterPassword, clearTokens, hasAccessToken, hasRefreshToken, refreshAccessToken, setMasterPassword, setTokens } from '../../auth/tokenStore'
import { jsonResponse } from '../../test/http'

describe('OAuth token flow', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    clearTokens()
    clearMasterPassword()
    localStorage.clear()
  })

  it('exchanges the callback code for tokens', async () => {
    localStorage.setItem('tallyo-pkce-verifier', 'verifier')
    localStorage.setItem('tallyo-oauth-state', 'state')
    const fetchMock = vi.spyOn(window, 'fetch').mockResolvedValue(jsonResponse({ access_token: 'access', refresh_token: 'refresh' }))

    await completeOAuthCallback('?code=code&state=state')

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/token', expect.objectContaining({ method: 'POST' }))
    expect(hasAccessToken()).toBe(true)
    expect(hasRefreshToken()).toBe(true)
  })

  it('starts login with PKCE parameters', async () => {
    const assign = vi.spyOn(locationAssigner, 'assign').mockImplementation(() => undefined)

    await beginOAuthLogin()

    const redirect = new URL(assign.mock.calls[0][0] as string)
    expect(redirect.pathname).toBe('/authorize')
    expect(redirect.searchParams.get('client_id')).toBe('tallyo-web')
    expect(redirect.searchParams.get('auth_method')).toBe('google')
    expect(redirect.searchParams.get('code_challenge_method')).toBe('S256')
    expect(localStorage.getItem('tallyo-pkce-verifier')).toBeTruthy()
  })

  it('rejects a mismatched callback state', async () => {
    localStorage.setItem('tallyo-pkce-verifier', 'verifier')
    localStorage.setItem('tallyo-oauth-state', 'state')

    await expect(completeOAuthCallback('?code=code&state=wrong')).rejects.toThrow(/state/i)
  })

  it('refreshes and retries authorized fetches after a 401', async () => {
    setTokens('old-access', 'refresh')
    const fetchMock = vi.spyOn(window, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'new-access', refresh_token: 'new-refresh' }))
      .mockResolvedValueOnce(new Response('ok'))

    const response = await authorizedFetch('/query', { headers: { 'Content-Type': 'application/json' } })

    expect(await response.text()).toBe('ok')
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/query', expect.objectContaining({ headers: expect.any(Headers) }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'http://localhost:3000/token', expect.objectContaining({ method: 'POST' }))
    const retriedRequest = fetchMock.mock.calls[2][1] as RequestInit
    expect((retriedRequest.headers as Headers).get('Authorization')).toBe('Bearer new-access')
  })

  it('clears tokens when refresh fails', async () => {
    setTokens('access', 'refresh')
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response('bad', { status: 400 }))

    await expect(refreshAccessToken()).resolves.toBe(false)

    expect(hasAccessToken()).toBe(false)
    expect(hasRefreshToken()).toBe(false)
  })

  it('sends X-API-Key when no access token is present', async () => {
    setMasterPassword('my-master-password')
    const fetchMock = vi.spyOn(window, 'fetch').mockResolvedValue(new Response('ok'))

    const response = await authorizedFetch('/query')

    expect(await response.text()).toBe('ok')
    const request = fetchMock.mock.calls[0][1] as RequestInit
    const headers = request.headers as Headers
    expect(headers.get('X-API-Key')).toBe('my-master-password')
    expect(headers.get('Authorization')).toBeNull()
  })

  it('prefers Bearer over master password when both are present', async () => {
    setTokens('access', 'refresh')
    setMasterPassword('my-master-password')
    const fetchMock = vi.spyOn(window, 'fetch').mockResolvedValue(new Response('ok'))

    const response = await authorizedFetch('/query')

    expect(await response.text()).toBe('ok')
    const request = fetchMock.mock.calls[0][1] as RequestInit
    const headers = request.headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer access')
    expect(headers.get('X-API-Key')).toBeNull()
  })
})
