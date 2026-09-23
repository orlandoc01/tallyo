import clsx from 'clsx'
import type { ButtonHTMLAttributes } from 'react'

export function ActionMenuItem({ className, destructive = false, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { destructive?: boolean }) {
  return <button {...props} className={clsx('flex h-[34px] w-full items-center rounded-[5px] px-2 text-left text-[13px] hover:bg-hover', destructive ? 'text-negative' : 'text-text-1', className)} type={type} />
}
