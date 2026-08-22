import clsx from 'clsx'
import { GripVertical } from 'lucide-react'
import { useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ALL_NAV_ITEMS, MAX_NAVBAR_ITEMS, type NavItemDef, type NavItemId } from '../../hooks/navItems'
import { useNavLayout } from '../../hooks/useNavLayout'
import { usePermissions } from '../../hooks/usePermissions'

const NAVBAR = 'navbar' as const
const SIDEMENU = 'sidemenu' as const

const navItemMap = new Map<NavItemId, NavItemDef>(ALL_NAV_ITEMS.map((i) => [i.id, i]))

type Container = typeof NAVBAR | typeof SIDEMENU
type Items = Record<Container, NavItemId[]>

function findContainer(items: Items, id: string): Container {
  if (id === NAVBAR || id === SIDEMENU) return id
  if (items.navbar.includes(id as NavItemId)) return NAVBAR
  return SIDEMENU
}

function NavItemRow({ item, overlay }: { item: NavItemDef; overlay?: boolean }) {
  const Icon = item.icon
  return (
    <div
      className={clsx(
        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium',
        overlay && 'rounded-xl bg-white shadow-xl ring-1 ring-neutral-200',
      )}
    >
      <GripVertical className="h-4 w-4 shrink-0 text-neutral-300" />
      <Icon className="h-5 w-5 shrink-0 text-neutral-500" />
      {item.label}
    </div>
  )
}

function SortableNavItem({ id }: { id: NavItemId }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  })
  const item = navItemMap.get(id)!

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <NavItemRow item={item} />
    </div>
  )
}

function DroppableList({
  containerId,
  items,
  label,
  badge,
  subtitle,
  warning,
}: {
  containerId: Container
  items: NavItemId[]
  label: string
  badge?: string
  subtitle: string
  warning?: string
}) {
  const { setNodeRef } = useDroppable({ id: containerId })

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-semibold text-neutral-700">{label}</span>
        {badge ? (
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500">
            {badge}
          </span>
        ) : null}
      </div>
      <p className="mb-2 text-xs text-neutral-400">{subtitle}</p>
      <div
        ref={setNodeRef}
        className="min-h-[120px] space-y-1.5 rounded-xl border-2 border-dashed border-neutral-200 bg-neutral-50 p-3"
      >
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          {items.map((id) => (
            <SortableNavItem key={id} id={id} />
          ))}
        </SortableContext>
        {items.length === 0 ? (
          <p className="py-2 text-center text-xs text-neutral-400">Drop items here</p>
        ) : null}
      </div>
      {warning ? (
        <p className="mt-1 text-xs text-amber-600">{warning}</p>
      ) : null}
    </div>
  )
}

