import { useState } from 'react'
import { useNavigate } from 'react-router'
import { AtSign, Fingerprint, Mail } from 'lucide-react'
import type { ReactNode } from 'react'
import { FormError } from '../../components/common/FormControls'
import { useSetup } from './useSetup'
import { SetupActions, SetupHeading, SetupTextField, primaryButtonClass, secondaryButtonClass } from './SetupLayout'

export function AuthConfigStep() {
  const navigate = useNavigate()
  const setup = useSetup()
  const [error, setError] = useState<string | null>(null)
  const [showGoogleReminder, setShowGoogleReminder] = useState(false)
  const hasProvider = setup.passkeyEnabled || setup.emailEnabled || setup.googleEnabled

  function continueSetup() {
    if (!hasProvider) {
      setError('Enable at least one sign-in method.')
      return
    }
    if (setup.googleEnabled) {
      setShowGoogleReminder(true)
      return
    }
    navigate('/setup/register')
  }

  return (
    <div>
      <SetupHeading eyebrow="OAuth setup" title="Choose sign-in providers" />
      <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600">These values are staged locally until the final step. OAuth issuer and redirect URLs are inferred from this browser session.</p>

      <div className="mt-8 grid gap-5 sm:grid-cols-2">
        <SetupTextField label="OAuth issuer URL" value={setup.oauthIssuerUrl} onChange={(oauthIssuerUrl) => setup.updateSetup({ oauthIssuerUrl })} />
        <SetupTextField label="Frontend redirect URI" value={setup.frontendRedirectUris} onChange={(frontendRedirectUris) => setup.updateSetup({ frontendRedirectUris })} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <ProviderSection
          icon={<Fingerprint className="h-5 w-5" />}
          title="Passkey"
          checked={setup.passkeyEnabled}
          onChange={(passkeyEnabled) => setup.updateSetup({ passkeyEnabled })}
        >
          <SetupTextField label="RP ID" value={setup.webauthnRpId} onChange={(webauthnRpId) => setup.updateSetup({ webauthnRpId })} />
          <SetupTextField label="Origins" value={setup.webauthnRpOrigins} onChange={(webauthnRpOrigins) => setup.updateSetup({ webauthnRpOrigins })} />
        </ProviderSection>

        <ProviderSection
          icon={<Mail className="h-5 w-5" />}
          title="Email"
          checked={setup.emailEnabled}
          onChange={(emailEnabled) => setup.updateSetup({ emailEnabled })}
        >
          <SetupTextField label="SMTP host" value={setup.smtpHost} onChange={(smtpHost) => setup.updateSetup({ smtpHost })} />
          <SetupTextField label="SMTP from" value={setup.smtpFrom} onChange={(smtpFrom) => setup.updateSetup({ smtpFrom })} />
          <SetupTextField label="SMTP username" value={setup.smtpUsername} onChange={(smtpUsername) => setup.updateSetup({ smtpUsername })} />
          <SetupTextField label="SMTP password" type="password" value={setup.smtpPassword} onChange={(smtpPassword) => setup.updateSetup({ smtpPassword })} />
        </ProviderSection>

        <ProviderSection
          icon={<AtSign className="h-5 w-5" />}
          title="Google"
          checked={setup.googleEnabled}
          onChange={(googleEnabled) => setup.updateSetup({ googleEnabled })}
        >
          <SetupTextField label="Client ID" value={setup.googleClientId} onChange={(googleClientId) => setup.updateSetup({ googleClientId })} />
          <SetupTextField label="Client secret" type="password" value={setup.googleClientSecret} onChange={(googleClientSecret) => setup.updateSetup({ googleClientSecret })} />
        </ProviderSection>
      </div>

      {error ? <FormError className="mt-5 font-semibold">{error}</FormError> : null}

      {showGoogleReminder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-black text-neutral-900">Before you continue</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-600">
              Make sure you've added the following as an authorized redirect URI in your{' '}
              <strong className="font-semibold text-neutral-800">Google Cloud Console</strong> project, otherwise sign-in will fail.
            </p>
            <p className="mt-3 break-all rounded-xl bg-brand-50 px-3 py-2 font-mono text-xs font-semibold text-brand-800">
              {setup.oauthIssuerUrl || '<issuer URL>'}/auth/google/callback
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button className={secondaryButtonClass} onClick={() => setShowGoogleReminder(false)} type="button">Go back</button>
              <button className={primaryButtonClass} onClick={() => navigate('/setup/register')} type="button">Yes, I've added it</button>
            </div>
          </div>
        </div>
      )}

      <SetupActions>
        <button className={secondaryButtonClass} onClick={() => navigate(setup.passwordEnabled ? '/setup/password-setup' : '/setup/security')} type="button">Back</button>
        <button className={primaryButtonClass} onClick={continueSetup} type="button">Continue</button>
      </SetupActions>
    </div>
  )
}

function ProviderSection({ icon, title, checked, onChange, children }: { icon: ReactNode; title: string; checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <div>
      <button
        className={`w-full rounded-2xl border p-4 text-left transition ${checked ? 'border-brand-600 bg-brand-50' : 'border-brand-100 bg-white hover:border-brand-300'}`}
        onClick={() => onChange(!checked)}
        type="button"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-100 text-brand-600">{icon}</span>
            <span className="font-bold text-neutral-900">{title}</span>
          </div>
          <span className={`h-6 w-11 rounded-full p-1 transition ${checked ? 'bg-brand-600' : 'bg-neutral-200'}`}>
            <span className={`block h-4 w-4 rounded-full bg-white transition ${checked ? 'translate-x-5' : ''}`} />
          </span>
        </div>
      </button>
      {checked && (
        <div className="mt-3 space-y-3 px-1">
          {children}
        </div>
      )}
    </div>
  )
}
