import clsx from 'clsx'
import type { CSSProperties } from 'react'

const dots = (color: string) => `repeating-linear-gradient(90deg, ${color} 0 2px, transparent 2px 4px)`

export function DottedBar({ className, color, height = 5, percent }: { className?: string; color: string; height?: 5 | 6; percent: number }) {
  const width = `${Math.min(100, Math.max(0, percent))}%`
  const style: CSSProperties = { height, background: dots('rgb(var(--border-strong))') }
  return (
    <div aria-hidden className={clsx('w-full min-w-0', className)} style={style}>
      <div className="h-full" style={{ width, background: dots(color) }} />
    </div>
  )
}
