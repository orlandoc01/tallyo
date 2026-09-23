import { useMemo, useState } from 'react'
import { useMutation } from 'urql'
import { DELETE_TAG_MUTATION } from '../../graphql/mutations'
import { useTags } from '../../hooks/useEntityQueries'
import { usePermissions } from '../../hooks/usePermissions'
import type { Tag } from '../../types/graphql'
import { Button } from '../common/Button'
import { DataGridHeader, DataGridRow, dataGridTextCell } from '../common/DataGrid'
import { Card } from '../common/FormControls'
import { QueryGate } from '../common/QueryGate'
import { useMobileHeaderActions } from '../layout/useMobileHeader'
import { CreateTagModal } from '../transactions/CreateTagModal'
import { SettingsTitleRow } from './SettingsTitleRow'

const TAG_GRID_COLUMNS = 'minmax(0,1fr) 140px 128px'

export function TagsTab() {
  const { tags, data, fetching, error, refetch } = useTags()
  const { canWrite } = usePermissions()
  const canWriteTags = canWrite('tags')
  const [, deleteTag] = useMutation(DELETE_TAG_MUTATION)
  const [editing, setEditing] = useState<Tag | null>(null)
  const [creating, setCreating] = useState(false)

  const mobileHeaderActions = useMemo(() => (
    canWriteTags ? <Button aria-label="New tag" onClick={() => setCreating(true)}>+ New</Button> : null
  ), [canWriteTags])
  useMobileHeaderActions(mobileHeaderActions)

  async function remove(tag: Tag) {
    if (!canWriteTags) return
    if (!window.confirm(`Delete tag ${tag.name}?`)) return
    await deleteTag({ id: tag.id })
    refetch({ requestPolicy: 'network-only' })
  }

  return (
    <>
      <SettingsTitleRow action={canWriteTags ? <Button onClick={() => setCreating(true)}>New tag</Button> : null} title="Tags" />
      <QueryGate data={data} empty={tags.length === 0} emptyDescription="Create a tag to label transactions." emptyTitle="No tags yet" error={error} fetching={fetching} onRetry={() => refetch({ requestPolicy: 'network-only' })}>
        <Card as="section">
          <div className="pt-2.5">
            <DataGridHeader gridTemplateColumns={TAG_GRID_COLUMNS}>
              <span>Tag</span>
              <span>Usage</span>
              <span />
            </DataGridHeader>
          </div>
          {tags.map((tag) => (
            <DataGridRow gridTemplateColumns={TAG_GRID_COLUMNS} key={tag.id}>
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                <span className={`${dataGridTextCell} font-medium text-text-1`}>{tag.name}</span>
              </span>
              <span className="text-[13px] text-text-muted">{tag.transactionCount ?? 0} transactions</span>
              {canWriteTags ? (
                <span className="flex justify-end gap-2">
                  <Button onClick={() => setEditing(tag)} size="sm" variant="secondary">Edit</Button>
                  <Button onClick={() => remove(tag)} size="sm" variant="danger">Delete</Button>
                </span>
              ) : <span />}
            </DataGridRow>
          ))}
        </Card>
      </QueryGate>
      {creating && canWriteTags ? <CreateTagModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refetch({ requestPolicy: 'network-only' }) }} /> : null}
      {editing && canWriteTags ? <CreateTagModal tag={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refetch({ requestPolicy: 'network-only' }) }} /> : null}
    </>
  )
}
