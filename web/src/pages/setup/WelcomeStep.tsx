import { Link, useNavigate } from 'react-router'
import { ArrowRight, BarChart3, LockKeyhole, WalletCards } from 'lucide-react'
import type { ReactNode } from 'react'
import { SetupHeading, primaryButtonClass, secondaryButtonClass } from './SetupLayout'

export function WelcomeStep() {
  const navigate = useNavigate()
  return (
    <div>
      <div>
        <SetupHeading eyebrow="First time setup" title="Welcome to Tallyo" titleClassName="mt-4 text-4xl font-black tracking-tight text-neutral-900 sm:text-5xl" />
        <div className="mt-8 grid gap-3 md:grid-cols-3">
          <Feature icon={<WalletCards className="h-5 w-5" />} title="Monitor spending" description="Connect institutions, review transactions, and keep categories clean." />
          <Feature icon={<BarChart3 className="h-5 w-5" />} title="Track assets and net worth" description="Blend synced balances with manual assets and liabilities." />
          <Feature icon={<LockKeyhole className="h-5 w-5" />} title="Private and secure" description="Choose simple single-password access or OAuth-backed sign-in." />
        </div>
      </div>

      <div className="mt-8 flex items-center justify-end gap-3">
        <button className={secondaryButtonClass} onClick={() => navigate('/setup/complete')} type="button">
          Skip setup
        </button>
        <Link className={`inline-flex items-center gap-2 ${primaryButtonClass}`} to="/setup/security">
          Get Started
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  )
}

function Feature({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-brand-100 bg-brand-50 p-4">
      <div className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-brand-100 text-brand-600">{icon}</div>
      <div>
        <h2 className="font-bold text-neutral-900">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-neutral-600">{description}</p>
      </div>
    </div>
  )
}
