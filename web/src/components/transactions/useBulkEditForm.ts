import { useState } from 'react'
import type { TransactionUpdates } from '../../types/graphql'

export type BulkEditSection = 'category' | 'notes' | 'recurring' | 'hidden' | 'tags'

export function useBulkEditForm() {
  const [active, setActive] = useState<Set<BulkEditSection>>(new Set())
  const [categoryId, setCategoryId] = useState('')
  const [notes, setNotes] = useState('')
  const [isRecurring, setIsRecurring] = useState(false)
  const [isHidden, setIsHidden] = useState(false)
  const [tagIds, setTagIds] = useState<string[]>([])
  const canConfirm = active.size > 0 && (!active.has('category') || categoryId !== '')

  function activate(section: BulkEditSection) {
    setActive((current) => new Set(current).add(section))
  }

  function toggle(section: BulkEditSection) {
    setActive((current) => {
      const next = new Set(current)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  function buildUpdates(): TransactionUpdates {
    const updates: TransactionUpdates = {}
    if (active.has('category')) updates.categoryId = categoryId
    if (active.has('notes')) updates.notes = notes || null
    if (active.has('recurring')) updates.isRecurring = isRecurring
    if (active.has('hidden')) updates.isHidden = isHidden
    if (active.has('tags')) updates.tagIds = tagIds
    return updates
  }

  return { activate, active, buildUpdates, canConfirm, categoryId, isHidden, isRecurring, notes, setCategoryId, setIsHidden, setIsRecurring, setNotes, setTagIds, tagIds, toggle }
}
