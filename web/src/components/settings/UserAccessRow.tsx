import { useEffect, useRef, useState } from 'react'
import { useMutation } from 'urql'
import { REMOVE_USER_MUTATION, UPDATE_USER_MUTATION } from '../../graphql/mutations'
import type { Role, User } from '../../types/graphql'
import { RoleBadge, RoleSelect } from './RoleControls'

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
    <tr className="border-b border-neutral-100 last:border-0">
      <td className="px-4 py-3">{user.email}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {editing ? (
            <RoleSelect
              disabled={isUpdating}
              onBlur={() => setEditing(false)}
              onChange={handleRoleChange}
              value={currentRole}
            />
          ) : (
            canManageUsers ? (
              <button
                className="cursor-pointer"
                onClick={() => setEditing(true)}
                type="button"
              >
                <RoleBadge role={currentRole} />
              </button>
            ) : (
              <RoleBadge role={user.role} />
            )
          )}
          {isUpdating ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-brand-600" />
          ) : flashed ? (
            <span className="text-sm text-green-600 transition-opacity">✓</span>
          ) : null}
        </div>
        {updateError ? <p className="mt-1 text-xs text-red-600">{updateError}</p> : null}
      </td>
      <td className="px-4 py-3 text-neutral-500">{formatDate(user.createdAt)}</td>
      <td className="px-4 py-3 text-right">
        {canManageUsers || canCreateInviteLinks ? (
          <div className="flex justify-end gap-2">
            {canCreateInviteLinks ? (
              <button
                className="rounded-xl border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                disabled={inviteLinkLoading}
                onClick={onInviteLink}
                type="button"
              >
                {inviteLinkLoading ? 'Generating...' : 'Invite link'}
              </button>
            ) : null}
            {canManageUsers ? (
              <button
                className="rounded-xl border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                onClick={() => void handleRemove()}
                type="button"
              >
                Remove
              </button>
            ) : null}
          </div>
        ) : null}
      </td>
    </tr>
  )
}

function formatDate(dateStr: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(dateStr))
}
