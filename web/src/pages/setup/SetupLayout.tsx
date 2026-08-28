import clsx from 'clsx'
import { Outlet, useLocation } from 'react-router'
import type { ReactNode } from 'react'

const steps = [
  { path: '/setup/welcome', label: 'Welcome' },
  { path: '/setup/security', label: 'Security' },
  { path: '/setup/oauth-setup', label: 'Auth' },
  { path: '/setup/owners', label: 'Owners' },
  { path: '/setup/connections', label: 'Connections' },
  { path: '/setup/complete', label: 'Finish' },
]

export function SetupLayout() {
  const location = useLocation()
  const activePath = ['/setup/password-setup', '/setup/register'].includes(location.pathname) ? '/setup/oauth-setup' : location.pathname
  const activeIndex = Math.max(0, steps.findIndex((step) => step.path === activePath))

  return (
    <main className="setup-light min-h-screen overflow-hidden bg-paper text-neutral-950">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.9),transparent_32rem),radial-gradient(circle_at_bottom_right,rgba(249,115,22,0.15),transparent_30rem)]" />
      <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-center gap-3 text-sm font-bold uppercase tracking-[0.3em] text-brand-700">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-brand-900 text-base text-white shadow-xl">$</span>
          Tallyo
        </div>
        <section className="w-full max-w-4xl overflow-hidden rounded-2xl border border-white/70 bg-white/85 shadow-2xl shadow-brand-900/10 backdrop-blur">
          <div className="border-b border-brand-100 bg-white/60 px-6 py-4">
            <div className="flex items-center gap-2">
              {steps.map((step, index) => (
                <div className="flex flex-1 items-center gap-2" key={step.path}>
                  <div className={`h-2 flex-1 rounded-full ${index <= activeIndex ? 'bg-brand-600' : 'bg-brand-100'}`} />
                  <span className={`hidden text-xs font-semibold sm:inline ${index === activeIndex ? 'text-brand-800' : 'text-neutral-400'}`}>{step.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="p-6 sm:p-10">
            <Outlet />
          </div>
        </section>
      </div>
    </main>
  )
}

export function SetupActions({ children }: { children: ReactNode }) {
  return <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">{children}</div>
}

export function SetupHeading({ eyebrow, eyebrowClassName = setupEyebrowClass, title, titleClassName = setupTitleClass }: { eyebrow: string; eyebrowClassName?: string; title: ReactNode; titleClassName?: string }) {
  return (
    <>
      <p className={eyebrowClassName}>{eyebrow}</p>
      <h1 className={titleClassName}>{title}</h1>
    </>
  )
}

export function SetupTextField({ label, value, onChange, type, placeholder, disabled, className }: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <label className={clsx('block text-sm font-bold text-neutral-900', className)}>
      {label}
      <input className={inputClass} disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} type={type} value={value} />
    </label>
  )
}

const setupEyebrowClass = 'text-sm font-bold uppercase tracking-[0.25em] text-brand-600'
const setupTitleClass = 'mt-3 text-3xl font-black tracking-tight text-neutral-900'

export const primaryButtonClass = 'rounded-full bg-brand-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-brand-600/20 transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50'
export const secondaryButtonClass = 'rounded-full border border-brand-200 bg-white px-5 py-3 text-sm font-bold text-brand-800 transition hover:border-brand-600 hover:text-brand-900'
export const inputClass = 'mt-1 w-full rounded-xl border border-brand-200 bg-white px-4 py-3 text-sm text-neutral-950 outline-none transition focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10 disabled:bg-neutral-100 disabled:text-neutral-400'
