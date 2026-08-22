import { useState } from 'react'
import { useMutation, useQuery } from 'urql'
import { Card, FormError } from '../components/common/FormControls'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { InviteUserForm } from '../components/settings/InviteUserForm'
import { UserAccessRow } from '../components/settings/UserAccessRow'
import { CREATE_INVITE_LINK_MUTATION } from '../graphql/mutations'
import { USERS_QUERY } from '../graphql/queries'
import { usePermissions } from '../hooks/usePermissions'
import type { CreateInviteLinkPayload, User } from '../types/graphql'

export function AccessPage() {
  const [{ data, fetching }, reexecuteQuery] = useQuery<{ users: { items: User[] } }>({ query: USERS_QUERY })
  const [, createInviteLink] = useMutation<{ createInviteLink: CreateInviteLinkPayload }, { input: { userId: string } }>(CREATE_INVITE_LINK_MUTATION)
  const { canWrite } = usePermissions()
  const [showForm, setShowForm] = useState(false)
  const [inviteLink, setInviteLink] = useState<{ userId: string; url: string; expiresAt: string } | null>(null)
  const [inviteLinkError, setInviteLinkError] = useState<string | null>(null)
  const [inviteLinkLoading, setInviteLinkLoading] = useState<string | null>(null)

  const users = data?.users.items ?? []
  const canManageUsers = canWrite('users')
  const canCreateInviteLinks = canWrite('settings')

  function refreshUsers() {
    reexecuteQuery({ requestPolicy: 'network-only' })
  }

  async function handleInviteLink(userId: string) {
    setInviteLinkLoading(userId)
    setInviteLinkError(null)
    const result = await createInviteLink({ input: { userId } })
    setInviteLinkLoading(null)
    if (result.error || !result.data) {
      setInviteLinkError(result.error?.message ?? 'Failed to generate invite link')
      return
    }
    setInviteLink({ userId, url: result.data.createInviteLink.url, expiresAt: result.data.createInviteLink.expiresAt })
  }

  if (fetching) return <LoadingSpinner />

  return (
    <div className="space-y-4">
        <Card>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-neutral-500">
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Added</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <UserAccessRow
                  key={user.id}
                  canCreateInviteLinks={canCreateInviteLinks}
                  canManageUsers={canManageUsers}
                  inviteLinkLoading={inviteLinkLoading === user.id}
                  user={user}
                  onChanged={refreshUsers}
                  onInviteLink={() => void handleInviteLink(user.id)}
                />
              ))}
            </tbody>
          </table>
        </Card>
        {inviteLinkError ? <FormError className="font-semibold">{inviteLinkError}</FormError> : null}
        {inviteLink ? (
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-bold">One-time invite link</p>
            <p className="mt-1">Expires {formatDateTime(inviteLink.expiresAt)}. The invitee stays signed in on that browser to finish passkey setup; generate a new link if they switch devices later.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input className="min-w-0 flex-1 rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs" readOnly value={inviteLink.url} />
              <button className="rounded-xl bg-amber-700 px-4 py-2 text-sm font-semibold text-white" onClick={() => void navigator.clipboard?.writeText(inviteLink.url)} type="button">Copy</button>
              <button className="rounded-xl border border-amber-300 px-4 py-2 text-sm font-semibold" onClick={() => setInviteLink(null)} type="button">Close</button>
            </div>
          </div>
        ) : null}
        {canManageUsers ? (
          showForm ? (
            <InviteUserForm
              onAdded={() => {
                setShowForm(false)
                refreshUsers()
              }}
              onCancel={() => setShowForm(false)}
            />
          ) : (
            <button
              className="rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold shadow-card"
              onClick={() => setShowForm(true)}
              type="button"
            >
              + Add user
            </button>
          )
        ) : null}
    </div>
  )
}

function formatDateTime(dateStr: string) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(dateStr))
}
