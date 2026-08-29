import clsx from 'clsx'
import { ArrowUpRight } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'danger-solid' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

const variantClass: Record<ButtonVariant, string> = {
  primary: 'border-brand-600 bg-brand-600 text-white shadow-brand-600/20 hover:bg-brand-700',
  secondary: 'border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50',
  danger: 'border-red-300 bg-transparent text-red-600 hover:bg-red-50 dark:border-red-400/35 dark:text-red-400 dark:hover:bg-red-500/10',
  'danger-solid': 'border-red-600 bg-red-600 text-white hover:bg-red-700',
  ghost: 'border-transparent text-neutral-600 shadow-none hover:bg-neutral-100 hover:text-neutral-950',
}

const sizeClass: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs font-semibold',
  md: 'h-10 px-4 text-sm font-semibold',
  lg: 'h-12 px-5 text-sm font-bold',
}

export function Button({
  className,
  active = false,
  size = 'md',
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; size?: ButtonSize; variant?: ButtonVariant }) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-full border shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50',
        active ? 'border-brand-400 bg-white text-brand-700 hover:bg-neutral-50 dark:border-brand-500 dark:bg-neutral-900 dark:text-brand-300 dark:hover:bg-neutral-800' : variantClass[variant],
        sizeClass[size],
        className,
      )}
      type="button"
      {...props}
    />
  )
}

export function SignInButton({ className, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={clsx(
        'w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 font-semibold text-neutral-700 shadow-sm transition hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      type={type}
      {...props}
    />
  )
}

export function ArrowUpRightLink({ children, label, to }: { children?: ReactNode; label: string; to: string }) {
  return (
    <Link
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-xl p-1.5 text-neutral-400 hover:bg-neutral-50 hover:text-neutral-700 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
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
      <Button className="flex-1" onClick={onPrimary}>{primaryLabel}</Button>
      <Button className="flex-1" onClick={onSecondary} variant="secondary">{secondaryLabel}</Button>
    </div>
  )
}
