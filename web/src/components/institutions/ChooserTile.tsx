import type { LucideIcon } from 'lucide-react'

// A large icon-and-label tile button used by the add-account / link-connection
// chooser modals.
export function ChooserTile({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      className="flex flex-col items-center gap-3 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-6 text-center hover:border-brand-300 hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-500"
      onClick={onClick}
      type="button"
    >
      <Icon className="h-8 w-8 text-brand-600" />
      <div>
        <p className="font-semibold text-neutral-950">{label}</p>
      </div>
    </button>
  )
}
