import clsx from 'clsx'
import { ChevronDown, Search } from 'lucide-react'
import type { HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

const labelClass = 'text-xs text-text-muted'
const controlClass = 'mt-1 block w-full rounded-md border border-border-strong px-3 text-[13px] text-text-1 placeholder:text-text-faint focus:border-brand-600 focus:outline-none disabled:opacity-50'
const inputHeightClass = 'h-9 lg:h-8'
// Sheet fields sit on the sheet surface, so they take the page background and a 40px touch height.
const fieldVariantClass = { default: 'bg-surface dark:bg-bg', sheet: 'bg-bg' } as const
const inputVariantHeightClass = { default: inputHeightClass, sheet: 'h-10' } as const

type FieldVariant = keyof typeof fieldVariantClass

type FieldProps = {
  label: string
  ariaLabel?: string
  className?: string
  controlClassName?: string
  hideLabel?: boolean
  labelClassName?: string
  labelSuffix?: ReactNode
  mono?: boolean
  onChange: (value: string) => void
  variant?: FieldVariant
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

export function TextField({ ariaLabel, className, controlClassName, hideLabel = false, label, labelClassName, labelSuffix, mono = false, onChange, variant = 'default', ...props }: TextFieldProps) {
  return (
    <label className={clsx('block', className)}>
      <span className={hideLabel ? 'sr-only' : clsx(labelClass, labelClassName)}>{label}{labelSuffix}</span>
      <input aria-label={ariaLabel ?? label} className={clsx(controlClass, inputVariantHeightClass[variant], fieldVariantClass[variant], hideLabel && 'mt-0', mono && 'font-mono text-xs', controlClassName)} onChange={(event) => onChange(event.target.value)} {...props} />
    </label>
  )
}

export function TextAreaField({ ariaLabel, className, controlClassName, hideLabel = false, label, labelClassName, labelSuffix, minHeight, mono = false, onChange, variant = 'default', ...props }: TextAreaFieldProps) {
  return (
    <label className={clsx('block', className)}>
      <span className={hideLabel ? 'sr-only' : clsx(labelClass, labelClassName)}>{label}{labelSuffix}</span>
      <textarea aria-label={ariaLabel ?? label} className={clsx(controlClass, 'py-2', fieldVariantClass[variant], hideLabel && 'mt-0', mono && 'font-mono', minHeight, controlClassName)} onChange={(event) => onChange(event.target.value)} {...props} />
    </label>
  )
}

// A select-shaped button for pickers that open a sheet instead of a native <select>.
export function SelectTriggerButton({ className, disabled = false, label, onClick, value }: {
  className?: string
  disabled?: boolean
  label: string
  onClick: () => void
  value: ReactNode
}) {
  return (
    <label className={clsx('block', className)}>
      <span className={labelClass}>{label}</span>
      <button aria-haspopup="dialog" className={clsx(controlClass, inputHeightClass, fieldVariantClass.default, 'flex items-center justify-between')} disabled={disabled} onClick={onClick} type="button">
        <span className="truncate">{value}</span>
        <ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0 text-text-muted" />
      </button>
    </label>
  )
}

export function SelectField<T extends string>({ ariaLabel, className, controlClassName, hideLabel = false, label, labelClassName, labelSuffix, onChange, options, ...props }: SelectFieldProps<T>) {
  return (
    <label className={clsx('block', className)}>
      <span className={hideLabel ? 'sr-only' : clsx(labelClass, labelClassName)}>{label}{labelSuffix}</span>
      <select aria-label={ariaLabel ?? label} className={clsx(controlClass, inputHeightClass, fieldVariantClass.default, hideLabel && 'mt-0', controlClassName)} onChange={(event) => onChange(event.target.value as T)} {...props}>
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
        <span className="block text-sm font-medium text-text-1">{label}</span>
      </span>
      <input aria-label={label} checked={checked} className={clsx(checkboxClass, 'h-4 w-4')} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
    </label>
  )
}

export const checkboxClass = 'shrink-0 cursor-pointer appearance-none rounded border border-handle bg-surface checked:border-brand-600 checked:bg-brand-600 checked:bg-[url(data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2016%2016%27%20fill=%27none%27%20stroke=%27white%27%20stroke-width=%272%27%20stroke-linecap=%27round%27%20stroke-linejoin=%27round%27%3E%3Cpath%20d=%27M3.5%208.5l3%203%206-7%27/%3E%3C/svg%3E)] checked:bg-center checked:bg-no-repeat indeterminate:border-brand-600 indeterminate:bg-brand-600 indeterminate:bg-[url(data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2016%2016%27%20fill=%27none%27%20stroke=%27white%27%20stroke-width=%272%27%20stroke-linecap=%27round%27%3E%3Cpath%20d=%27M4%208h8%27/%3E%3C/svg%3E)] indeterminate:bg-center indeterminate:bg-no-repeat focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-bg'

export const radioClass = 'shrink-0 cursor-pointer appearance-none rounded-full border border-handle bg-surface checked:border-brand-600 checked:bg-brand-600 checked:bg-[url(data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2016%2016%27%3E%3Ccircle%20cx=%278%27%20cy=%278%27%20r=%273%27%20fill=%27white%27/%3E%3C/svg%3E)] checked:bg-center checked:bg-no-repeat focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-bg'

export function SearchInput({ ariaLabel, placeholder, value, onChange, className, size = 'md', type }: {
  ariaLabel: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  className?: string
  size?: 'md' | 'lg'
  type?: 'search' | 'text'
}) {
  return (
    <div className={clsx('relative', className)}>
      <Search aria-hidden className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
      <input
        aria-label={ariaLabel}
        className={clsx('w-full border border-border bg-surface pl-9 pr-4 text-[13px] text-text-1 outline-none placeholder:text-text-faint focus:border-brand-600', size === 'lg' ? 'h-9 rounded-md lg:h-10 lg:rounded-lg lg:text-sm' : 'h-9 rounded-md lg:h-8')}
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
  return <p className={clsx('rounded-md bg-negative/10 px-4 py-3 text-sm text-negative', className)} id={id}>{children}</p>
}

export function FormSuccess({ children }: { children: ReactNode }) {
  return <p className="rounded-md bg-positive/10 px-4 py-3 text-sm text-positive">{children}</p>
}

export function SectionLabel({ as: Component = 'h2', children, className }: HTMLAttributes<HTMLElement> & { as?: 'h2' | 'h3' | 'h4' | 'p' }) {
  return <Component className={clsx('text-sm font-semibold text-text-1', className)}>{children}</Component>
}

const cardOverflowClass = { hidden: 'overflow-hidden', visible: 'overflow-visible', auto: 'overflow-y-auto' } as const

export function Card({ as: Component = 'div', children, className, padded = false, overflow = 'hidden', variant = 'default', ...props }: HTMLAttributes<HTMLElement> & {
  as?: 'article' | 'aside' | 'div' | 'form' | 'nav' | 'section'
  overflow?: keyof typeof cardOverflowClass
  padded?: boolean
  variant?: 'default' | 'dashed'
}) {
  return (
    <Component
      className={clsx(
        cardOverflowClass[overflow],
        'rounded-lg border bg-surface',
        variant === 'dashed' ? 'border-dashed border-border-emph px-5 py-10 text-center lg:px-6 lg:py-12' : 'border-border',
        padded && 'p-4 lg:px-6 lg:py-5',
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  )
}
