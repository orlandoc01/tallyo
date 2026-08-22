import { LoaderCircle } from 'lucide-react'
import { DialogButtonRow } from '../common/Button'

export type RestartPhase = 'idle' | 'confirm' | 'restarting'

// Confirm-then-progress overlay for configuration saves that restart the server.
export function ServerRestartOverlay({
  onCancel,
  onConfirm,
  phase,
}: {
  onCancel: () => void
  onConfirm: () => void
  phase: RestartPhase
}) {
  if (phase === 'confirm') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pt-16 lg:p-4">
        <div aria-hidden className="fixed inset-x-0 bottom-0 top-12 bg-neutral-950/40 lg:inset-0" />
        <section aria-modal="true" className="relative w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl" role="dialog">
          <h2 className="text-lg font-bold text-neutral-950">Restart required</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-600">Saving Authorization settings will restart the server. Any active sessions will be briefly interrupted.</p>
          <DialogButtonRow onPrimary={onConfirm} onSecondary={onCancel} primaryLabel="Save and restart" secondaryLabel="Cancel" />
        </section>
      </div>
    )
  }

  if (phase === 'restarting') {
    return (
      <div aria-live="polite" className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 pt-12" role="status">
        <div aria-hidden className="fixed inset-x-0 bottom-0 top-12 bg-neutral-950/60 lg:inset-0" />
        <LoaderCircle aria-hidden className="h-10 w-10 animate-spin text-white" />
        <p className="text-sm font-semibold text-white">Server restarting…</p>
      </div>
    )
  }

  return null
}
