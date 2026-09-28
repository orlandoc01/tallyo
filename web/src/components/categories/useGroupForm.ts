import { useState } from 'react'
import { useMutation } from 'urql'
import { CREATE_CATEGORY_GROUP_MUTATION, UPDATE_CATEGORY_GROUP_MUTATION } from '../../graphql/mutations'
import { useSaveAction } from '../../hooks/useSaveAction'
import type { CategoryGroup, CategoryKind } from '../../types/graphql'

export const KIND_OPTIONS: { value: CategoryKind; label: string }[] = [
  { value: 'EXPENSE', label: 'Expense' },
  { value: 'INCOME', label: 'Income' },
  { value: 'TRANSFER', label: 'Transfer' },
]

interface GroupDraft {
  emoji: string
  name: string
  kind: CategoryKind
}

export function useGroupForm({ group, onSaved }: { group: CategoryGroup | null; onSaved: () => void }) {
  const isEdit = group !== null
  const [draft, setDraft] = useState<GroupDraft>({ emoji: group?.emoji ?? '', name: group?.name ?? '', kind: group?.kind ?? 'EXPENSE' })
  const { error, saving, save: run } = useSaveAction()
  const [, createGroup] = useMutation(CREATE_CATEGORY_GROUP_MUTATION)
  const [, updateGroup] = useMutation(UPDATE_CATEGORY_GROUP_MUTATION)

  const patch = (changes: Partial<GroupDraft>) => setDraft((current) => ({ ...current, ...changes }))
  const canSave = draft.emoji.trim() !== '' && draft.name.trim() !== '' && !saving

  async function save() {
    const { emoji, name, kind } = draft
    await run(
      () => isEdit
        ? updateGroup({ input: { id: group.id, name, emoji } })
        : createGroup({ input: { name, emoji, kind } }),
      onSaved,
    )
  }

  return { canSave, draft, error, isEdit, patch, save, saving }
}
