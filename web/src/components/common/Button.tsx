import clsx from 'clsx'
import { ArrowUpRight } from 'lucide-react'
import type { ButtonHTMLAttributes, ComponentProps, ReactNode, Ref } from 'react'
import { Link } from 'react-router'

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'danger-solid' | 'ghost' | 'ghost-muted' | 'outline-accent'
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

const variantClass: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 font-semibold text-white hover:bg-brand-700',
  secondary: 'bg-raised font-medium text-text-1 hover:bg-border-strong',
  danger: 'bg-transparent font-medium text-negative hover:bg-negative/10',
  'danger-solid': 'bg-negative font-semibold text-white hover:bg-negative/90 dark:text-bg',
  ghost: 'font-medium text-text-1 hover:bg-raised',
  'ghost-muted': 'font-normal text-text-3 hover:bg-raised hover:text-text-1',
  'outline-accent': 'bg-brand-600/[0.12] font-semibold text-accent',
}

const variantBorderClass: Record<ButtonVariant, string> = {
  primary: 'border-brand-600',
  secondary: 'border-border-strong',
  danger: 'border-negative/35',
  'danger-solid': 'border-negative',
  ghost: 'border-transparent',
  'ghost-muted': 'border-transparent',
  'outline-accent': 'border-brand-600',
}

const sizeClass: Record<ButtonSize, string> = {
  xs: 'h-[26px] rounded-[13px] px-2.5 text-xs',
  sm: 'h-7 rounded-md px-2.5 text-xs',
  md: 'h-9 rounded-md px-3 lg:h-8',
  lg: 'h-10 rounded-md px-3.5',
}

type ButtonStyleProps = { active?: boolean; className?: string; highlighted?: boolean; pressed?: boolean; size?: ButtonSize; variant?: ButtonVariant }

function buttonClassName({ active = false, className, highlighted = false, pressed = false, size = 'md', variant = 'primary' }: ButtonStyleProps) {
  return clsx(
    'inline-flex items-center justify-center gap-1.5 border text-[13px] transition disabled:cursor-not-allowed disabled:opacity-50',
    pressed
      ? 'border-brand-600 bg-brand-600/[0.15] font-medium text-accent'
      : active ? 'border-brand-600 bg-border-strong font-medium text-text-1' : [variantClass[variant], highlighted ? 'border-brand-600' : variantBorderClass[variant]],
    sizeClass[size],
    className,
  )
}

export function Button({
  className,
  active,
  highlighted,
  pressed,
  size,
  variant,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & ButtonStyleProps & { ref?: Ref<HTMLButtonElement> }) {
  return <button className={buttonClassName({ active, className, highlighted, pressed, size, variant })} type="button" {...props} />
}

export function ButtonLink({ children, className, size, to, variant, ...props }: Omit<ComponentProps<typeof Link>, 'className'> & Pick<ButtonStyleProps, 'className' | 'size' | 'variant'>) {
  return <Link className={buttonClassName({ className, size, variant })} to={to} {...props}>{children}</Link>
}

export function SignInButton({ className, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={clsx(
        'w-full rounded-md border border-border-strong bg-raised px-4 py-3 font-semibold text-text-1 transition hover:bg-border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60',
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
      className="inline-flex items-center gap-1 rounded-md p-1.5 text-text-muted hover:bg-raised hover:text-text-1 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
      to={to}
    >
      {children}
      <ArrowUpRight aria-hidden className="h-4 w-4" />
    </Link>
  )
}

const iconButtonSizeClass = { xs: 'h-7 w-7', sm: 'h-8 w-8', md: 'h-9 w-9 lg:h-8 lg:w-8' } as const

export function IconButton({ ariaLabel, className, disabled = false, expanded, haspopup, onClick, pressed = false, size = 'md', title, children }: {
  ariaLabel: string
  className?: string
  disabled?: boolean
  expanded?: boolean
  haspopup?: 'menu' | 'dialog'
  onClick: () => void
  pressed?: boolean
  size?: keyof typeof iconButtonSizeClass
  title?: string
  children: ReactNode
}) {
  return (
    <button
      aria-expanded={expanded}
      aria-haspopup={haspopup}
      aria-label={ariaLabel}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-md border border-border-strong transition hover:bg-border-strong disabled:cursor-not-allowed disabled:opacity-40',
        iconButtonSizeClass[size],
        pressed ? 'bg-border-strong text-accent' : 'bg-raised text-text-2',
        className,
      )}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  )
}

export function TextLinkButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="w-full text-sm text-text-muted underline hover:text-text-1" onClick={onClick} type="button">
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
