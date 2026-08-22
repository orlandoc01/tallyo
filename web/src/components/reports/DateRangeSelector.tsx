import { useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { GRANULARITIES } from '../../hooks/useReportFilterParamCore'
import type { Granularity } from '../../types/graphql'
import { formatCompactDisplayDate } from '../../utils/dates'
import { dateRangePresets, getDateRangePresetDates, type DateRangePresetOption } from './dateRangePresets'

export function DateRangeSelector({
  className = 'flex flex-wrap items-center gap-3',
  dateInputLayout = 'inline',
  dateFrom,
  dateTo,
  granularity,
  onChange,
  presets,
}: {
  className?: string
  dateInputLayout?: 'compact' | 'inline' | 'stacked'
  dateFrom: string
  dateTo: string
  granularity: Granularity
  onChange: (next: { dateFrom: string; dateTo: string; granularity: Granularity }) => void
  presets?: DateRangePresetOption[]
}) {
  return (
    <div className={className}>
      <GranularitySelector granularity={granularity} onChange={(nextGranularity) => onChange({ dateFrom, dateTo, granularity: nextGranularity })} />
      <DateRangeInputs dateFrom={dateFrom} dateTo={dateTo} layout={dateInputLayout} onChange={(next) => onChange({ ...next, granularity })} presets={presets} />
    </div>
  )
}

export function GranularitySelector({
  buttonClassName = 'rounded-xl px-4 py-2 text-sm font-semibold',
  className = 'flex rounded-2xl bg-neutral-100 p-1',
  granularity,
  labelVariant = 'long',
  onChange,
}: {
  buttonClassName?: string
  className?: string
  granularity: Granularity
  labelVariant?: 'long' | 'short'
  onChange: (granularity: Granularity) => void
}) {
  return (
    <div className={className}>
      {GRANULARITIES.map((g) => (
        <button
          className={`${buttonClassName} ${granularity === g ? 'bg-white shadow-sm' : 'text-neutral-500'}`}
          key={g}
          onClick={() => onChange(g)}
          type="button"
        >
          {labelVariant === 'short' ? shortGranularityLabel(g) : g[0] + g.slice(1).toLowerCase()}
        </button>
      ))}
    </div>
  )
}

function shortGranularityLabel(granularity: Granularity) {
  if (granularity === 'MONTHLY') return 'Month'
  if (granularity === 'QUARTERLY') return 'Quarter'
  return 'Year'
}

export function DateRangeInputs({
  dateFrom,
  dateTo,
  layout,
  onChange,
  presets,
}: {
  dateFrom: string
  dateTo: string
  layout: 'compact' | 'inline' | 'stacked'
  onChange: (next: { dateFrom: string; dateTo: string }) => void
  presets?: DateRangePresetOption[]
}) {
  if (layout === 'compact') {
    return (
      <CompactDateRangeInputs
        dateFrom={dateFrom}
        dateTo={dateTo}
        onChange={(next) => onChange({ dateFrom: next.dateFrom ?? '', dateTo: next.dateTo ?? '' })}
        presets={presets}
      />
    )
  }

  if (layout === 'stacked') {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2">
          <DateRangePresetSelect onChange={onChange} presets={presets} />
          <input
            aria-label="Start date"
            className="min-w-0 rounded-xl border border-neutral-200 px-3 py-2 text-sm font-semibold outline-none focus:border-brand-500"
            onChange={(e) => onChange({ dateFrom: e.target.value, dateTo })}
            type="date"
            value={dateFrom}
          />
        </div>
        <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2">
          <span aria-hidden />
          <input
            aria-label="End date"
            className="min-w-0 rounded-xl border border-neutral-200 px-3 py-2 text-sm font-semibold outline-none focus:border-brand-500"
            onChange={(e) => onChange({ dateFrom, dateTo: e.target.value })}
            type="date"
            value={dateTo}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
      <DateRangePresetSelect onChange={onChange} presets={presets} />
      <input
        aria-label="Start date"
        className="min-w-0 rounded-xl border border-neutral-200 px-3 py-2 text-sm font-semibold outline-none focus:border-brand-500"
        onChange={(e) => onChange({ dateFrom: e.target.value, dateTo })}
        type="date"
        value={dateFrom}
      />
      <span className="text-sm text-neutral-400">–</span>
      <input
        aria-label="End date"
        className="min-w-0 rounded-xl border border-neutral-200 px-3 py-2 text-sm font-semibold outline-none focus:border-brand-500"
        onChange={(e) => onChange({ dateFrom, dateTo: e.target.value })}
        type="date"
        value={dateTo}
      />
    </div>
  )
}

export function CompactDateRangeInputs({
  dateFrom,
  dateTo,
  onChange,
  presets,
}: {
  dateFrom?: string
  dateTo?: string
  onChange: (next: { dateFrom?: string; dateTo?: string }) => void
  presets?: DateRangePresetOption[]
}) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2">
      <DateRangePresetSelect onChange={onChange} presets={presets} />
      <DatePillInput
        label="Start date"
        onChange={(nextDateFrom) => onChange({ dateFrom: nextDateFrom, dateTo })}
        placeholder="Start"
        value={dateFrom}
      />
      <DatePillInput
        label="End date"
        onChange={(nextDateTo) => onChange({ dateFrom, dateTo: nextDateTo })}
        placeholder="End"
        value={dateTo}
      />
    </div>
  )
}

function DatePillInput({ label, onChange, placeholder, value }: { label: string; onChange: (value: string | undefined) => void; placeholder: string; value?: string }) {
  const inputRef = useRef<HTMLInputElement>(null)

  function openDatePicker() {
    const input = inputRef.current
    if (!input) return

    input.focus()
    if (typeof input.showPicker === 'function') {
      input.showPicker()
      return
    }

    input.click()
  }

  return (
    <div className="relative min-w-0 flex-1">
      <input
        aria-label={label}
        className="sr-only"
        onChange={(event) => onChange(event.target.value || undefined)}
        ref={inputRef}
        type="date"
        value={value ?? ''}
      />
      <button
        aria-label={`Open ${label.toLowerCase()} picker`}
        className={`w-full truncate rounded-xl bg-neutral-100 px-3 py-2 text-center text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500 ${value ? 'text-neutral-900' : 'text-neutral-500'}`}
        onClick={openDatePicker}
        type="button"
      >
        {value ? formatCompactDisplayDate(value) : placeholder}
      </button>
    </div>
  )
}

function DateRangePresetSelect({
  onChange,
  presets = dateRangePresets,
}: {
  onChange: (next: { dateFrom: string; dateTo: string }) => void
  presets?: DateRangePresetOption[]
}) {
  return (
    <div className="relative shrink-0">
      <select
        aria-label="Date range preset"
        className="h-10 w-10 appearance-none overflow-hidden rounded-xl border border-neutral-200 bg-white p-0 text-transparent outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
        defaultValue=""
        onChange={(event) => {
          const selected = presets.find((p) => p.value === event.currentTarget.value)
          if (!selected) return
          const dates = selected.dateFrom && selected.dateTo
            ? { dateFrom: selected.dateFrom, dateTo: selected.dateTo }
            : getDateRangePresetDates(selected.value)
          onChange(dates)
          event.currentTarget.value = ''
        }}
      >
        <option disabled hidden value=""></option>
        {presets.map((preset) => (
          <option className="text-neutral-900" key={preset.value} value={preset.value}>{preset.label}</option>
        ))}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-neutral-600" />
    </div>
  )
}
