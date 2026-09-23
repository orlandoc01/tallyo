import { Eye, EyeOff } from 'lucide-react'
import { IconButton } from './Button'

export function AmountVisibilityButton({ amountsHidden, onToggle, variant }: {
  amountsHidden: boolean
  onToggle: () => void
  variant: 'mobile' | 'toolbar'
}) {
  const Icon = amountsHidden ? EyeOff : Eye
  const ariaLabel = amountsHidden ? 'Show amounts' : 'Hide amounts'

  return (
    <IconButton ariaLabel={ariaLabel} className={variant === 'mobile' ? 'touch-manipulation' : undefined} onClick={onToggle} pressed={amountsHidden}>
      <Icon className="h-4 w-4" />
    </IconButton>
  )
}
