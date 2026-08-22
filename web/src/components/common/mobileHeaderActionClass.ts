import clsx from 'clsx'

export function mobileHeaderActionClass(baseClassName: string, active = false) {
  return clsx(
    baseClassName,
    'bg-white [@media(hover:hover)]:hover:bg-neutral-100',
    active
      ? 'text-brand-700 ring-1 ring-brand-300 [@media(hover:hover)]:hover:text-brand-800'
      : 'text-neutral-700 [@media(hover:hover)]:hover:text-neutral-950',
  )
}
