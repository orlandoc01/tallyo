import clsx from 'clsx'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Button } from './Button'

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
    <Button
      active={active}
      className={className}
      type={type}
      variant={variant}
      {...props}
    >
      {children}
    </Button>
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
