import { useState, type ReactNode } from 'react'
import { FormError } from './FormControls'

type SignInPanelProps = {
  title: string
  eyebrow?: string
  subtitle?: ReactNode
  appVersion?: string
  error?: string | null
  loadingMessage?: string
  googleAutoFocus?: boolean
  googleEnabled: boolean
  emailEnabled: boolean
  passkeyEnabled: boolean
  onGoogle: () => void
  onEmail: () => void
  onPasskey?: () => Promise<void>
  children?: ReactNode
}

export function SignInPanel({
  title,
  eyebrow,
  subtitle,
  appVersion,
  error,
  loadingMessage,
  googleAutoFocus = false,
  googleEnabled,
  emailEnabled,
  passkeyEnabled,
  onGoogle,
  onEmail,
  onPasskey,
  children,
}: SignInPanelProps) {
  const [passkeyError, setPasskeyError] = useState<string | null>(null)
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false)
  const passkeyAvailable = typeof window !== 'undefined' && 'PublicKeyCredential' in window
  const showPasskey = passkeyEnabled && passkeyAvailable && Boolean(onPasskey)
  const displayError = error ?? passkeyError

  function continueWithPasskey() {
    if (!onPasskey) return
    setPasskeyError(null)
    setIsPasskeyLoading(true)
    onPasskey().catch((e: unknown) => {
      setPasskeyError(e instanceof Error ? e.message : 'Passkey sign-in failed')
      setIsPasskeyLoading(false)
    })
  }

  return (
    <AuthPageShell>
      <div className="mb-8 text-center">
        {eyebrow ? <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">{eyebrow}</p> : null}
        <h1 className={`${eyebrow ? 'mt-3 text-3xl' : 'text-4xl'} font-bold tracking-tight text-neutral-950`}>{title}</h1>
        {appVersion ? <p className="mt-1 text-xs text-neutral-400">{appVersion}</p> : null}
        {subtitle ? <p className="mt-3 text-sm leading-6 text-neutral-500">{subtitle}</p> : null}
      </div>

      {displayError ? <FormError className="mb-4">{displayError}</FormError> : null}

      {!displayError && loadingMessage ? <p className="text-sm text-neutral-500">{loadingMessage}</p> : null}

      {!loadingMessage ? (
        <div className="space-y-3">
          {googleEnabled ? (
            <button autoFocus={googleAutoFocus} className="w-full rounded-xl bg-brand-500 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-brand-600" onClick={onGoogle} type="button">
              Sign in with Google
            </button>
          ) : null}
          {emailEnabled ? (
            <button className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 font-semibold text-neutral-700 shadow-sm transition hover:bg-neutral-50" onClick={onEmail} type="button">
              Sign in with email
            </button>
          ) : null}
          {showPasskey ? (
            <button className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 font-semibold text-neutral-700 shadow-sm transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60" disabled={isPasskeyLoading} onClick={continueWithPasskey} type="button">
              {isPasskeyLoading ? 'Waiting for passkey...' : 'Sign in with Passkey'}
            </button>
          ) : null}
          {children}
          {!displayError && !googleEnabled && !emailEnabled && !showPasskey && !children ? <p className="text-sm text-neutral-500">No supported sign-in methods are enabled.</p> : null}
        </div>
      ) : null}
    </AuthPageShell>
  )
}

export function AuthPageShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4">
      <section className="w-full max-w-md rounded-3xl border border-neutral-200 bg-white p-8 shadow-card">{children}</section>
    </main>
  )
}
