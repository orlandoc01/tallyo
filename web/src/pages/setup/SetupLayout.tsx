import clsx from 'clsx'
import { Check } from 'lucide-react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import type { ReactNode } from 'react'
import { Card } from '../../components/common/FormControls'
import { setupInputClass, setupLabelClass } from './setupClasses'
import { useSetup } from './useSetup'

const steps = [
  { path: '/setup/welcome', label: 'Welcome' },
  { path: '/setup/security', label: 'Security' },
  { path: '/setup/oauth-setup', label: 'Auth' },
  { path: '/setup/owners', label: 'Owners' },
  { path: '/setup/connections', label: 'Connections' },
  { path: '/setup/complete', label: 'Finish' },
]

const authRoutes = ['/setup/password-setup', '/setup/register']

export function SetupLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { passwordEnabled } = useSetup()
  const activePath = authRoutes.includes(location.pathname) ? '/setup/oauth-setup' : location.pathname
  const activeIndex = Math.max(0, steps.findIndex((step) => step.path === activePath))

  function stepRoute(path: string) {
    return path === '/setup/oauth-setup' && passwordEnabled ? '/setup/password-setup' : path
  }

  return (
    <main className="setup-light flex min-h-screen flex-col items-center bg-bg px-3 pb-6 pt-3 text-text-1 lg:px-6 lg:pb-10 lg:pt-4">
      <div className="flex w-full max-w-[960px] flex-col gap-3">
        <header className="flex h-10 items-center justify-between px-1">
          <span className="text-[17px] font-bold tracking-[-0.3px] text-text-1">tallyo</span>
          <span className="text-xs text-text-muted">First-time setup · Step {activeIndex + 1} of 6</span>
        </header>
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3 lg:grid-cols-[minmax(180px,220px)_minmax(0,1fr)]">
          <Card as="aside" className="lg:sticky lg:top-4">
            <div className="flex gap-0.5 overflow-x-auto px-2 py-1.5 lg:flex-col lg:p-2">
              <p className="hidden px-2.5 pb-2.5 pt-1.5 text-xs text-text-muted lg:block">Setup</p>
              {steps.map((step, index) => (
                <StepperRow index={index} key={step.path} label={step.label} onClick={() => navigate(stepRoute(step.path))} status={index < activeIndex ? 'done' : index === activeIndex ? 'current' : 'upcoming'} />
              ))}
            </div>
          </Card>
          <Card as="section" className="min-w-0" padded>
            <Outlet />
          </Card>
        </div>
      </div>
    </main>
  )
}

type StepStatus = 'done' | 'current' | 'upcoming'

const rowClass: Record<StepStatus, string> = {
  done: 'cursor-pointer text-text-2 hover:bg-raised',
  current: 'cursor-pointer bg-raised-nav text-text-1 hover:bg-raised',
  upcoming: 'cursor-default text-text-muted',
}

const dotClass: Record<StepStatus, string> = {
  done: 'border-brand-600 bg-brand-600 text-white',
  current: 'border-brand-600 bg-surface text-brand-600',
  upcoming: 'border-border-emph text-text-muted',
}

function StepperRow({ index, label, onClick, status }: { index: number; label: string; onClick: () => void; status: StepStatus }) {
  const content = (
    <>
      <span aria-hidden className={clsx('flex h-[18px] w-[18px] items-center justify-center rounded-[9px] border text-[10px] font-semibold', dotClass[status])}>
        {status === 'done' ? <Check aria-hidden className="h-2.5 w-2.5" strokeWidth={3} /> : index + 1}
      </span>
      {label}
    </>
  )
  const className = clsx('flex h-9 flex-none items-center gap-2.5 whitespace-nowrap rounded-md px-2.5 text-sm font-medium transition', rowClass[status])
  if (status === 'upcoming') return <div className={className}>{content}</div>
  return <button aria-current={status === 'current' ? 'step' : undefined} className={className} onClick={onClick} type="button">{content}</button>
}

export function SetupHeading({ title, subtitle }: { title: ReactNode; subtitle: string }) {
  return (
    <div>
      <h1 className="flex items-center gap-1.5 text-lg font-semibold tracking-[-0.3px] text-text-1">{title}</h1>
      <p className="mt-0.5 text-[13px] text-text-muted [text-wrap:pretty]">{subtitle}</p>
    </div>
  )
}

export function SetupActions({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="mb-4 mt-5 h-px bg-border" />
      <div className="flex flex-col-reverse gap-2 [&>*]:w-full lg:flex-row lg:justify-end lg:[&>*]:w-auto">{children}</div>
    </>
  )
}

export function SetupFieldGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-x-4 gap-y-3', className)}>{children}</div>
}

export function SetupTextField({ label, value, onChange, type, placeholder, disabled, mono = false, className }: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
  disabled?: boolean
  mono?: boolean
  className?: string
}) {
  return (
    <label className={clsx('block', className)}>
      <span className={clsx('mb-1.5 block', setupLabelClass)}>{label}</span>
      <input className={clsx(setupInputClass, mono && 'font-mono text-xs')} disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} type={type} value={value} />
    </label>
  )
}

const messageToneClass = { negative: 'text-negative', positive: 'text-positive', warning: 'text-warning', muted: 'text-text-muted' } as const

export function SetupMessage({ children, tone }: { children: ReactNode; tone: keyof typeof messageToneClass }) {
  return <p className={clsx('mt-3 text-xs', messageToneClass[tone])}>{children}</p>
}

export function SetupBadge({ children }: { children: ReactNode }) {
  return <span className="inline-flex h-4 items-center rounded border border-brand-600/50 bg-brand-600/[0.12] px-1.5 text-[10px] font-semibold uppercase leading-4 tracking-[.5px] text-accent">{children}</span>
}

export function SetupListCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('overflow-hidden rounded-md border border-border [&>*+*]:border-t [&>*+*]:border-border', className)}>{children}</div>
}
