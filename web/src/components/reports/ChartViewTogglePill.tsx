import clsx from 'clsx'
import type { ReactNode } from 'react'

type ToggleSize = 'md' | 'responsive' | 'mobile'

const sizeClass: Record<ToggleSize, string> = {
  md: 'px-3 py-2 text-sm',
  responsive: 'px-2 py-2 text-xs lg:px-3 lg:text-sm',
  mobile: 'px-4 py-2.5 text-sm',
}

export function ChartViewTogglePill<T extends string>({ options, value, onChange, size = 'md' }: {
  options: Array<{ value: T; label: string; icon?: ReactNode }>
  value: T
  onChange: (value: T) => void
  size?: ToggleSize
}) {
  return (
    <div className={clsx(size === 'mobile' ? 'inline-flex' : 'flex', 'rounded-2xl border border-neutral-200 bg-white p-1')}>
      {options.map((option) => (
        <button
          className={clsx('flex items-center gap-2 rounded-xl font-semibold', sizeClass[size], option.value === value ? 'bg-neutral-100' : size === 'mobile' && 'text-neutral-500')}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  )
}
