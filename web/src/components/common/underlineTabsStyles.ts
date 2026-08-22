import clsx from 'clsx'

export function underlineTabsClassName(className?: string) {
  return clsx('flex w-full max-w-full overflow-x-auto border-b border-neutral-200 dark:border-neutral-800 sm:w-fit', className)
}

export function underlineTabClassName(isActive: boolean) {
  return clsx(
    '-mb-px flex shrink-0 items-center justify-center whitespace-nowrap border-b-4 px-5 py-2.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-300 dark:focus-visible:outline-neutral-600',
    isActive
      ? 'border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400'
      : 'border-transparent text-neutral-500 hover:bg-brand-50/70 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-brand-950/20 dark:hover:text-neutral-100',
  )
}
