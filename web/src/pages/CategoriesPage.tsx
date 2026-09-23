import { useMemo, useState } from 'react'
import { Button } from '../components/common/Button'
import { QueryGate } from '../components/common/QueryGate'
import { CategoryGroupCard } from '../components/categories/CategoryGroupCard'
import { CategoryModal } from '../components/categories/CategoryModal'
import { GroupModal } from '../components/categories/GroupModal'
import { SettingsTitleRow } from '../components/settings/SettingsTitleRow'
import { useMobileHeaderActions } from '../components/layout/useMobileHeader'
import { useCategoryGroups } from '../hooks/useEntityQueries'
import { usePermissions } from '../hooks/usePermissions'
import type { Category, CategoryGroup } from '../types/graphql'

type ModalState =
  | { kind: 'category'; category: Category | null; groupId: string }
  | { kind: 'group'; group: CategoryGroup | null }

export function CategoriesPage() {
  const { categoryGroups: groups, data, fetching, error, refetch } = useCategoryGroups()
  const { canWrite } = usePermissions()
  const canWriteCategories = canWrite('categories')
  const [modal, setModal] = useState<ModalState | null>(null)

  const mobileHeaderActions = useMemo(() => (
    canWriteCategories ? <Button aria-label="New group" onClick={() => setModal({ kind: 'group', group: null })}>+ Group</Button> : null
  ), [canWriteCategories])
  useMobileHeaderActions(mobileHeaderActions)

  function closeModal() {
    setModal(null)
  }

  return (
    <>
      <SettingsTitleRow action={canWriteCategories ? <Button onClick={() => setModal({ kind: 'group', group: null })}>+ New Group</Button> : null} title="Categories" />
      <QueryGate
        data={data}
        empty={groups.length === 0}
        emptyDescription="Create a group to start organizing categories."
        emptyTitle="No categories yet"
        error={error}
        errorPrefix="Failed to load categories"
        fetching={fetching}
        loadingLabel="Loading categories"
        onRetry={() => refetch({ requestPolicy: 'network-only' })}
      >
        <div className="flex flex-col gap-3">
          {groups.map((group) => (
            <CategoryGroupCard
              canWrite={canWriteCategories}
              group={group}
              key={group.id}
              onAddCategory={() => setModal({ kind: 'category', category: null, groupId: group.id })}
              onEditCategory={(cat) => setModal({ kind: 'category', category: cat, groupId: group.id })}
              onEditGroup={() => setModal({ kind: 'group', group })}
            />
          ))}
        </div>
      </QueryGate>

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
    </>
  )
}
