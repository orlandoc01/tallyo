import { ChevronDown, ChevronRight } from 'lucide-react'

export function CollapsibleRowToggle({ open, title, onToggle }: { open: boolean; title: string; onToggle: () => void }) {
  return (
    <button
      aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
      className="rounded-xl p-1 text-neutral-500 hover:bg-neutral-100"
      onClick={onToggle}
      type="button"
    >
      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
    </button>
  )
}
