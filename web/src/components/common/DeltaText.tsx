import clsx from 'clsx'
import type { ReactNode } from 'react'
import { formatCurrencyAbbrev, maskAmount } from '../../utils/currency'

export function DeltaText({ changePct, changeUSD, className, glyph = true, invert = false, masked = false, size = 'md', suffix }: {
  changePct: number
  changeUSD: number
  className?: string
  glyph?: boolean
  invert?: boolean
  masked?: boolean
  size?: 'sm' | 'md'
  suffix?: ReactNode
}) {
  const direction = Math.sign(changeUSD)
  const positive = invert ? direction < 0 : direction > 0
  const tone = direction === 0 ? 'text-text-muted' : positive ? 'text-positive' : 'text-negative'
  const amount = direction === 0 ? '$0 (0%)' : `${formatCurrencyAbbrev(Math.abs(changeUSD))} (${Math.abs(changePct).toFixed(1)}%)`
  const prefix = direction === 0 ? '' : glyph ? (direction > 0 ? '▲ ' : '▼ ') : (direction > 0 ? '+' : '-')

  return (
    <span className={clsx(tone, size === 'sm' ? 'text-xs' : 'text-[13px] font-medium', className)}>
      {prefix}{masked ? maskAmount(amount) : amount}{suffix}
    </span>
  )
}
