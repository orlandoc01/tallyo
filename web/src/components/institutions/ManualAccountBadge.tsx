export function ManualAccountBadge({ label = 'Manual account' }: { label?: string }) {
  return (
    <span
      aria-label={label}
      className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-brand-200 bg-brand-100 align-middle text-xs font-bold uppercase text-brand-700 dark:border-brand-400/30"
      title={label}
    >
      M
    </span>
  )
}
