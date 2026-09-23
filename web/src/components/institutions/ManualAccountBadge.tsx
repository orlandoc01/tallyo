export function ManualAccountBadge({ label = 'Manual account' }: { label?: string }) {
  return (
    <span
      aria-label={label}
      className="inline-flex h-4 shrink-0 items-center rounded border border-brand-600/50 bg-brand-600/[0.12] px-1.5 text-[10px] font-semibold leading-4 tracking-[.5px] text-accent"
      title={label}
    >
      MANUAL
    </span>
  )
}
