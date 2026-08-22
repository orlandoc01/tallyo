import { useState } from 'react'
import { useMutation } from 'urql'
import { DELETE_TAG_MUTATION } from '../../graphql/mutations'
import { useTags } from '../../hooks/useEntityQueries'
import { usePermissions } from '../../hooks/usePermissions'
import type { Tag } from '../../types/graphql'
import { Button } from '../common/Button'
import { Card, FormError } from '../common/FormControls'
import { CreateTagModal } from '../transactions/CreateTagModal'

export function TagsTab() {
  const { tags, fetching, error, refetch } = useTags()
  const { canWrite } = usePermissions()
  const canWriteTags = canWrite('tags')
  const [, deleteTag] = useMutation(DELETE_TAG_MUTATION)
  const [editing, setEditing] = useState<Tag | null>(null)
  const [creating, setCreating] = useState(false)

  async function remove(tag: Tag) {
    if (!canWriteTags) return
    if (!window.confirm(`Delete tag ${tag.name}?`)) return
    await deleteTag({ id: tag.id })
    refetch({ requestPolicy: 'network-only' })
  }

  return (
    <>
      {canWriteTags ? (
        <div className="mb-3 flex justify-end">
          <Button onClick={() => setCreating(true)} type="button">New tag</Button>
        </div>
      ) : null}
      <Card as="section" padded>
        {fetching ? <div className="text-sm text-neutral-500">Loading tags...</div> : null}
        {error ? <FormError>{error.message}</FormError> : null}
        <div className="divide-y divide-neutral-100">
          {tags.map((tag) => (
            <div key={tag.id} className="flex items-center justify-between gap-3 py-3">
              <div className="flex items-center gap-3">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: tag.color }} />
                <div>
                  <div className="font-semibold">{tag.name}</div>
                  <div className="text-xs text-neutral-500">{tag.transactionCount ?? 0} transactions</div>
                </div>
              </div>
              {canWriteTags ? (
                <div className="flex gap-2">
                  <Button onClick={() => setEditing(tag)} size="sm" type="button" variant="secondary">Edit</Button>
                  <Button onClick={() => remove(tag)} size="sm" type="button" variant="danger">Delete</Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Card>
      {creating && canWriteTags ? <CreateTagModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refetch({ requestPolicy: 'network-only' }) }} /> : null}
      {editing && canWriteTags ? <CreateTagModal tag={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refetch({ requestPolicy: 'network-only' }) }} /> : null}
    </>
  )
}
