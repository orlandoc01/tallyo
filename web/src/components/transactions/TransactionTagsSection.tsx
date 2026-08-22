import { useRef, useState } from 'react'
import type { Transaction } from '../../types/graphql'
import { useTags } from '../../hooks/useEntityQueries'
import { useDismiss } from '../../hooks/useDismiss'
import { usePermissions } from '../../hooks/usePermissions'
import { CreateTagModal } from './CreateTagModal'
import { TagChip, TagPicker } from './TagPicker'

export function TransactionTagsSection({
  onSetTagIds,
  transaction,
}: {
  onSetTagIds: (tagIds: string[]) => Promise<void>
  transaction: Transaction
}) {
  const [isTagOpen, setIsTagOpen] = useState(false)
  const [isCreateTagOpen, setIsCreateTagOpen] = useState(false)
  const tagButtonRef = useRef<HTMLButtonElement>(null)
  const tagPickerRef = useRef<HTMLDivElement>(null)
  const { tags, refetch: refetchTags } = useTags()
  const { canWrite } = usePermissions()
  const canWriteTags = canWrite('tags')

  useDismiss(isTagOpen, () => setIsTagOpen(false), [tagButtonRef, tagPickerRef])

  const selectedTags = transaction.tags ?? []

  return (
    <div className="space-y-2 border-t border-neutral-100 pt-4">
      <div className="text-sm font-medium text-neutral-700">Tags</div>
      <div className="flex flex-wrap gap-2">
        {selectedTags.map((tag) => (
          <TagChip key={tag.id} tag={tag} onRemove={() => onSetTagIds(selectedTags.filter((item) => item.id !== tag.id).map((item) => item.id))} />
        ))}
        <button ref={tagButtonRef} type="button" className="rounded-full border border-neutral-200 px-3 py-1 text-xs font-semibold" onClick={() => setIsTagOpen((open) => !open)}>+ Tags</button>
      </div>
      {isTagOpen ? (
        <div className="relative" ref={tagPickerRef}>
          <TagPicker
            tags={tags}
            selectedTagIds={selectedTags.map((tag) => tag.id)}
            onClose={() => setIsTagOpen(false)}
            onCreate={canWriteTags ? () => setIsCreateTagOpen(true) : undefined}
            onToggle={(tag) => {
              const selected = new Set(selectedTags.map((item) => item.id))
              if (selected.has(tag.id)) selected.delete(tag.id)
              else selected.add(tag.id)
              onSetTagIds([...selected])
            }}
          />
        </div>
      ) : null}

      {isCreateTagOpen && canWriteTags ? <CreateTagModal onClose={() => setIsCreateTagOpen(false)} onSaved={(tag) => { setIsCreateTagOpen(false); refetchTags({ requestPolicy: 'network-only' }); onSetTagIds([...selectedTags.map((item) => item.id), tag.id]) }} /> : null}
    </div>
  )
}
