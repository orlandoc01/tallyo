export function LoadingSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div aria-live="polite" className="flex items-center gap-3 p-6 text-sm text-neutral-500" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      {label}
    </div>
  )
}

export function CenteredSpinner({ label = 'Linking connection…' }: { label?: string }) {
  return (
    <div className="flex justify-center py-12">
      <LoadingSpinner label={label} />
    </div>
  )
}
