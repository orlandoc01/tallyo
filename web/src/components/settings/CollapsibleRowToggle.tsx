import clsx from 'clsx'

export function CollapsibleRowToggle({ open, title, onToggle }: { open: boolean; title: string; onToggle: () => void }) {
  return (
    <button
      aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] text-text-muted transition hover:bg-raised hover:text-text-1"
      onClick={onToggle}
      type="button"
    >
      <span aria-hidden className={clsx('inline-block transition-transform duration-150', open && 'rotate-90')}>▶</span>
    </button>
  )
}
