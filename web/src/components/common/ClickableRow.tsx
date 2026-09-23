import type { CSSProperties, ReactNode } from 'react'

export function ClickableRow({ ariaControls, ariaLabel, children, className, expanded, onClick, onHoverChange, pressed, style }: {
  ariaControls?: string
  ariaLabel?: string
  children: ReactNode
  className: string
  expanded?: boolean
  onClick?: () => void
  onHoverChange?: (hovered: boolean) => void
  pressed?: boolean
  style?: CSSProperties
}) {
  const hoverProps = onHoverChange ? { onMouseEnter: () => onHoverChange(true), onMouseLeave: () => onHoverChange(false) } : {}
  if (!onClick) return <div className={className} style={style} {...hoverProps}>{children}</div>
  return (
    <button aria-controls={ariaControls} aria-expanded={expanded} aria-label={ariaLabel} aria-pressed={pressed} className={className} onClick={onClick} style={style} type="button" {...hoverProps}>
      {children}
    </button>
  )
}
