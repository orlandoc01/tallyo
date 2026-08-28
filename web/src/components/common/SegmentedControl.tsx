import clsx from 'clsx'
import type { ReactNode } from 'react'

interface SegmentedControlOption<T extends string> {
  ariaLabel?: string
  label: ReactNode
  title?: string
  value: T
}

export function SegmentedControl<T extends string>({
  ariaLabel,
  options,
  size = 'md',
  value,
  onChange,
}: {
  ariaLabel: string
  options: ReadonlyArray<SegmentedControlOption<T>>
  size?: 'sm' | 'md'
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div aria-label={ariaLabel} className="inline-flex shrink-0 rounded-full border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-700 dark:bg-neutral-800" role="radiogroup">
      {options.map((option) => (
        <button
          aria-checked={value === option.value}
          aria-label={option.ariaLabel}
          className={clsx(
            'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition',
            size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm',
            value === option.value
              ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-100'
              : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100',
          )}
          key={option.value}
          onClick={() => onChange(option.value)}
          role="radio"
          title={option.title}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
