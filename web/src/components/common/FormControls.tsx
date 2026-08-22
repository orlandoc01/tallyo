import clsx from 'clsx'
import { Search } from 'lucide-react'
import type { HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

const labelClass = 'text-sm font-medium text-neutral-700'
const controlClass = 'mt-1 block w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:opacity-50'

type FieldProps = {
  label: string
  ariaLabel?: string
  className?: string
  controlClassName?: string
  hideLabel?: boolean
  labelClassName?: string
  labelSuffix?: ReactNode
  onChange: (value: string) => void
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'onChange'> & FieldProps

type TextAreaFieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className' | 'onChange'> & FieldProps & {
  minHeight?: string
}

type SelectOption<T extends string> = T | { label: ReactNode; value: T; disabled?: boolean }

type SelectFieldProps<T extends string> = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'onChange'> & {
  label: string
  ariaLabel?: string
  className?: string
  controlClassName?: string
  hideLabel?: boolean
  labelClassName?: string
  labelSuffix?: ReactNode
  options: readonly SelectOption<T>[]
  onChange: (value: T) => void
}

export function TextField({ ariaLabel, className, controlClassName, hideLabel = false, label, labelClassName, labelSuffix, onChange, ...props }: TextFieldProps) {
  return (
    <label className={clsx('block', className)}>
      <span className={hideLabel ? 'sr-only' : clsx(labelClass, labelClassName)}>{label}{labelSuffix}</span>
      <input aria-label={ariaLabel ?? label} className={clsx(controlClass, hideLabel && 'mt-0', controlClassName)} onChange={(event) => onChange(event.target.value)} {...props} />
    </label>
  )
}

export function TextAreaField({ ariaLabel, className, controlClassName, hideLabel = false, label, labelClassName, labelSuffix, minHeight, onChange, ...props }: TextAreaFieldProps) {
  return (
    <label className={clsx('block', className)}>
      <span className={hideLabel ? 'sr-only' : clsx(labelClass, labelClassName)}>{label}{labelSuffix}</span>
      <textarea aria-label={ariaLabel ?? label} className={clsx(controlClass, hideLabel && 'mt-0', minHeight, controlClassName)} onChange={(event) => onChange(event.target.value)} {...props} />
    </label>
  )
}

export function SelectField<T extends string>({ ariaLabel, className, controlClassName, hideLabel = false, label, labelClassName, labelSuffix, onChange, options, ...props }: SelectFieldProps<T>) {
  return (
    <label className={clsx('block', className)}>
      <span className={hideLabel ? 'sr-only' : clsx(labelClass, labelClassName)}>{label}{labelSuffix}</span>
      <select aria-label={ariaLabel ?? label} className={clsx(controlClass, hideLabel && 'mt-0', controlClassName)} onChange={(event) => onChange(event.target.value as T)} {...props}>
        {options.map((option) => {
          const value = typeof option === 'string' ? option : option.value
          const disabled = typeof option === 'string' ? false : option.disabled
          return <option disabled={disabled} key={value} value={value}>{typeof option === 'string' ? option : option.label}</option>
        })}
      </select>
    </label>
  )
}

export function CheckboxField({ checked, label, onChange }: {
  checked: boolean
  label: string
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span>
        <span className="block text-sm font-medium text-neutral-700">{label}</span>
      </span>
      <input aria-label={label} checked={checked} className="h-4 w-4 rounded border-neutral-300 text-brand-500 focus:ring-brand-500 disabled:opacity-50" onChange={(event) => onChange(event.target.checked)} type="checkbox" />
    </label>
  )
}

export function SearchInput({ ariaLabel, placeholder, value, onChange, className, type }: {
  ariaLabel: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  className?: string
  type?: 'search' | 'text'
}) {
  return (
    <div className={clsx('relative', className)}>
      <Search aria-hidden className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
      <input
        aria-label={ariaLabel}
        className="w-full rounded-2xl border border-neutral-200 bg-white py-2.5 pl-9 pr-4 text-sm outline-none focus:border-brand-500"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
    </div>
  )
}

export function FieldLabel({ children, label }: { children: ReactNode; label: string }) {
  return <label className="block"><span className={labelClass}>{label}</span>{children}</label>
}

export function FormError({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return <p className={clsx('rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-200', className)} id={id}>{children}</p>
}

export function FormSuccess({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{children}</p>
}

export function SectionLabel({ as: Component = 'h2', children, className, tone = 'default' }: HTMLAttributes<HTMLElement> & { as?: 'h2' | 'h3' | 'h4' | 'p'; tone?: 'default' | 'muted' }) {
  return <Component className={clsx('text-xs font-semibold uppercase tracking-widest', tone === 'muted' ? 'text-neutral-400' : 'text-neutral-500', className)}>{children}</Component>
}

export function Card({ as: Component = 'div', children, className, padded = false, compact = false, overflow = 'hidden', ...props }: HTMLAttributes<HTMLElement> & {
  as?: 'article' | 'div' | 'form' | 'nav' | 'section'
  compact?: boolean
  overflow?: 'hidden' | 'visible'
  padded?: boolean
}) {
  return (
    <Component
      className={clsx(
        overflow === 'hidden' ? 'overflow-hidden' : 'overflow-visible',
        'border border-neutral-200 bg-white',
        compact ? 'rounded-2xl shadow-sm' : 'rounded-3xl shadow-card',
        padded && 'p-5',
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  )
}
