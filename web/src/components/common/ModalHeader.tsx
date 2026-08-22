import { X } from 'lucide-react'

export function ModalHeader({ title, subtitle, closeLabel, onClose }: { title: string; subtitle: string; closeLabel?: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-xl font-bold text-neutral-950">{title}</h2>
        <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>
      </div>
      <ModalCloseButton label={closeLabel} onClick={onClose} />
    </div>
  )
}

export function ModalTitleRow({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-bold">{title}</h2>
      <ModalCloseButton onClick={onClose} />
    </div>
  )
}

export function ModalCloseButton({ className = '', label = 'Close', onClick }: { className?: string; label?: string; onClick: () => void }) {
  return (
    <button aria-label={label} className={`rounded-lg p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 ${className}`} onClick={onClick} type="button">
      <X className="h-5 w-5" />
    </button>
  )
}
