import { X } from 'lucide-react'

export function ModalHeader({ title, subtitle, closeLabel, onClose }: { title: string; subtitle: string; closeLabel?: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-[-0.2px] text-text-1">{title}</h2>
        <p className="mt-1 text-[13px] text-text-muted">{subtitle}</p>
      </div>
      <ModalCloseButton label={closeLabel} onClick={onClose} />
    </div>
  )
}

export function ModalTitleRow({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-semibold tracking-[-0.2px] text-text-1">{title}</h2>
      <ModalCloseButton onClick={onClose} />
    </div>
  )
}

export function ModalCloseButton({ className = '', label = 'Close', onClick }: { className?: string; label?: string; onClick: () => void }) {
  return (
    <button aria-label={label} className={`rounded-md p-1 text-text-muted hover:bg-raised hover:text-text-1 ${className}`} onClick={onClick} type="button">
      <X className="h-5 w-5" />
    </button>
  )
}
