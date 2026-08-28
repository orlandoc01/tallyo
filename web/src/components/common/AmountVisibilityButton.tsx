import { Eye, EyeOff } from 'lucide-react'
import { mobileHeaderActionClass } from './mobileHeaderActionClass'
import { PageToolbarIconButton } from './PageToolbar'

export function AmountVisibilityButton({ amountsHidden, onToggle, variant }: {
  amountsHidden: boolean
  onToggle: () => void
  variant: 'mobile' | 'toolbar'
}) {
  const Icon = amountsHidden ? EyeOff : Eye
  const ariaLabel = amountsHidden ? 'Show amounts' : 'Hide amounts'

  if (variant === 'toolbar') {
    return (
      <PageToolbarIconButton ariaLabel={ariaLabel} onClick={onToggle}>
        <Icon className="h-4 w-4" />
      </PageToolbarIconButton>
    )
  }

  return (
    <button
      aria-label={ariaLabel}
      className={mobileHeaderActionClass('touch-manipulation rounded-xl p-2.5')}
      onClick={onToggle}
      type="button"
    >
      <Icon className="h-5 w-5" />
    </button>
  )
}
