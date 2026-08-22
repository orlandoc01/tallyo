import type { ComponentPropsWithoutRef } from 'react'

type ToggleSwitchAriaProps = Pick<ComponentPropsWithoutRef<'button'>, 'aria-describedby' | 'aria-controls'>

export function ToggleSwitch({
  label,
  checked,
  dark = false,
  disabled = false,
  onChange,
  ...ariaProps
}: { label: string; checked: boolean; dark?: boolean; disabled?: boolean; onChange: (value: boolean) => void } & ToggleSwitchAriaProps) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full border-2 p-0.5 transition-colors duration-200 ease-in-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400 disabled:cursor-not-allowed disabled:opacity-60 ${checked ? 'border-brand-400 bg-white' : `border-neutral-300 bg-white ${dark ? 'dark:border-neutral-600 dark:bg-neutral-900' : ''}`}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
      {...ariaProps}
    >
      <span className={`pointer-events-none h-5 w-5 flex-shrink-0 transform rounded-full shadow transition duration-200 ease-in-out ${checked ? 'translate-x-5 bg-brand-400' : `translate-x-0 bg-neutral-400 ${dark ? 'dark:bg-neutral-500' : ''}`}`} />
    </button>
  )
}

export function ToggleSettingRow({ title, description, checked, onChange }: {
  title: string
  description?: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-3">
      <div>
        <div className="text-sm font-semibold text-neutral-950">{title}</div>
        {description ? <div className="mt-1 text-xs text-neutral-500">{description}</div> : null}
      </div>
      <ToggleSwitch checked={checked} label={title} onChange={onChange} />
    </div>
  )
}
