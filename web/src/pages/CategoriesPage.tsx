import { useMemo, useState } from 'react'
import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMutation, useQuery } from 'urql'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '../components/common/Button'
import { Card } from '../components/common/FormControls'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { mobileHeaderActionClass } from '../components/common/mobileHeaderActionClass'
import { CategoryModal } from '../components/categories/CategoryModal'
import { GroupModal } from '../components/categories/GroupModal'
import { useMobileHeaderActions } from '../components/layout/useMobileHeader'
import { DELETE_CATEGORY_GROUP_MUTATION, REORDER_CATEGORIES_MUTATION } from '../graphql/mutations'
import { CATEGORY_GROUPS_QUERY } from '../graphql/queries'
import { usePermissions } from '../hooks/usePermissions'
import type { Category, CategoryGroup } from '../types/graphql'

type ModalState =
  | { kind: 'category'; category: Category | null; groupId: string }
  | { kind: 'group'; group: CategoryGroup | null }

const KIND_BADGE: Record<string, string> = {
  EXPENSE: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  INCOME: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300',
  TRANSFER: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
}

export function CategoriesPage() {
  const [{ data, fetching }] = useQuery<{ categoryGroups: { items: CategoryGroup[] } }>({
    query: CATEGORY_GROUPS_QUERY,
  })
  const { canWrite } = usePermissions()
  const canWriteCategories = canWrite('categories')
  const [modal, setModal] = useState<ModalState | null>(null)
  const groups = data?.categoryGroups.items ?? []

  const mobileHeaderActions = useMemo(() => {
    if (!canWriteCategories) return null
    return (
      <button
        aria-label="New group"
        className={mobileHeaderActionClass('rounded-xl px-3 py-1.5 text-lg font-semibold leading-none', modal?.kind === 'group')}
        onClick={() => setModal({ kind: 'group', group: null })}
        type="button"
      >
        +
      </button>
    )
  }, [canWriteCategories, modal?.kind])

  useMobileHeaderActions(mobileHeaderActions)

  function closeModal() {
    setModal(null)
  }

  if (fetching && groups.length === 0) return <LoadingSpinner />

  return (
    <div className="space-y-6">
      {canWriteCategories ? (
        <div className="hidden justify-end lg:flex">
          <Button className="gap-2" onClick={() => setModal({ kind: 'group', group: null })} type="button">
            <Plus className="h-4 w-4" />
            New Group
          </Button>
        </div>
      ) : null}

      {groups.length === 0 ? (
        <p className="text-neutral-500">No categories yet.</p>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <CategoryGroupSection
              canWrite={canWriteCategories}
              group={group}
              key={group.id}
              onAddCategory={() => setModal({ kind: 'category', category: null, groupId: group.id })}
              onEditCategory={(cat) => setModal({ kind: 'category', category: cat, groupId: group.id })}
              onEditGroup={() => setModal({ kind: 'group', group })}
            />
          ))}
        </div>
      )}

      {modal?.kind === 'group' ? (
        <GroupModal group={modal.group} onClose={closeModal} onSaved={closeModal} />
      ) : null}
      {modal?.kind === 'category' ? (
        <CategoryModal
          category={modal.category}
          defaultGroupId={modal.groupId}
          groups={groups}
          onClose={closeModal}
          onDeleted={closeModal}
          onSaved={closeModal}
        />
      ) : null}
    </div>
  )
}

