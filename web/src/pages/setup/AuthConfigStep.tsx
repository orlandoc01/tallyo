import clsx from 'clsx'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { AtSign, Fingerprint, Mail } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '../../components/common/Button'
import { Modal } from '../../components/common/Modal'
import { useSetup } from './useSetup'
import { SetupActions, SetupFieldGrid, SetupHeading, SetupListCard, SetupMessage, SetupTextField } from './SetupLayout'

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
      <SetupHeading subtitle="Values are staged locally until the final step. Issuer and redirect URLs are inferred from this browser session." title="Sign-in providers" />

      <SetupFieldGrid className="mt-4">
        <SetupTextField label="OAuth issuer URL" mono value={setup.oauthIssuerUrl} onChange={(oauthIssuerUrl) => setup.updateSetup({ oauthIssuerUrl })} />
        <SetupTextField label="Frontend redirect URI" mono value={setup.frontendRedirectUris} onChange={(frontendRedirectUris) => setup.updateSetup({ frontendRedirectUris })} />
      </SetupFieldGrid>

      <div className="my-5 h-px bg-border" />
      <h2 className="text-sm font-semibold text-text-1">Providers</h2>

      <SetupListCard className="mt-2">
        <ProviderRow checked={setup.passkeyEnabled} icon={Fingerprint} onChange={(passkeyEnabled) => setup.updateSetup({ passkeyEnabled })} sub="WebAuthn device credentials" title="Passkey">
          <SetupTextField label="RP ID" mono value={setup.webauthnRpId} onChange={(webauthnRpId) => setup.updateSetup({ webauthnRpId })} />
          <SetupTextField label="Origins" mono value={setup.webauthnRpOrigins} onChange={(webauthnRpOrigins) => setup.updateSetup({ webauthnRpOrigins })} />
        </ProviderRow>
        <ProviderRow checked={setup.emailEnabled} icon={Mail} onChange={(emailEnabled) => setup.updateSetup({ emailEnabled })} sub="Magic-link sign-in over SMTP" title="Email">
          <SetupTextField label="SMTP host" value={setup.smtpHost} onChange={(smtpHost) => setup.updateSetup({ smtpHost })} />
          <SetupTextField label="SMTP from" value={setup.smtpFrom} onChange={(smtpFrom) => setup.updateSetup({ smtpFrom })} />
          <SetupTextField label="SMTP username" value={setup.smtpUsername} onChange={(smtpUsername) => setup.updateSetup({ smtpUsername })} />
          <SetupTextField label="SMTP password" type="password" value={setup.smtpPassword} onChange={(smtpPassword) => setup.updateSetup({ smtpPassword })} />
        </ProviderRow>
        <ProviderRow checked={setup.googleEnabled} icon={AtSign} onChange={(googleEnabled) => setup.updateSetup({ googleEnabled })} sub="Google Sign-In (OIDC)" title="Google">
          <SetupTextField label="Client ID" mono value={setup.googleClientId} onChange={(googleClientId) => setup.updateSetup({ googleClientId })} />
          <SetupTextField label="Client secret" type="password" value={setup.googleClientSecret} onChange={(googleClientSecret) => setup.updateSetup({ googleClientSecret })} />
        </ProviderRow>
      </SetupListCard>

      {error ? <SetupMessage tone="negative">{error}</SetupMessage> : null}

      {showGoogleReminder ? (
        <Modal labelledBy="google-reminder-title" onClose={() => setShowGoogleReminder(false)}>
          <h2 className="text-[15px] font-semibold text-text-1" id="google-reminder-title">Before you continue</h2>
          <p className="mt-2 text-[13px] text-text-2">
            Make sure you've added the following as an authorized redirect URI in your{' '}
            <strong className="font-semibold">Google Cloud Console</strong> project, otherwise sign-in will fail.
          </p>
          <p className="mt-3 break-all rounded-md border border-border bg-surface-2 px-2.5 py-2 font-mono text-xs text-text-1">
            {setup.oauthIssuerUrl || '<issuer URL>'}/auth/google/callback
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setShowGoogleReminder(false)} variant="secondary">Go back</Button>
            <Button onClick={() => navigate('/setup/register')}>Yes, I've added it</Button>
          </div>
        </Modal>
      ) : null}

      <SetupActions>
        <Button onClick={() => navigate(setup.passwordEnabled ? '/setup/password-setup' : '/setup/security')} variant="secondary">Back</Button>
        <Button onClick={continueSetup}>Continue</Button>
      </SetupActions>
    </div>
  )
}

function ProviderRow({ icon: Icon, title, sub, checked, onChange, children }: { icon: LucideIcon; title: string; sub: string; checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <div>
      <button
        aria-checked={checked}
        aria-label={title}
        className="flex h-11 w-full select-none items-center gap-3 px-4 text-left transition hover:bg-raised"
        onClick={() => onChange(!checked)}
        role="switch"
        type="button"
      >
        <Icon aria-hidden className="h-4 w-4 text-text-muted" strokeWidth={1.6} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-text-1">{title}</span>
          <span className="block text-xs text-text-muted">{sub}</span>
        </span>
        <span aria-hidden className={clsx('relative h-5 w-9 flex-none rounded-[10px] transition-colors duration-200', checked ? 'bg-brand-600' : 'bg-border-strong')}>
          <span className={clsx('absolute left-0.5 top-0.5 h-4 w-4 rounded-[8px] bg-surface transition-transform duration-200', checked && 'translate-x-4')} />
        </span>
      </button>
      {checked ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-4 gap-y-3 border-t border-border bg-surface-2 px-4 pb-4 pt-3.5">
          {children}
        </div>
      ) : null}
    </div>
  )
}
