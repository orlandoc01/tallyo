import clsx from 'clsx'
import { Check, ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { TextAreaField, TextField } from './FormControls'
import { ToggleSwitch } from './ToggleSwitch'

const rowClass = 'flex min-h-[52px] w-full items-center justify-between gap-3 text-left text-sm font-medium text-text-1'

export function SheetAccordionRow({ changed = false, children, expanded, label, onToggle, summary }: {
  changed?: boolean
  children: ReactNode
  expanded: boolean
  label: string
  onToggle: () => void
  summary?: ReactNode
}) {
  return (
    <div className="border-t border-border">
      <button aria-expanded={expanded} className={clsx(rowClass, 'touch-manipulation')} onClick={onToggle} type="button">
        <span className="truncate">{label}</span>
        <span className="flex min-w-0 max-w-[60%] shrink-0 items-center gap-3">
          {summary ? <span className={clsx('truncate text-[13px] font-normal', changed ? 'text-accent' : 'text-text-2')}>{summary}</span> : null}
          <ChevronDown aria-hidden="true" className={clsx('h-[11px] w-[11px] shrink-0 text-text-muted transition-transform', expanded && 'rotate-180')} />
        </span>
      </button>
      {expanded ? <div className="pb-3">{children}</div> : null}
    </div>
  )
}

export function SheetStaticRow({ label, value, valueClassName }: { label: string; value: ReactNode; valueClassName?: string }) {
  return (
    <div className={clsx(rowClass, 'border-t border-border py-2')}>
      <span className="shrink-0">{label}</span>
      <span className={clsx('min-w-0 break-words text-right text-[13px] font-normal [text-wrap:pretty]', valueClassName ?? 'text-text-2')}>{value}</span>
    </div>
  )
}

export function SheetToggleRow({ checked, description, disabled = false, label, onChange }: {
  checked: boolean
  description?: string
  disabled?: boolean
  label: string
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-4 border-t border-border py-2">
      <span className="min-w-0">
        <span className="block text-sm text-text-2">{label}</span>
        {description ? <span className="block text-xs text-text-3">{description}</span> : null}
      </span>
      <ToggleSwitch checked={checked} disabled={disabled} label={label} onChange={onChange} size="lg" />
    </div>
  )
}

// A full-width 52px tap row (menu items, destructive actions at the bottom of a body).
export function SheetActionRow({ destructive = false, disabled = false, label, onClick, title }: {
  destructive?: boolean
  disabled?: boolean
  label: string
  onClick: () => void
  title?: string
}) {
  return (
    <button
      className={clsx(rowClass, 'touch-manipulation border-t border-border disabled:cursor-not-allowed disabled:opacity-40', destructive && 'text-negative')}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {label}
    </button>
  )
}

export interface SheetPickOption<T extends string = string> {
  id: T
  label: ReactNode
  ariaLabel?: string
  leading?: ReactNode
}

// `panel` rows live inside an accordion (44px, rounded, selected row filled);
// `sheet` rows are the sheet body itself (52px, hairline-separated).
const pickVariantClass = {
  panel: { row: 'min-h-11 rounded-md px-2.5', selected: 'bg-border-strong text-text-1' },
  sheet: { row: 'min-h-[52px] border-t border-border font-medium', selected: 'text-text-1' },
} as const

export function SheetPickList<T extends string = string>({ onChange, options, selectedIds, selectionMode = 'single', variant = 'panel' }: {
  onChange: (selectedIds: T[]) => void
  options: ReadonlyArray<SheetPickOption<T>>
  selectedIds: T[]
  selectionMode?: 'single' | 'multi'
  variant?: keyof typeof pickVariantClass
}) {
  const multi = selectionMode === 'multi'
  const classes = pickVariantClass[variant]
  function toggle(id: T) {
    if (!multi) return onChange([id])
    onChange(selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id])
  }
  return (
    <div role={multi ? 'group' : 'radiogroup'}>
      {options.map((option) => {
        const selected = selectedIds.includes(option.id)
        return (
          <button
            aria-checked={selected}
            aria-label={option.ariaLabel}
            className={clsx('flex w-full touch-manipulation items-center gap-2.5 text-left text-sm', classes.row, selected ? classes.selected : 'text-text-2')}
            key={option.id}
            onClick={() => toggle(option.id)}
            role={multi ? 'checkbox' : 'radio'}
            type="button"
          >
            {option.leading}
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {selected ? <Check aria-hidden className="h-3 w-3 shrink-0 text-accent" /> : null}
          </button>
        )
      })}
    </div>
  )
}

export function SheetField({ changed = false, disabled = false, expanded, inputMode, label, multiline = false, onChange, onToggle, placeholder, type = 'text', value }: {
  changed?: boolean
  disabled?: boolean
  expanded: boolean
  inputMode?: 'decimal' | 'text'
  label: string
  multiline?: boolean
  onChange: (value: string) => void
  onToggle: () => void
  placeholder: string
  type?: 'text' | 'number'
  value: string
}) {
  const summary = value.trim() ? value : <span className="text-text-muted">{placeholder}</span>
  return (
    <SheetAccordionRow changed={changed} expanded={expanded} label={label} onToggle={onToggle} summary={summary}>
      {multiline
        ? <TextAreaField autoFocus disabled={disabled} hideLabel label={label} onChange={onChange} placeholder={placeholder} rows={3} value={value} variant="sheet" />
        : <TextField autoFocus disabled={disabled} hideLabel inputMode={inputMode} label={label} onChange={onChange} placeholder={placeholder} type={type} value={value} variant="sheet" />}
    </SheetAccordionRow>
  )
}