function CategoryGroupSection({
  group,
  canWrite,
  onEditGroup,
  onAddCategory,
  onEditCategory,
}: {
  group: CategoryGroup
  canWrite: boolean
  onEditGroup: () => void
  onAddCategory: () => void
  onEditCategory: (cat: Category) => void
}) {
  const serverCategoryIds = group.categories.map((c) => c.id)
  const serverCategoryIdsKey = serverCategoryIds.join(',')
  const [localCategoryIds, setLocalCategoryIds] = useState<string[]>(serverCategoryIds)
  const [syncedServerCategoryIdsKey, setSyncedServerCategoryIdsKey] = useState(serverCategoryIdsKey)
  const [reorderError, setReorderError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [, deleteGroup] = useMutation(DELETE_CATEGORY_GROUP_MUTATION)
  const [, reorderCategories] = useMutation(REORDER_CATEGORIES_MUTATION)

  const sensors = useSensors(useSensor(PointerSensor))

  let orderedCategoryIds = localCategoryIds
  if (serverCategoryIdsKey !== syncedServerCategoryIdsKey) {
    orderedCategoryIds = serverCategoryIds
    setLocalCategoryIds(serverCategoryIds)
    setSyncedServerCategoryIdsKey(serverCategoryIdsKey)
  }

  const categoriesById = new Map(group.categories.map((category) => [category.id, category]))
  const localOrder = orderedCategoryIds.flatMap((id) => {
    const category = categoriesById.get(id)
    return category ? [category] : []
  })

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const activeId = String(active.id)
    const overId = String(over.id)
    const oldIndex = orderedCategoryIds.indexOf(activeId)
    const newIndex = orderedCategoryIds.indexOf(overId)
    if (oldIndex === -1 || newIndex === -1) return

    const newOrder = arrayMove(orderedCategoryIds, oldIndex, newIndex)
    setLocalCategoryIds(newOrder)
    setReorderError(null)

    const result = await reorderCategories({
      input: { groupId: group.id, categoryIds: newOrder },
    })
    if (result.error) {
      setLocalCategoryIds(serverCategoryIds)
      setReorderError(result.error.message)
    }
  }

  async function handleDeleteGroup() {
    setDeleteError(null)
    const result = await deleteGroup({ id: group.id })
    if (result.error) {
      setDeleteError(result.error.message)
    }
  }

  const canDelete = group.categories.length === 0

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{group.emoji}</span>
          <span className="font-semibold">{group.name}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${KIND_BADGE[group.kind] ?? ''}`}>
            {group.kind}
          </span>
        </div>
        {canWrite ? (
          <div className="flex items-center gap-1">
            <button
              aria-label={`Edit ${group.name} group`}
              className="rounded-xl p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
              onClick={onEditGroup}
              type="button"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              aria-label={`Delete ${group.name} group`}
              className="rounded-xl p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canDelete}
              onClick={handleDeleteGroup}
              title={!canDelete ? 'Delete all categories first' : undefined}
              type="button"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>

      {deleteError ? <p className="px-4 py-2 text-sm text-red-600">{deleteError}</p> : null}
      {reorderError ? <p className="px-4 py-2 text-sm text-red-600">{reorderError}</p> : null}

      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd} sensors={sensors}>
        <SortableContext items={localOrder.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <ul>
            {localOrder.map((cat) => (
              <SortableCategoryRow
                canWrite={canWrite}
                category={cat}
                key={cat.id}
                onEdit={() => onEditCategory(cat)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {canWrite ? (
        <div className="border-t border-neutral-100 px-4 py-2">
          <button
            className="flex items-center gap-1 text-sm text-brand-600 hover:text-brand-800"
            onClick={onAddCategory}
            type="button"
          >
            <Plus className="h-4 w-4" />
            Add category
          </button>
        </div>
      ) : null}
    </Card>
  )
}

function SortableCategoryRow({
  category,
  canWrite,
  onEdit,
}: {
  category: Category
  canWrite: boolean
  onEdit: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <li
      className="flex items-center gap-3 border-b border-neutral-100 px-4 py-2.5 last:border-b-0"
      ref={setNodeRef}
      style={style}
    >
      {canWrite ? (
        <button
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
          className="cursor-grab text-neutral-300 hover:text-neutral-500 active:cursor-grabbing"
          type="button"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      ) : null}
      <span className="text-lg">{category.emoji}</span>
      <button
        className="flex-1 text-left text-sm hover:text-brand-700"
        onClick={onEdit}
        type="button"
      >
        {category.name}
      </button>
    </li>
  )
}
