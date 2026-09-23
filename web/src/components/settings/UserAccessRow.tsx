import { useEffect, useRef, useState } from 'react'
import { useMutation } from 'urql'
import { REMOVE_USER_MUTATION, UPDATE_USER_MUTATION } from '../../graphql/mutations'
import type { Role, User } from '../../types/graphql'
import { Button } from '../common/Button'
import { DataGridRow, dataGridTextCell } from '../common/DataGrid'
import { RoleBadge, RoleSelect } from './RoleControls'

export const USER_GRID_COLUMNS = 'minmax(200px,2fr) 110px 120px auto'

// One row of the access table. Owns its own role-editing lifecycle: click the
// badge to edit, save on select, flash a checkmark on success, show the error
// inline on failure.
export function UserAccessRow({
  user,
  canCreateInviteLinks,
  canManageUsers,
  inviteLinkLoading,
  onChanged,
  onInviteLink,
}: {
  user: User
  canCreateInviteLinks: boolean
  canManageUsers: boolean
  inviteLinkLoading: boolean
  onChanged: () => void
  onInviteLink: () => void
}) {
  const [, updateUser] = useMutation(UPDATE_USER_MUTATION)
  const [, removeUser] = useMutation(REMOVE_USER_MUTATION)
  const [editing, setEditing] = useState(false)
  const [pendingRole, setPendingRole] = useState<Role | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [flashed, setFlashed] = useState(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current)
    }
  }, [])

  const isUpdating = pendingRole !== null
  const currentRole = pendingRole ?? user.role

  async function handleRoleChange(newRole: Role) {
    setPendingRole(newRole)
    setUpdateError(null)

    const result = await updateUser({ input: { id: user.id, role: newRole } })
    setPendingRole(null)
    if (result.error) {
      setUpdateError(result.error.message ?? 'Failed to update role')
      return
    }

    setEditing(false)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    setFlashed(true)
    flashTimer.current = setTimeout(() => setFlashed(false), 2000)
    onChanged()
  }

  async function handleRemove() {
    await removeUser({ input: { id: user.id } })
    onChanged()
  }

  return (
    <DataGridRow gridTemplateColumns={USER_GRID_COLUMNS}>
      <span className={dataGridTextCell}>{user.email}</span>
      <span className="flex min-w-0 items-center gap-2">
        {editing ? (
          <RoleSelect
            disabled={isUpdating}
            onBlur={() => setEditing(false)}
            onChange={handleRoleChange}
            value={currentRole}
          />
        ) : (
          canManageUsers ? (
            <button className="cursor-pointer" onClick={() => setEditing(true)} type="button">
              <RoleBadge role={currentRole} />
            </button>
          ) : (
            <RoleBadge role={user.role} />
          )
        )}
        {isUpdating ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-border-strong border-t-brand-600" />
        ) : flashed ? (
          <span className="text-sm text-positive">✓</span>
        ) : null}
        {updateError ? <span className="truncate text-xs text-negative" title={updateError}>{updateError}</span> : null}
      </span>
      <span className="text-[13px] text-text-3">{formatDate(user.createdAt)}</span>
      <span className="flex justify-end gap-2">
        {canCreateInviteLinks ? (
          <Button disabled={inviteLinkLoading} onClick={onInviteLink} size="sm" variant="secondary">
            {inviteLinkLoading ? 'Generating...' : 'Invite link'}
          </Button>
        ) : null}
        {canManageUsers ? (
          <Button onClick={() => void handleRemove()} size="sm" variant="danger">Remove</Button>
        ) : null}
      </span>
    </DataGridRow>
  )
}

function formatDate(dateStr: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(dateStr))
}
