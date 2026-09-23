import clsx from 'clsx'
import { GripVertical, Pencil, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { useMutation } from 'urql'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { DELETE_CATEGORY_GROUP_MUTATION, REORDER_CATEGORIES_MUTATION } from '../../graphql/mutations'
import type { Category, CategoryGroup } from '../../types/graphql'
import { ActionMenuItem } from '../common/ActionMenuItem'
import { IconButton } from '../common/Button'
import { ClickableRow } from '../common/ClickableRow'
import { Card } from '../common/FormControls'
import { RowActionsMenu } from '../common/RowActionsMenu'
import { Tag } from '../common/Tag'
import { CATEGORY_KIND_TINT } from './categoryKindTint'

export function CategoryGroupCard({ group, canWrite, onEditGroup, onAddCategory, onEditCategory }: {
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
  const [collapsed, setCollapsed] = useState(false)
  const bodyId = useId()

  const [, deleteGroup] = useMutation(DELETE_CATEGORY_GROUP_MUTATION)
  const [, reorderCategories] = useMutation(REORDER_CATEGORIES_MUTATION)
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

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
    const oldIndex = orderedCategoryIds.indexOf(String(active.id))
    const newIndex = orderedCategoryIds.indexOf(String(over.id))
    if (oldIndex === -1 || newIndex === -1) return

    const newOrder = arrayMove(orderedCategoryIds, oldIndex, newIndex)
    setLocalCategoryIds(newOrder)
    setReorderError(null)
    const result = await reorderCategories({ input: { groupId: group.id, categoryIds: newOrder } })
    if (result.error) {
      setLocalCategoryIds(serverCategoryIds)
      setReorderError(result.error.message)
    }
  }

  async function handleDeleteGroup() {
    setDeleteError(null)
    const result = await deleteGroup({ id: group.id })
    if (result.error) setDeleteError(result.error.message)
  }

  const canDelete = group.categories.length === 0
  const deleteTitle = canDelete ? undefined : 'Delete all categories first'
  const count = group.categories.length

  return (
    <Card as="section" overflow="visible">
      <div className="flex h-[52px] items-center gap-2 pl-4 pr-3 lg:h-12">
        <ClickableRow ariaControls={bodyId} className="flex h-full min-w-0 flex-1 items-center gap-2 text-left" expanded={!collapsed} onClick={() => setCollapsed((current) => !current)}>
          <span aria-hidden className={clsx('inline-block w-3 text-[10px] text-text-muted transition-transform duration-150', !collapsed && 'rotate-90')}>▶</span>
          <span aria-hidden className="text-base leading-none">{group.emoji}</span>
          <span className="truncate text-sm font-semibold text-text-1">{group.name}</span>
          <Tag size="badge" tint={CATEGORY_KIND_TINT[group.kind]}>{group.kind}</Tag>
          <span className="ml-auto hidden shrink-0 pl-2 text-xs text-text-muted lg:inline">{count} {count === 1 ? 'category' : 'categories'}</span>
        </ClickableRow>
        {canWrite ? (
          <>
            <div className="hidden items-center gap-1 lg:flex">
              <IconButton ariaLabel={`Edit ${group.name} group`} onClick={onEditGroup} size="xs"><Pencil className="h-3.5 w-3.5" /></IconButton>
              <IconButton ariaLabel={`Delete ${group.name} group`} className="text-text-muted" disabled={!canDelete} onClick={handleDeleteGroup} size="xs" title={deleteTitle}><Trash2 className="h-3.5 w-3.5" /></IconButton>
            </div>
            <GroupActionsMenu canDelete={canDelete} deleteTitle={deleteTitle} groupName={group.name} onDelete={handleDeleteGroup} onRename={onEditGroup} />
          </>
        ) : null}
      </div>

      {deleteError ? <p className="border-t border-border px-4 py-2 text-[13px] text-negative">{deleteError}</p> : null}
      {collapsed ? null : (
      <div className="overflow-hidden rounded-b-lg" id={bodyId}>
        {reorderError ? <p className="border-t border-border px-4 py-2 text-[13px] text-negative">{reorderError}</p> : null}

        <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd} sensors={sensors}>
          <SortableContext items={localOrder.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            <ul>
              {localOrder.map((cat) => (
                <SortableCategoryRow canWrite={canWrite} category={cat} key={cat.id} onEdit={() => onEditCategory(cat)} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>

        {canWrite ? (
          <div className="border-t border-border">
            <button className="flex h-11 w-full items-center px-5 text-left text-[13px] font-medium text-accent hover:text-accent-hover lg:h-10" onClick={onAddCategory} type="button">
              + Add category
            </button>
          </div>
        ) : null}
      </div>
      )}
    </Card>
  )
}

function GroupActionsMenu({ canDelete, deleteTitle, groupName, onDelete, onRename }: {
  canDelete: boolean
  deleteTitle?: string
  groupName: string
  onDelete: () => void
  onRename: () => void
}) {
  const [open, setOpen] = useState(false)
  const toggle = () => setOpen((current) => !current)

  return (
    <div className="lg:hidden">
      <RowActionsMenu ariaLabel={`${groupName} group actions`} isOpen={open} onToggle={toggle}>
        <ActionMenuItem onClick={() => { setOpen(false); onRename() }}>Rename</ActionMenuItem>
        <ActionMenuItem className="disabled:cursor-not-allowed disabled:opacity-40" destructive disabled={!canDelete} onClick={() => { setOpen(false); onDelete() }} title={deleteTitle}>Delete</ActionMenuItem>
      </RowActionsMenu>
    </div>
  )
}

function SortableCategoryRow({ category, canWrite, onEdit }: { category: Category; canWrite: boolean; onEdit: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: category.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  return (
    <li className="flex h-11 items-center gap-3 border-t border-border pl-5 pr-4 text-sm text-text-2 lg:h-10" ref={setNodeRef} style={style}>
      {canWrite ? (
        <button {...attributes} {...listeners} aria-label="Drag to reorder" className="cursor-grab text-handle hover:text-text-muted active:cursor-grabbing" type="button">
          <GripVertical className="h-4 w-4" />
        </button>
      ) : null}
      <span aria-hidden className="w-5 text-center text-base leading-none">{category.emoji}</span>
      <button className="min-w-0 flex-1 truncate text-left hover:text-text-1" onClick={onEdit} type="button">
        {category.name}
      </button>
    </li>
  )
}
