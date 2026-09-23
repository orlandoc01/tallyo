import { useState, type ReactNode } from 'react'
import { useMutation, useQuery } from 'urql'
import { Button } from '../components/common/Button'
import { DataGridHeader } from '../components/common/DataGrid'
import { Card, FormError, TextField } from '../components/common/FormControls'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { InviteUserForm } from '../components/settings/InviteUserForm'
import { ListCardHeader } from '../components/settings/ListCardHeader'
import { USER_GRID_COLUMNS, UserAccessRow } from '../components/settings/UserAccessRow'
import { CREATE_INVITE_LINK_MUTATION } from '../graphql/mutations'
import { USERS_QUERY } from '../graphql/queries'
import { usePermissions } from '../hooks/usePermissions'
import type { CreateInviteLinkPayload, User } from '../types/graphql'

export function AccessPage({ headerActions }: { headerActions?: ReactNode }) {
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
    <div className="space-y-3">
      <Card as="section">
        <ListCardHeader
          actions={<>{canManageUsers && !showForm ? <Button onClick={() => setShowForm(true)} size="sm" variant="secondary">+ Add user</Button> : null}{headerActions}</>}
          title="Users"
        />
        {canManageUsers && showForm ? (
          <div className="border-t border-border px-4 py-3">
            <InviteUserForm
              onAdded={() => {
                setShowForm(false)
                refreshUsers()
              }}
              onCancel={() => setShowForm(false)}
            />
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="border-t border-border pt-1.5">
              <DataGridHeader gridTemplateColumns={USER_GRID_COLUMNS}>
                <span>Email</span>
                <span>Role</span>
                <span>Added</span>
                <span />
              </DataGridHeader>
            </div>
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
          </div>
        </div>
      </Card>
      {inviteLinkError ? <FormError className="font-semibold">{inviteLinkError}</FormError> : null}
      {inviteLink ? (
        <div className="rounded-lg border border-warning/35 bg-warning/10 p-4 text-[13px] text-text-1">
          <p className="font-semibold">One-time invite link</p>
          <p className="mt-1 text-text-2">Expires {formatDateTime(inviteLink.expiresAt)}. The invitee stays signed in on that browser to finish passkey setup; generate a new link if they switch devices later.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <TextField className="min-w-0 flex-1" hideLabel label="Invite link" mono onChange={() => undefined} readOnly value={inviteLink.url} />
            <Button onClick={() => void navigator.clipboard?.writeText(inviteLink.url)}>Copy</Button>
            <Button onClick={() => setInviteLink(null)} variant="secondary">Close</Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function formatDateTime(dateStr: string) {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(dateStr))
}
