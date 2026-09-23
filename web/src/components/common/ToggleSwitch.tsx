import clsx from 'clsx'
import type { ComponentPropsWithoutRef } from 'react'

type ToggleSwitchAriaProps = Pick<ComponentPropsWithoutRef<'button'>, 'aria-describedby' | 'aria-controls'>

export function ToggleSwitch({
  label,
  checked,
  disabled = false,
  onChange,
  size = 'md',
  ...ariaProps
}: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void; size?: 'md' | 'lg' } & ToggleSwitchAriaProps) {
  const large = size === 'lg'
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={clsx(
        'relative inline-flex flex-shrink-0 rounded-full transition-colors duration-200 ease-in-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400 disabled:cursor-not-allowed disabled:opacity-60',
        large ? 'h-5 w-9' : 'h-5 w-9 lg:h-[18px] lg:w-8',
        checked ? 'bg-brand-600' : 'bg-border-strong',
      )}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
      {...ariaProps}
    >
      <span
        className={clsx(
          'pointer-events-none absolute left-0.5 top-0.5 rounded-full bg-text-1 transition-transform duration-200 ease-in-out',
          large ? 'h-4 w-4' : 'h-4 w-4 lg:h-3.5 lg:w-3.5',
          checked ? (large ? 'translate-x-4' : 'translate-x-4 lg:translate-x-3.5') : 'translate-x-0',
        )}
      />
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
    <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-surface-2 px-4 py-3">
      <div>
        <div className="text-sm font-medium text-text-1">{title}</div>
        {description ? <div className="mt-1 text-xs text-text-muted">{description}</div> : null}
      </div>
      <ToggleSwitch checked={checked} label={title} onChange={onChange} size="lg" />
    </div>
  )
}
