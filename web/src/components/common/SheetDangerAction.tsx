import { useTwoStepConfirm } from '../../hooks/useTwoStepConfirm'
import { Button } from './Button'

function revealHint(hint: HTMLParagraphElement | null) {
  hint?.scrollIntoView({ block: 'nearest' })
}

// Renders as the last child of a sheet body.
export function SheetDangerAction({ busy = false, busyLabel = 'Removing…', confirming, disabled = false, hint = "This can't be undone.", label, onSelect, title }: {
  busy?: boolean
  busyLabel?: string
  confirming?: boolean
  disabled?: boolean
  hint?: string
  label: string
  onSelect: () => void
  title?: string
}) {
  const internal = useTwoStepConfirm()
  const armed = confirming ?? internal.confirming

  function handleClick() {
    if (confirming !== undefined) return onSelect()
    if (!internal.confirming) return internal.arm()
    internal.reset()
    onSelect()
  }

  return (
    <div aria-live="polite" className="border-t border-border pt-3.5 pb-1">
      <Button className="w-full touch-manipulation" disabled={disabled || busy} onClick={handleClick} size="lg" title={title} variant={armed ? 'danger-solid' : 'danger-tinted'}>
        {busy ? busyLabel : armed ? 'Tap again to confirm' : label}
      </Button>
      {armed ? <p className="mt-2 text-center text-[11px] text-text-3" ref={revealHint}>{hint}</p> : null}
    </div>
  )
}
