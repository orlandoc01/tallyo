import { useNavigate } from 'react-router'
import { ArrowRight, BarChart3, LockKeyhole, WalletCards } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button, ButtonLink } from '../../components/common/Button'
import { SetupActions, SetupHeading } from './SetupLayout'

export function WelcomeStep() {
  const navigate = useNavigate()
  return (
    <div>
      <SetupHeading subtitle="A few steps to configure access, owners, and data providers. Nothing is applied until you finish." title="Welcome to Tallyo" />
      <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2">
        <Feature description="Connect institutions, review transactions, and keep categories clean." icon={WalletCards} title="Monitor spending" />
        <Feature description="Blend synced balances with manual assets and liabilities." icon={BarChart3} title="Track assets and net worth" />
        <Feature description="Choose simple single-password access or OAuth-backed sign-in." icon={LockKeyhole} title="Private and secure" />
      </div>

      <SetupActions>
        <Button onClick={() => navigate('/setup/complete')} variant="secondary">Skip setup</Button>
        <ButtonLink to="/setup/security">
          Get started
          <ArrowRight aria-hidden className="h-3.5 w-3.5" />
        </ButtonLink>
      </SetupActions>
    </div>
  )
}

function Feature({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-2 p-3.5">
      <Icon aria-hidden className="h-4 w-4 text-brand-600" strokeWidth={1.6} />
      <h2 className="mt-2 text-[13px] font-semibold text-text-1">{title}</h2>
      <p className="mt-0.5 text-xs text-text-muted">{description}</p>
    </div>
  )
}
