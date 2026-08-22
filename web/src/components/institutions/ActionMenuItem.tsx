import clsx from 'clsx'
import type { ButtonHTMLAttributes } from 'react'

export function ActionMenuItem({ className, destructive = false, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { destructive?: boolean }) {
  return <button {...props} className={clsx('block w-full px-4 py-2 text-left', destructive ? 'text-red-600 hover:bg-red-50' : 'hover:bg-neutral-50', className)} type={type} />
}
