import type { ReactNode } from 'react'

export function PickerShell({ onClose, children }: { onClose?: () => void; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border-strong bg-raised p-2 shadow-dropdown">
      {onClose ? (
        <div className="mb-1 flex justify-end">
          <button className="rounded-md px-2 py-1 text-xs font-medium text-text-muted hover:bg-hover hover:text-text-1" onClick={onClose} type="button">Close</button>
        </div>
      ) : null}
      {children}
    </div>
  )
}
