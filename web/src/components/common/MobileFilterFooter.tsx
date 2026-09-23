import { Button, type ButtonVariant } from './Button'

interface MobileFilterFooterProps {
  primaryLabel?: string
  secondaryLabel?: string
  secondaryVariant?: ButtonVariant
  onPrimary: () => void
  onSecondary?: () => void
}

export function MobileFilterFooter({ primaryLabel = 'Apply', secondaryLabel = 'Clear all', secondaryVariant = 'secondary', onPrimary, onSecondary }: MobileFilterFooterProps) {
  return (
    <div className="flex shrink-0 gap-3 border-t border-border px-4 pb-7 pt-3">
      {onSecondary ? <Button className="flex-1 touch-manipulation" onClick={onSecondary} size="lg" variant={secondaryVariant}>{secondaryLabel}</Button> : null}
      <Button className="flex-1 touch-manipulation" onClick={onPrimary} size="lg">{primaryLabel}</Button>
    </div>
  )
}
