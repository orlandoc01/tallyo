import clsx from 'clsx'
import type { LucideIcon } from 'lucide-react'

type RowIconColor = 'brand' | 'blue' | 'violet' | 'emerald'

const colorClass: Record<RowIconColor, string> = {
  brand: 'bg-brand-100 text-brand-700',
  blue: 'bg-blue-100 text-blue-700',
  violet: 'bg-violet-100 text-violet-700',
  emerald: 'bg-emerald-100 text-emerald-700',
}

export function RowIconAvatar({ icon: Icon, color, size = 'md' }: { icon: LucideIcon; color: RowIconColor; size?: 'sm' | 'md' }) {
  return (
    <div className={clsx('flex shrink-0 items-center justify-center rounded-full', size === 'sm' ? 'h-9 w-9' : 'h-12 w-12', colorClass[color])}>
      <Icon aria-hidden className={size === 'sm' ? 'h-4 w-4' : 'h-6 w-6'} />
    </div>
  )
}
