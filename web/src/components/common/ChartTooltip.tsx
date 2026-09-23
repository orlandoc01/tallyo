import { useEffect, type ReactNode } from 'react'
import { useActiveTooltipLabel, useIsTooltipActive } from 'recharts'
import { chartTheme, clampTooltipX } from '../../utils/chartStyles'

export function ChartTooltipBox({ children, clampWidth, coordinate }: { children: ReactNode; clampWidth?: number; coordinate?: { x?: number } }) {
  const clamped = clampWidth && coordinate?.x !== undefined ? { position: 'absolute' as const, left: clampTooltipX(coordinate.x, clampWidth), transform: 'translateX(-50%)', whiteSpace: 'nowrap' as const } : undefined
  return (
    <div className="text-text-1" style={{ ...chartTheme.tooltip, ...clamped }}>
      {children}
    </div>
  )
}

export function ChartTooltipTitle({ children }: { children: ReactNode }) {
  return <p className="text-[11px] text-text-muted">{children}</p>
}

export function ChartTooltipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-text-3">{label}</span>
      <span className="ml-auto pl-3 font-medium tabular-nums">{value}</span>
    </div>
  )
}

// Mirrors the chart's active point (pointer hover or keyboard navigation)
// into React state so siblings outside the chart can react to it.
export function ActiveTooltipLabelTracker({ onChange }: { onChange: (label: string | null) => void }) {
  const label = useActiveTooltipLabel()
  const active = useIsTooltipActive()
  useEffect(() => {
    onChange(active && typeof label === 'string' ? label : null)
  }, [active, label, onChange])
  return null
}
