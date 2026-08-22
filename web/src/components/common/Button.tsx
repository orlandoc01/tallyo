import clsx from 'clsx'
import { ArrowUpRight } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

const variantClass: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white shadow-brand-600/20 hover:bg-brand-700',
  secondary: 'border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  ghost: 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950',
}

const sizeClass: Record<ButtonSize, string> = {
  sm: 'rounded-lg px-3 py-1.5 text-xs font-semibold',
  md: 'rounded-xl px-4 py-2 text-sm font-semibold',
  lg: 'rounded-2xl px-5 py-3 text-sm font-bold',
}

export function Button({
  className,
  size = 'md',
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { size?: ButtonSize; variant?: ButtonVariant }) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center transition disabled:cursor-not-allowed disabled:opacity-50',
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      type="button"
      {...props}
    />
  )
}

export function ArrowUpRightLink({ children, label, to }: { children?: ReactNode; label: string; to: string }) {
  return (
    <Link
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-50 hover:text-neutral-700 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
      to={to}
    >
      {children}
      <ArrowUpRight aria-hidden className="h-4 w-4" />
    </Link>
  )
}

export function IconButton({ ariaLabel, onClick, children }: { ariaLabel: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      aria-label={ariaLabel}
      className="rounded-xl border border-neutral-200 bg-white p-2 text-neutral-600 shadow-sm hover:bg-neutral-50 hover:text-neutral-950"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  )
}

export function TextLinkButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="w-full text-sm text-neutral-500 underline hover:text-neutral-700" onClick={onClick} type="button">
      {label}
    </button>
  )
}

export function DialogButtonRow({ primaryLabel, onPrimary, secondaryLabel, onSecondary }: {
  primaryLabel: string
  onPrimary: () => void
  secondaryLabel: string
  onSecondary: () => void
}) {
  return (
    <div className="mt-6 flex gap-3">
      <button className="flex-1 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white" onClick={onPrimary} type="button">{primaryLabel}</button>
      <button className="flex-1 rounded-xl border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700" onClick={onSecondary} type="button">{secondaryLabel}</button>
    </div>
  )
}
