import { useEffect, useState } from 'react'
import { runPasskeyAuthentication } from '../auth/webauthn'
import { SignInPanel } from '../components/common/SignInPanel'
import { getApiBaseUrl } from '../utils/apiUrl'

type AuthConfig = {
  google_auth_enabled: boolean
  email_auth_enabled: boolean
  webauthn_enabled: boolean
}

export function LoginPage() {
  const [loginSessionId, setLoginSessionId] = useState<string | null>(null)
  const [config, setConfig] = useState<AuthConfig | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const sessionId = params.get('login_session')
    if (!sessionId) {
      setError('Missing login session. Please start over.')
      return
    }
    setLoginSessionId(sessionId)

    fetch(`${getApiBaseUrl()}/auth/config`)
      .then((response) => {
        if (!response.ok) throw new Error('Failed to load sign-in options')
        return response.json() as Promise<AuthConfig>
      })
      .then(setConfig)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load sign-in options'))
  }, [])

  function continueWithGoogle() {
    if (!loginSessionId) return
    window.location.assign(`${getApiBaseUrl()}/auth/google?login_session=${encodeURIComponent(loginSessionId)}`)
  }

  function continueWithEmail() {
    if (!loginSessionId) return
    window.location.assign(`/auth/email-challenge?login_session=${encodeURIComponent(loginSessionId)}`)
  }

  async function continueWithPasskey() {
    if (!loginSessionId) return
    setError(null)
    const { redirect_url: redirectUrl } = await runPasskeyAuthentication(loginSessionId)
    const parsed = new URL(redirectUrl, window.location.origin)
    if (parsed.origin !== window.location.origin) throw new Error('Unexpected redirect origin')
    window.location.assign(parsed.href)
  }

  return (
    <SignInPanel
      emailEnabled={config?.email_auth_enabled ?? false}
      error={error}
      eyebrow="Tallyo"
      googleEnabled={config?.google_auth_enabled ?? false}
      loadingMessage={!error && !config ? 'Loading sign-in options...' : undefined}
      onEmail={continueWithEmail}
      onGoogle={continueWithGoogle}
      onPasskey={continueWithPasskey}
      passkeyEnabled={config?.webauthn_enabled ?? false}
      subtitle="Choose an enabled sign-in method to finish connecting your client."
      title="Sign in to continue"
    />
  )
}
