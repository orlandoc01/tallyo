import clsx from 'clsx'

export function underlineTabsClassName(className?: string) {
  return clsx('flex w-full max-w-full overflow-x-auto border-b border-border sm:w-fit', className)
}

export function underlineTabClassName(isActive: boolean) {
  return clsx(
    '-mb-px flex shrink-0 items-center justify-center whitespace-nowrap border-b-2 px-5 py-2.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong',
    isActive
      ? 'border-accent text-accent'
      : 'border-transparent text-text-3 hover:bg-brand-50/70 hover:text-text-1',
  )
}
