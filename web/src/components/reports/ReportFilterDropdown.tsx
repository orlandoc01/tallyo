import type { ReactNode } from 'react'
import clsx from 'clsx'
import { FilterDropdownShell } from '../common/FilterDropdownShell'

export function ReportFilterDropdown({ activeFilterCount, children, onClear }: { activeFilterCount: number; children: ReactNode; onClear: () => void }) {
  return (
    <FilterDropdownShell
      activeFilterCount={activeFilterCount}
      dark
      panelClassName="absolute right-0 z-20 mt-2 w-80 rounded-2xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900"
      wrapperClassName="relative hidden lg:block"
      onClear={onClear}
    >
      {children}
    </FilterDropdownShell>
  )
}

export function ReportFilterSection({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3
        className={clsx(
          'rounded-xl border px-2 py-2 text-sm font-semibold transition-colors dark:text-neutral-200',
          active
            ? 'border-brand-200 bg-brand-50/70 text-brand-900 ring-1 ring-inset ring-brand-200 dark:border-brand-400/30 dark:bg-brand-500/10 dark:text-brand-100 dark:ring-brand-400/30'
            : 'border-transparent text-neutral-700',
        )}
      >
        Date Range
      </h3>
      {children}
    </section>
  )
}
