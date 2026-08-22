import clsx from 'clsx'
import { useState, type ReactNode } from 'react'
import { TextAreaField } from '../common/FormControls'
import { Modal, ModalActions } from '../common/Modal'
import { ModalCloseButton } from '../common/ModalHeader'
import type { Category, Tag, TransactionUpdates } from '../../types/graphql'
import { CategorySelect } from './CategorySelect'
import { TagChip, TagPicker } from './TagPicker'

type SectionKey = 'category' | 'notes' | 'recurring' | 'hidden' | 'tags'

const activeSectionClass = 'bg-brand-50/70 ring-1 ring-inset ring-brand-200 dark:bg-brand-500/10 dark:ring-brand-400/30'
const inactiveSectionClass = '[@media(hover:hover)]:hover:bg-neutral-100 dark:[@media(hover:hover)]:hover:bg-neutral-800/70'

export function BulkEditTransactionsModal({ categories, error, selectedCount, submitting, tags, onClose, onConfirm }: {
  categories: Category[]
  error?: string | null
  selectedCount: number
  submitting?: boolean
  tags: Tag[]
  onClose: () => void
  onConfirm: (updates: TransactionUpdates) => void
}) {
  const [active, setActive] = useState<Set<SectionKey>>(new Set())
  const [categoryId, setCategoryId] = useState('')
  const [notes, setNotes] = useState('')
  const [isRecurring, setIsRecurring] = useState(false)
  const [isHidden, setIsHidden] = useState(false)
  const [tagIds, setTagIds] = useState<string[]>([])
  const selectedTags = tags.filter((tag) => tagIds.includes(tag.id))
  const canConfirm = active.size > 0 && (!active.has('category') || categoryId !== '')

  function activate(section: SectionKey) {
    setActive((current) => new Set(current).add(section))
  }

  function toggle(section: SectionKey) {
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

  return (
    <Modal label="Edit multiple" onClose={onClose} scrollable size="lg">
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-neutral-950 dark:text-neutral-50">Edit multiple</h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Update {selectedCount} selected transactions.</p>
          </div>
          <ModalCloseButton className="dark:hover:bg-neutral-800 dark:hover:text-neutral-200" label="Close edit multiple" onClick={onClose} />
        </div>

        <div className="space-y-3">
          <BulkEditSection active={active.has('category')} label="Category" onToggle={() => toggle('category')}>
            <CategorySelect categories={categories} hideLabel label="Category" onChange={(value) => { setCategoryId(value); activate('category') }} placeholder="Select a category" value={categoryId} />
          </BulkEditSection>

          <BulkEditSection active={active.has('notes')} label="Notes" onToggle={() => toggle('notes')}>
            <TextAreaField className="mt-2" controlClassName="dark:border-neutral-700 dark:bg-neutral-900" hideLabel label="Notes" minHeight="min-h-24" onChange={(notes) => { setNotes(notes); activate('notes') }} placeholder="Replace notes" value={notes} />
          </BulkEditSection>

          <BulkEditSection active={active.has('recurring')} label="Recurring" onToggle={() => toggle('recurring')}>
            <YesNo value={isRecurring} onChange={(value) => { setIsRecurring(value); activate('recurring') }} />
          </BulkEditSection>

          <BulkEditSection active={active.has('hidden')} label="Hidden" onToggle={() => toggle('hidden')}>
            <YesNo value={isHidden} onChange={(value) => { setIsHidden(value); activate('hidden') }} />
          </BulkEditSection>

          <BulkEditSection active={active.has('tags')} label="Tags" onToggle={() => toggle('tags')}>
            {selectedTags.length > 0 ? (
              <div className="mb-2 flex flex-wrap gap-2">{selectedTags.map((tag) => <TagChip key={tag.id} tag={tag} />)}</div>
            ) : <p className="mb-2 text-xs text-neutral-500">No tags selected.</p>}
            <TagPicker
              onToggle={(tag) => {
                setTagIds((ids) => ids.includes(tag.id) ? ids.filter((id) => id !== tag.id) : [...ids, tag.id])
                activate('tags')
              }}
              selectedTagIds={tagIds}
              tags={tags}
            />
          </BulkEditSection>
        </div>

        {error ? <p className="text-sm font-medium text-red-600" role="alert">{error}</p> : null}
        <ModalActions busy={submitting} cancelDisabled={submitting} disabled={!canConfirm || selectedCount === 0 || submitting} onCancel={onClose} onSubmit={() => onConfirm(buildUpdates())} submitLabel="Confirm" submitType="button" />
      </div>
    </Modal>
  )
}

function BulkEditSection({ active, children, label, onToggle }: { active: boolean; children: ReactNode; label: string; onToggle: () => void }) {
  return (
    <section className={clsx('rounded-2xl border border-neutral-100 p-3 transition dark:border-neutral-800', active ? activeSectionClass : inactiveSectionClass)}>
      <button className="mb-2 flex w-full items-center justify-between text-left text-sm font-semibold text-neutral-950 dark:text-neutral-100" onClick={onToggle} type="button">
        <span>{label}</span>
        <span className="text-xs text-neutral-500">{active ? 'Active' : 'Inactive'}</span>
      </button>
      {children}
    </section>
  )
}

function YesNo({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="mt-2 flex gap-2">
      {[true, false].map((option) => (
        <button key={String(option)} className={clsx('rounded-xl border px-3 py-2 text-sm font-semibold', value === option ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-neutral-200 text-neutral-600')} onClick={() => onChange(option)} type="button">
          {option ? 'Yes' : 'No'}
        </button>
      ))}
    </div>
  )
}
