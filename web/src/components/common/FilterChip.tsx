import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'
import { useCallback, useId, useRef, useState, type ReactNode } from 'react'
import { useDismiss } from '../../hooks/useDismiss'
import { Button } from './Button'
import { checkboxClass, radioClass, TextField } from './FormControls'

function FilterChip({ label, summary, open, active, onClick }: {
  label: string
  summary?: ReactNode
  open: boolean
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      aria-expanded={open}
      aria-haspopup="true"
      className={clsx(
        'inline-flex h-[30px] items-center gap-1.5 rounded-md border pl-3 pr-2.5 text-[13px] font-medium text-text-1 transition',
        active ? 'border-brand-600 bg-border-strong' : 'border-border-strong bg-raised hover:bg-border-strong',
      )}
      onClick={onClick}
      type="button"
    >
      {label}
      {summary ? <span className="text-accent">{summary}</span> : null}
      <ChevronDown aria-hidden className={clsx('h-2.5 w-2.5 text-text-muted transition-transform', open && 'rotate-180')} />
    </button>
  )
}

export function FilterDropdown({ label, summary, active, width = 220, children }: {
  label: string
  summary?: ReactNode
  active: boolean
  width?: 200 | 220 | 240 | 300 | 320
  children: ReactNode | ((close: () => void) => ReactNode)
}) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, close, [wrapperRef])

  return (
    <div className="relative" ref={wrapperRef}>
      <FilterChip active={active} label={label} onClick={() => setOpen((current) => !current)} open={open} summary={summary} />
      {open ? (
        <div className="absolute left-0 top-9 z-30 rounded-lg border border-border-strong bg-raised p-2 shadow-dropdown" style={{ width }}>
          {typeof children === 'function' ? children(close) : children}
        </div>
      ) : null}
    </div>
  )
}

interface FilterOptionRowProps {
  ariaLabel?: string
  count?: number
  indeterminate?: boolean
  label: ReactNode
  leading?: ReactNode
  selected: boolean
  onToggle: () => void
}

export function FilterOptionRow({ ariaLabel, count, indeterminate = false, label, leading, selected, onToggle }: FilterOptionRowProps) {
  return (
    <label className="flex h-[34px] cursor-pointer items-center gap-2 rounded-[5px] px-2 text-[13px] text-text-1 hover:bg-hover">
      <input
        aria-label={ariaLabel}
        checked={selected}
        className={clsx(checkboxClass, 'h-4 w-4')}
        onChange={onToggle}
        ref={(input) => { if (input) input.indeterminate = indeterminate }}
        type="checkbox"
      />
      {leading}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined ? <span className="text-xs text-text-muted">{count}</span> : null}
    </label>
  )
}

export function FilterGroupRow({ label, ...props }: FilterOptionRowProps) {
  return <FilterOptionRow {...props} label={<span className="text-[11px] font-medium uppercase tracking-[0.6px] text-text-muted">{label}</span>} />
}

export function FilterPresetRow({ hint, label, selected, onSelect }: {
  hint?: string
  label: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      aria-checked={selected}
      className={clsx('flex h-8 w-full items-center justify-between gap-3 rounded-[5px] px-2 text-[13px] text-left', selected ? 'bg-border-strong text-text-1' : 'text-text-2 hover:bg-hover')}
      onClick={onSelect}
      role="radio"
      type="button"
    >
      <span>{label}</span>
      {hint ? <span className="text-xs text-text-muted">{hint}</span> : null}
    </button>
  )
}

export function FilterDateRangeInputs({ dateFrom, dateTo, onChange }: {
  dateFrom?: string
  dateTo?: string
  onChange: (next: { dateFrom?: string; dateTo?: string }) => void
}) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border-strong pt-2">
      <TextField ariaLabel="Start date" label="From" onChange={(value) => onChange({ dateFrom: value || undefined, dateTo })} type="date" value={dateFrom ?? ''} />
      <TextField ariaLabel="End date" label="To" onChange={(value) => onChange({ dateFrom, dateTo: value || undefined })} type="date" value={dateTo ?? ''} />
    </div>
  )
}

export function FilterAmountInputs({ exact, max, min, onChange }: {
  exact?: number
  max?: number
  min?: number
  onChange: (next: { exact?: number; max?: number; min?: number }) => void
}) {
  return (
    <div className="space-y-2 px-1 pt-1">
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Amount min" onChange={(value) => onChange({ exact, max, min: value })} placeholder="Min" value={min} />
        <NumberField label="Amount max" onChange={(value) => onChange({ exact, max: value, min })} placeholder="Max" value={max} />
      </div>
      <NumberField label="Exact amount" onChange={(value) => onChange({ exact: value, max, min })} placeholder="Exact amount" value={exact} />
    </div>
  )
}

function NumberField({ label, onChange, placeholder, value }: { label: string; onChange: (value: number | undefined) => void; placeholder: string; value?: number }) {
  return (
    <TextField
      hideLabel
      label={label}
      onChange={(raw) => {
        const parsed = Number(raw)
        onChange(raw === '' || !Number.isFinite(parsed) ? undefined : parsed)
      }}
      placeholder={placeholder}
      step="0.01"
      type="number"
      value={value ?? ''}
    />
  )
}

export function FilterPresetPills<T extends string>({ options, selectedId, onSelect }: { options: ReadonlyArray<{ id: T; label: string }>; selectedId?: T; onSelect: (id: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 px-1 pt-2">
      {options.map((option) => (
        <Button aria-pressed={option.id === selectedId} key={option.id} onClick={() => onSelect(option.id)} pressed={option.id === selectedId} size="xs" variant="secondary">
          {option.label}
        </Button>
      ))}
    </div>
  )
}

export function FilterRadioRow<T extends string>({ ariaLabel, layout = 'row', options, selectedId, onSelect }: { ariaLabel: string; layout?: 'row' | 'list'; options: ReadonlyArray<{ id: T; label: string }>; selectedId: T; onSelect: (id: T) => void }) {
  const name = useId()
  return (
    <fieldset aria-label={ariaLabel} className={layout === 'row' ? 'mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-border-strong px-1 pt-2' : undefined}>
      {options.map((option) => {
        const selected = option.id === selectedId
        return (
          <label
            className={clsx(
              'flex cursor-pointer items-center gap-2 text-[13px]',
              layout === 'row' ? 'h-7' : 'h-8 rounded-[5px] px-2',
              selected ? 'text-text-1' : 'text-text-2',
              layout === 'list' && (selected ? 'bg-border-strong' : 'hover:bg-hover'),
            )}
            key={option.id}
          >
            <input checked={selected} className={clsx(radioClass, 'h-3.5 w-3.5')} name={name} onChange={() => onSelect(option.id)} type="radio" value={option.id} />
            {option.label}
          </label>
        )
      })}
    </fieldset>
  )
}
