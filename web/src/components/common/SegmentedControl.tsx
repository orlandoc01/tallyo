import clsx from 'clsx'
import type { ReactNode } from 'react'

interface SegmentedControlOption<T extends string> {
  ariaLabel?: string
  iconOnly?: boolean
  label: ReactNode
  title?: string
  value: T
}

export function SegmentedControl<T extends string>({
  ariaLabel,
  fullWidth = false,
  options,
  semantics = 'radio',
  size = 'md',
  value,
  onChange,
}: {
  ariaLabel: string
  fullWidth?: boolean | 'always'
  options: ReadonlyArray<SegmentedControlOption<T>>
  semantics?: 'radio' | 'tab'
  size?: 'sm' | 'md'
  value: T
  onChange: (value: T) => void
}) {
  const tabs = semantics === 'tab'
  return (
    <div aria-label={ariaLabel} className={clsx('inline-flex shrink-0 overflow-hidden rounded-md border border-border-strong', fullWidth === 'always' ? 'w-full' : fullWidth && 'w-full lg:w-auto')} role={tabs ? 'tablist' : 'radiogroup'}>
      {options.map((option) => (
        <button
          aria-checked={tabs ? undefined : value === option.value}
          aria-label={option.ariaLabel}
          aria-selected={tabs ? value === option.value : undefined}
          className={clsx(
            'inline-flex flex-1 items-center justify-center gap-2 border-l border-border-strong font-medium transition first:border-l-0',
            fullWidth !== 'always' && 'lg:flex-none',
            size === 'sm' ? 'h-7 text-xs' : 'h-9 text-[13px] lg:h-8',
            option.iconOnly ? (size === 'sm' ? 'w-7 px-0' : 'w-10 px-0 lg:w-8') : size === 'sm' ? 'px-2.5' : 'px-3',
            value === option.value ? 'bg-border-strong text-text-1' : 'bg-raised text-text-muted hover:text-text-1',
          )}
          key={option.value}
          onClick={() => onChange(option.value)}
          role={tabs ? 'tab' : 'radio'}
          title={option.title}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
