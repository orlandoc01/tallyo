import type { Tag } from '../../types/graphql'
import { PickerShell } from '../common/PickerShell'

export function TagChip({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold" style={{ backgroundColor: `${tag.color}22`, color: tag.color }}>
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
      {tag.name}
      {onRemove ? <button type="button" className="ml-1" onClick={onRemove} aria-label={`Remove ${tag.name}`}>x</button> : null}
    </span>
  )
}

export function TagPicker({ onClose, onCreate, onToggle, selectedTagIds, tags }: { onClose?: () => void; onCreate?: () => void; onToggle: (tag: Tag) => void; selectedTagIds: string[]; tags: Tag[] }) {
  const selected = new Set(selectedTagIds)
  return (
    <PickerShell onClose={onClose}>
      <div className="max-h-48 overflow-auto">
        {tags.map((tag) => (
          <button key={tag.id} type="button" className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm hover:bg-neutral-50" onClick={() => onToggle(tag)}>
            <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tag.color }} />{tag.name}</span>
            <span>{selected.has(tag.id) ? '✓' : ''}</span>
          </button>
        ))}
      </div>
      {onCreate ? <button type="button" className="mt-2 w-full rounded-xl border border-dashed border-neutral-300 px-3 py-2 text-sm font-semibold text-brand-700" onClick={onCreate}>Create new tag</button> : null}
    </PickerShell>
  )
}
