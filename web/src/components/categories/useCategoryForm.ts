import { useState } from 'react'
import { useMutation } from 'urql'
import { CREATE_CATEGORY_MUTATION, DELETE_CATEGORY_MUTATION, UPDATE_CATEGORY_MUTATION } from '../../graphql/mutations'
import { useSaveAction } from '../../hooks/useSaveAction'
import type { Category, CategoryGroup } from '../../types/graphql'
import { UNCATEGORIZED_CATEGORY_ID } from '../../utils/categoryTint'

interface CategoryDraft {
  emoji: string
  name: string
  groupId: string
}

export function useCategoryForm({ category, defaultGroupId, groups, onDeleted, onSaved }: {
  category: Category | null
  defaultGroupId?: string
  groups: CategoryGroup[]
  onDeleted: () => void
  onSaved: () => void
}) {
  const isEdit = category !== null
  const initialGroupId = category ? groups.find((g) => g.name === category.groupName)?.id ?? groups[0]?.id : (defaultGroupId ?? groups[0]?.id)
  const [draft, setDraft] = useState<CategoryDraft>({ emoji: category?.emoji ?? '', name: category?.name ?? '', groupId: initialGroupId ?? '' })
  const { error, saving, save: run, setError } = useSaveAction()
  const [deleting, setDeleting] = useState(false)
  const [, createCategory] = useMutation(CREATE_CATEGORY_MUTATION)
  const [, updateCategory] = useMutation(UPDATE_CATEGORY_MUTATION)
  const [, deleteCategory] = useMutation(DELETE_CATEGORY_MUTATION)

  const patch = (changes: Partial<CategoryDraft>) => setDraft((current) => ({ ...current, ...changes }))
  const kindLabel = groups.find((g) => g.id === draft.groupId)?.kind ?? 'EXPENSE'
  const canSave = draft.emoji.trim() !== '' && draft.name.trim() !== '' && !saving
  const canDelete = isEdit && category.id !== UNCATEGORIZED_CATEGORY_ID

  async function save() {
    const { emoji, name, groupId } = draft
    await run(
      () => isEdit
        ? updateCategory({ input: { id: category.id, name, emoji, groupId } })
        : createCategory({ input: { name, emoji, groupId } }),
      onSaved,
    )
  }

  async function remove() {
    if (!category) return false
    setError(null)
    setDeleting(true)
    try {
      const result = await deleteCategory({ id: category.id })
      if (result.error) throw new Error(result.error.message)
      onDeleted()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred')
      return false
    } finally {
      setDeleting(false)
    }
  }

  return { canDelete, canSave, deleting, draft, error, isEdit, kindLabel, patch, remove, save, saving, setError }
}
