import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { AlertCircle, Check, KeyRound, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { useAuth } from '../../auth/useAuth'
import { OBFUSCATED_SECRET } from './setupState'
import { useSetup } from './useSetup'
import { SetupActions, SetupHeading, primaryButtonClass, secondaryButtonClass } from './SetupLayout'

export function SecurityChoiceStep() {
  const navigate = useNavigate()
  const setup = useSetup()
  const { masterPasswordStatus } = useAuth()
  const initializedDefault = useRef(false)

  useEffect(() => {
    if (initializedDefault.current || masterPasswordStatus === 'DISABLED') return
    initializedDefault.current = true
    if (!setup.passwordEnabled) setup.updateSetup({ passwordEnabled: true, masterPassword: setup.masterPassword || OBFUSCATED_SECRET })
  }, [masterPasswordStatus, setup])

  function continueSetup() {
    if (setup.passwordEnabled) navigate('/setup/password-setup')
    else if (setup.oauthEnabled) navigate('/setup/oauth-setup')
  }

  return (
    <div>
      <SetupHeading eyebrow="Security model" title="How should this instance be protected?" />
      <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600">You can keep the bootstrap master password for a private household server, or configure OAuth providers for multi-user and public-hosted deployments.</p>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <ChoiceCard
          description="Set a master password for private networks or VPN-only access."
          icon={<KeyRound className="h-6 w-6" />}
          selected={setup.passwordEnabled}
          tag={masterPasswordStatus !== 'DISABLED' ? 'Existing' : undefined}
          title="Single Password"
          warning={masterPasswordStatus === 'ENV_VAR_OVERRIDE' ? 'Currently set by ENV VAR, which overrides whatever you set here' : undefined}
          onClick={() => setup.updateSetup({ passwordEnabled: !setup.passwordEnabled })}
        />
        <ChoiceCard
          description="Enable passkeys, email, or Google Sign-In with users managed inside Tallyo."
          icon={<ShieldCheck className="h-6 w-6" />}
          selected={setup.oauthEnabled}
          title="OAuth"
          onClick={() => setup.updateSetup({ oauthEnabled: !setup.oauthEnabled })}
        />
      </div>
      <SetupActions>
        <button className={secondaryButtonClass} onClick={() => navigate('/setup/welcome')} type="button">Back</button>
        <button className={primaryButtonClass} disabled={!setup.passwordEnabled && !setup.oauthEnabled} onClick={continueSetup} type="button">Continue</button>
      </SetupActions>
    </div>
  )
}

function ChoiceCard({ icon, title, tag, warning, description, selected, onClick }: { icon: ReactNode; title: string; tag?: string; warning?: string; description: string; selected: boolean; onClick: () => void }) {
  return (
    <button className={`relative rounded-2xl border p-6 text-left transition ${selected ? 'border-brand-600 bg-brand-50 shadow-xl shadow-brand-600/10' : 'border-brand-100 bg-white hover:border-brand-300'}`} onClick={onClick} type="button">
      {selected ? <span className="absolute right-5 top-5 grid h-7 w-7 place-items-center rounded-full bg-brand-600 text-white"><Check className="h-4 w-4" /></span> : null}
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-100 text-brand-600">{icon}</div>
      <div className="mt-5 flex items-center gap-2">
        {warning ? <span title={warning}><AlertCircle className="h-5 w-5 shrink-0 text-amber-500" /></span> : null}
        <h2 className="text-xl font-black text-neutral-900">{title}</h2>
        {tag ? <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700">{tag}</span> : null}
      </div>
      <p className="mt-2 text-sm leading-6 text-neutral-600">{description}</p>
    </button>
  )
}
