import { FormEvent, useState } from 'react'
import { SignInButton, TextLinkButton } from './Button'
import { TextField } from './FormControls'
import { SignInPanel } from './SignInPanel'

export function AuthGate({
  onLogin,
  onLoginWithEmail,
  onLoginWithPasskey = async () => {},
  onLoginWithMasterPassword,
  masterPasswordEnabled,
  emailAuthEnabled,
  googleAuthEnabled,
  webauthnEnabled = false,
}: {
  onLogin: () => void
  onLoginWithEmail: () => void
  onLoginWithPasskey?: () => Promise<void>
  onLoginWithMasterPassword: (password: string) => void
  masterPasswordEnabled: boolean
  emailAuthEnabled: boolean
  googleAuthEnabled: boolean
  webauthnEnabled?: boolean
}) {
  const [showMasterPassword, setShowMasterPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const appVersion = import.meta.env.VITE_APP_VERSION?.trim()
  async function submitMasterPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    const response = await fetch('/query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': password,
      },
      body: JSON.stringify({ query: '{ categories { items { id } } }' }),
    })

    setIsSubmitting(false)

    if (!response.ok) {
      setError('That master password was not accepted. Check the password and try again.')
      return
    }

    onLoginWithMasterPassword(password)
  }

  return (
    <SignInPanel
      appVersion={appVersion}
      emailEnabled={emailAuthEnabled}
      googleEnabled={googleAuthEnabled}
      onEmail={onLoginWithEmail}
      onGoogle={onLogin}
      onPasskey={onLoginWithPasskey}
      passkeyEnabled={webauthnEnabled}
      title="Tallyo"
    >
      {masterPasswordEnabled ? (
        !showMasterPassword ? (
          <SignInButton onClick={() => setShowMasterPassword(true)}>
            Sign in with Master Password
          </SignInButton>
        ) : (
          <form className="space-y-3" onSubmit={submitMasterPassword}>
            <TextField autoFocus id="master-password" label="Master Password" onChange={setPassword} required type="password" value={password} />
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
            <button
              className="w-full rounded-xl bg-neutral-800 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting}
              type="submit"
            >
              {isSubmitting ? 'Checking...' : 'Unlock dashboard'}
            </button>
            <TextLinkButton label="Back to sign-in options" onClick={() => { setShowMasterPassword(false); setError(null) }} />
          </form>
        )
      ) : null}
    </SignInPanel>
  )
}