export function LayoutSection() {
  const { layout, updateLayout } = useNavLayout()
  const { canRead, canWrite } = usePermissions()

  const [[navbarItems, sidemenuItems], setItemArrays] = useState<[NavItemId[], NavItemId[]]>([
    [...layout.navbar],
    [...layout.sidemenu],
  ])

  const latestItems = useRef<Items>({ navbar: navbarItems, sidemenu: sidemenuItems })
  latestItems.current = { navbar: navbarItems, sidemenu: sidemenuItems }

  function setItems(updater: (prev: Items) => Items) {
    setItemArrays((prev) => {
      const next = updater({ navbar: prev[0], sidemenu: prev[1] })
      return [next.navbar, next.sidemenu]
    })
  }

  const [activeId, setActiveId] = useState<NavItemId | null>(null)
  const originalContainerRef = useRef<Container | null>(null)
  const wasCrossContainerRef = useRef(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  )

  function isItemVisible(id: NavItemId): boolean {
    const def = navItemMap.get(id)!
    if (def.requiresRead && !canRead(def.requiresRead)) return false
    if (def.requiresWrite && !canWrite(def.requiresWrite)) return false
    return true
  }

  function visibleFilter(ids: NavItemId[]): NavItemId[] {
    return ids.filter(isItemVisible)
  }

  function handleDragStart(event: DragStartEvent) {
    const id = event.active.id as NavItemId
    setActiveId(id)
    originalContainerRef.current = findContainer(latestItems.current, id)
    wasCrossContainerRef.current = false
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over) return

    const activeId = active.id as NavItemId
    const overId = over.id as string

    if (activeId === overId) return

    const items = latestItems.current
    const activeContainer = findContainer(items, activeId)
    const overContainer = findContainer(items, overId)

    if (activeContainer === overContainer) return

    if (overContainer === NAVBAR && items.navbar.length >= MAX_NAVBAR_ITEMS) return

    wasCrossContainerRef.current = true

    setItems((prev) => {
      const sourceItems = [...prev[activeContainer]]
      const destItems = [...prev[overContainer]]
      const activeIndex = sourceItems.indexOf(activeId)
      if (activeIndex === -1) return prev

      sourceItems.splice(activeIndex, 1)

      let overIndex: number
      const overIsItem = overId !== NAVBAR && overId !== SIDEMENU
      if (overIsItem) {
        const idx = destItems.indexOf(overId as NavItemId)
        overIndex = idx !== -1 ? idx : destItems.length
      } else {
        overIndex = destItems.length
      }

      destItems.splice(overIndex, 0, activeId)

      return { ...prev, [activeContainer]: sourceItems, [overContainer]: destItems }
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveId(null)

    if (!over) return

    const activeItemId = active.id as NavItemId
    const overId = over.id as string

    if (!wasCrossContainerRef.current) {
      const container = originalContainerRef.current
      if (!container) return

      const containerItems = latestItems.current[container]
      const oldIndex = containerItems.indexOf(activeItemId)

      let newIndex: number
      if (overId === NAVBAR || overId === SIDEMENU) {
        newIndex = containerItems.length - 1
      } else {
        newIndex = containerItems.indexOf(overId as NavItemId)
      }

      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return

      const finalItems: Items = { ...latestItems.current }
      finalItems[container] = arrayMove(containerItems, oldIndex, newIndex)
      setItems(() => finalItems)
      latestItems.current = finalItems
      updateLayout({ navbar: finalItems.navbar, sidemenu: finalItems.sidemenu })
    } else {
      updateLayout({
        navbar: latestItems.current.navbar,
        sidemenu: latestItems.current.sidemenu,
      })
    }
  }

  const activeItem = activeId ? navItemMap.get(activeId) ?? null : null

  // Compute visible items for render only; state stores all 9
  const visibleNavbar = visibleFilter(navbarItems)
  const visibleSidemenu = visibleFilter(sidemenuItems)

  return (
    <DndContext
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragStart={handleDragStart}
      sensors={sensors}
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <DroppableList
          badge={`${navbarItems.length}/${MAX_NAVBAR_ITEMS}`}
          containerId={NAVBAR}
          items={navbarItems}
          label="Nav Bar"
          subtitle="Appears in the bottom navigation"
          warning={
            navbarItems.length >= MAX_NAVBAR_ITEMS
              ? `Maximum ${MAX_NAVBAR_ITEMS} items allowed in the nav bar`
              : undefined
          }
        />
        <DroppableList
          containerId={SIDEMENU}
          items={sidemenuItems}
          label="Side Menu"
          subtitle="Appears in the hamburger menu"
        />
      </div>

      {/* Preview strip showing what the user actually sees */}
      {visibleNavbar.length < navbarItems.length || visibleSidemenu.length < sidemenuItems.length ? (
        <p className="mt-3 text-xs text-neutral-400">
          Some items are hidden based on your permissions.
        </p>
      ) : null}

      <DragOverlay>
        {activeItem ? <NavItemRow item={activeItem} overlay /> : null}
      </DragOverlay>
    </DndContext>
  )
}
