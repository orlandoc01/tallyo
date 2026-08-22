import { useCallback, useEffect, useState } from 'react'
import { sendEmailOTP, verifyEmailOTP } from '../auth/emailAuth'
import { getLastEmail } from '../auth/tokenStore'
import { TextLinkButton } from '../components/common/Button'
import { FormError, TextField } from '../components/common/FormControls'
import { AuthPageShell } from '../components/common/SignInPanel'

export function EmailChallengePage() {
  const [loginSessionId, setLoginSessionId] = useState<string | null>(null)
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState(() => getLastEmail())
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [otpSent, setOtpSent] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const lsid = params.get('login_session')
    if (lsid) {
      setLoginSessionId(lsid)
    } else {
      setError('Missing login session. Please start over.')
    }
  }, [])

  const handleSendCode = useCallback(async () => {
    if (!loginSessionId || !email) return
    setError(null)
    setIsSubmitting(true)
    try {
      await sendEmailOTP(loginSessionId, email)
      setOtpSent(true)
      setStep('code')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send code')
    } finally {
      setIsSubmitting(false)
    }
  }, [loginSessionId, email])

  const handleVerifyCode = useCallback(async () => {
    if (!loginSessionId || !email || !code) return
    setError(null)
    setIsSubmitting(true)
    try {
      const redirectUrl = await verifyEmailOTP(loginSessionId, email, code)
      // Validate the redirect stays on the same origin to prevent open-redirect attacks.
      const parsed = new URL(redirectUrl, window.location.origin)
      if (parsed.origin !== window.location.origin) {
        throw new Error('Unexpected redirect origin')
      }
      window.location.assign(parsed.href)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Verification failed'
      if (msg === 'too_many_attempts') {
        setError('Too many incorrect attempts. Please refresh and start over.')
      } else if (msg === 'expired') {
        setError('Code has expired. Please go back and request a new one.')
      } else if (msg === 'invalid_code') {
        setError('Incorrect code. Please try again.')
      } else {
        setError('Sign-in failed. Please try again.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }, [loginSessionId, email, code])

  if (!loginSessionId) {
    return (
      <AuthPageShell>
        <p className="text-neutral-600">{error || 'Loading...'}</p>
      </AuthPageShell>
    )
  }

  return (
    <AuthPageShell>
      <div className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-brand-600">Tallyo</p>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-neutral-950">
          {step === 'email' ? 'Sign in with email' : 'Check your email'}
        </h1>
        <p className="mt-2 text-sm leading-6 text-neutral-500">
          {step === 'email'
            ? 'Enter your email address to receive a sign-in code.'
            : otpSent
              ? `We sent a sign-in link and a code to ${email}. Click the link in the email or enter the code below. Both expire in 10 minutes.`
              : 'Sending code...'}
        </p>
      </div>

      {error ? <FormError className="mb-4">{error}</FormError> : null}

      {step === 'email' ? (
        <div className="space-y-4">
          <TextField autoFocus id="email" label="Email address" onChange={setEmail} placeholder="you@example.com" required type="email" value={email} />
          <button
            className="w-full rounded-xl bg-brand-500 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting || !email}
            onClick={handleSendCode}
            type="button"
          >
            {isSubmitting ? 'Sending...' : 'Send sign-in code'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <TextField autoFocus controlClassName="text-center text-2xl tracking-[0.4em]" id="code" inputMode="numeric" label="Sign-in code" maxLength={6} onChange={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" required type="text" value={code} />
          <button
            className="w-full rounded-xl bg-neutral-800 px-4 py-3 font-semibold text-white shadow-sm transition hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting || code.length !== 6}
            onClick={handleVerifyCode}
            type="button"
          >
            {isSubmitting ? 'Verifying...' : 'Verify code'}
          </button>
          <TextLinkButton label="Use a different email" onClick={() => { setStep('email'); setError(null) }} />
        </div>
      )}
    </AuthPageShell>
  )
}
