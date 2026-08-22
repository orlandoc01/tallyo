interface MobileFilterFooterProps {
  primaryLabel?: string
  secondaryLabel?: string
  onPrimary: () => void
  onSecondary: () => void
}

export function MobileFilterFooter({ primaryLabel = 'Apply', secondaryLabel = 'Clear all', onPrimary, onSecondary }: MobileFilterFooterProps) {
  return (
    <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-neutral-200 p-4 pb-8">
      <button
        className="touch-manipulation rounded-xl border border-neutral-200 px-3 py-2.5 text-sm font-semibold text-neutral-700 [@media(hover:hover)]:hover:bg-neutral-50"
        onClick={onSecondary}
        type="button"
      >
        {secondaryLabel}
      </button>
      <button
        className="touch-manipulation rounded-xl bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white [@media(hover:hover)]:hover:bg-brand-700"
        onClick={onPrimary}
        type="button"
      >
        {primaryLabel}
      </button>
    </div>
  )
}
