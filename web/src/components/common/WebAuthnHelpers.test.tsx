import { afterEach, describe, expect, it, vi } from 'vitest'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { deletePasskey, listPasskeys, renamePasskey, runPasskeyAuthentication, runPasskeyRegistration } from '../../auth/webauthn'
import { jsonResponse } from '../../test/http'

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}))

describe('webauthn helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('runs the passkey login ceremony', async () => {
    vi.spyOn(window, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ publicKey: { challenge: 'abc', rpId: 'localhost' } }))
      .mockResolvedValueOnce(jsonResponse({ redirect_url: 'http://localhost/authorize?session_id=abc' }))
    vi.mocked(startAuthentication).mockResolvedValue({ id: 'cred', rawId: 'cred', response: { clientDataJSON: 'c', authenticatorData: 'a', signature: 's' }, type: 'public-key', clientExtensionResults: {} })

    await expect(runPasskeyAuthentication('login-1')).resolves.toEqual({ redirect_url: 'http://localhost/authorize?session_id=abc' })

    expect(startAuthentication).toHaveBeenCalled()
  })

  it('runs management requests', async () => {
    vi.spyOn(window, 'fetch')
      .mockResolvedValueOnce(jsonResponse([{ id: 'cred-1', name: 'iPhone', createdAt: '2026-05-20T12:00:00Z' }]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ publicKey: { challenge: 'abc', rp: { id: 'localhost', name: 'Tallyo' }, user: { id: 'u', name: 'a', displayName: 'a' }, pubKeyCredParams: [] } }))
      .mockResolvedValueOnce(jsonResponse({ id: 'cred-2', name: 'Mac', createdAt: '2026-05-21T12:00:00Z' }))
    vi.mocked(startRegistration).mockResolvedValue({ id: 'cred-2', rawId: 'cred-2', response: { clientDataJSON: 'c', attestationObject: 'a' }, type: 'public-key', clientExtensionResults: {} })

    await expect(listPasskeys()).resolves.toHaveLength(1)
    await expect(renamePasskey('cred-1', 'Mac')).resolves.toBeUndefined()
    await expect(deletePasskey('cred-1')).resolves.toBeUndefined()
    await expect(runPasskeyRegistration('Mac')).resolves.toEqual({ id: 'cred-2', name: 'Mac', createdAt: '2026-05-21T12:00:00Z' })
  })
})
