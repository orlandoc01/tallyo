import clsx from 'clsx'

export function mobileHeaderActionClass(baseClassName: string, active = false) {
  return clsx(
    'inline-flex h-9 min-w-9 items-center justify-center rounded-md border border-border-strong transition',
    baseClassName,
    active ? 'bg-border-strong text-accent' : 'bg-raised text-text-2 [@media(hover:hover)]:hover:bg-border-strong',
  )
}
