import clsx from 'clsx'
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { AlertCircle, Check } from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { Button } from '../../components/common/Button'
import { OBFUSCATED_SECRET } from './setupState'
import { useSetup } from './useSetup'
import { SetupActions, SetupBadge, SetupHeading } from './SetupLayout'

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
      <SetupHeading subtitle="Keep the bootstrap master password for a private household server, or configure OAuth providers for multi-user and public-hosted deployments." title="Security model" />
      <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-2">
        <ChoiceCard
          description="Set a master password for private networks or VPN-only access."
          selected={setup.passwordEnabled}
          tag={masterPasswordStatus !== 'DISABLED' ? 'Existing' : undefined}
          title="Single password"
          warning={masterPasswordStatus === 'ENV_VAR_OVERRIDE' ? 'Currently set by ENV VAR, which overrides whatever you set here' : undefined}
          onClick={() => setup.updateSetup({ passwordEnabled: !setup.passwordEnabled })}
        />
        <ChoiceCard
          description="Enable passkeys, email, or Google Sign-In with users managed inside Tallyo."
          selected={setup.oauthEnabled}
          title="OAuth"
          onClick={() => setup.updateSetup({ oauthEnabled: !setup.oauthEnabled })}
        />
      </div>
      <SetupActions>
        <Button onClick={() => navigate('/setup/welcome')} variant="secondary">Back</Button>
        <Button disabled={!setup.passwordEnabled && !setup.oauthEnabled} onClick={continueSetup}>Continue</Button>
      </SetupActions>
    </div>
  )
}

function ChoiceCard({ title, tag, warning, description, selected, onClick }: { title: string; tag?: string; warning?: string; description: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      aria-pressed={selected}
      className={clsx('flex gap-3 rounded-md border p-3.5 text-left transition', selected ? 'border-brand-600 bg-brand-600/[0.08]' : 'border-border bg-surface hover:bg-raised')}
      onClick={onClick}
      type="button"
    >
      <span aria-hidden className={clsx('mt-px flex h-4 w-4 flex-none items-center justify-center rounded border', selected ? 'border-brand-600 bg-brand-600' : 'border-border-emph bg-surface')}>
        {selected ? <Check className="h-[11px] w-[11px] text-white" strokeWidth={3} /> : null}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          {warning ? <span title={warning}><AlertCircle aria-hidden className="h-3.5 w-3.5 text-warning" /></span> : null}
          <span className="text-[13px] font-semibold text-text-1">{title}</span>
          {tag ? <SetupBadge>{tag}</SetupBadge> : null}
        </span>
        <span className="mt-0.5 block text-xs text-text-muted">{description}</span>
      </span>
    </button>
  )
}
