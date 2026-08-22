import type { ReactNode } from 'react'

export function PickerShell({ onClose, children }: { onClose?: () => void; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-2 shadow-card">
      {onClose ? (
        <div className="mb-1 flex justify-end">
          <button className="rounded-lg px-2 py-1 text-xs font-semibold text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700" onClick={onClose} type="button">Close</button>
        </div>
      ) : null}
      {children}
    </div>
  )
}
