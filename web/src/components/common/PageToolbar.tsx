import clsx from 'clsx'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function PageToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex flex-wrap items-center justify-between gap-4', className)}>
      {children}
    </div>
  )
}

export function PageToolbarActions({ children }: { children: ReactNode }) {
  return (
    <div className="ml-auto hidden items-center gap-3 lg:flex">
      {children}
    </div>
  )
}

export function PageToolbarButton({ active = false, children, className, type = 'button', variant = 'secondary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; variant?: 'primary' | 'secondary' }) {
  return (
    <button
      className={clsx(
        'inline-flex h-10 items-center justify-center gap-1.5 rounded-full border px-4 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary'
          ? 'border-brand-600 bg-brand-600 text-white hover:bg-brand-700'
          : active
            ? 'border-brand-400 bg-white text-brand-700 hover:bg-neutral-50 dark:border-brand-500 dark:bg-neutral-900 dark:text-brand-300 dark:hover:bg-neutral-800'
            : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800 dark:hover:text-neutral-100',
        className,
      )}
      type={type}
      {...props}
    >
      {children}
    </button>
  )
}

export function PageToolbarIconButton({ ariaLabel, children, onClick }: { ariaLabel: string; children: ReactNode; onClick: () => void }) {
  return (
    <button
      aria-label={ariaLabel}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-600 shadow-sm transition hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  )
}

export function PageToolbarSegmentedControl<T extends string>({
  ariaLabel,
  options,
  size,
  value,
  onChange,
}: {
  ariaLabel: string
  options: Array<{ value: T; label: string }>
  size?: 'sm'
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div aria-label={ariaLabel} className="inline-flex shrink-0 rounded-2xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-700 dark:bg-neutral-800" role="radiogroup">
      {options.map((option) => (
        <button
          aria-checked={value === option.value}
          className={clsx(
            'rounded-xl font-semibold transition',
            size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm',
            value === option.value
              ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-100'
              : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100',
          )}
          key={option.value}
          onClick={() => onChange(option.value)}
          role="radio"
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
