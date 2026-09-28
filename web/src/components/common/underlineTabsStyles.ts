import clsx from 'clsx'

export const underlineTabsRuleClass = 'shadow-[inset_0_-1px_0_theme(colors.border)]'

export function underlineTabsClassName(className?: string) {
  return clsx('flex w-full max-w-full overflow-x-auto sm:w-fit', underlineTabsRuleClass, className)
}

export function underlineTabClassName(isActive: boolean) {
  return clsx(
    'flex shrink-0 items-center justify-center whitespace-nowrap border-b-2 px-5 py-2.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong',
    isActive
      ? 'border-accent text-accent'
      : 'border-transparent text-text-3 hover:bg-brand-50/70 hover:text-text-1',
  )
}
