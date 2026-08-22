import { useState } from 'react'
import { useMutation } from 'urql'
import { ADD_USER_MUTATION } from '../../graphql/mutations'
import type { Role } from '../../types/graphql'
import { Button } from '../common/Button'
import { TextField } from '../common/FormControls'
import { RoleSelect } from './RoleControls'

// Invite form for the access table: email + role, submits the addUser
// mutation and reports success to the parent.
export function InviteUserForm({ onAdded, onCancel }: { onAdded: () => void; onCancel: () => void }) {
  const [, addUser] = useMutation(ADD_USER_MUTATION)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('WRITER')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAdd() {
    if (!email.trim()) return
    setAdding(true)
    setError(null)
    const result = await addUser({ input: { email: email.trim(), role } })
    setAdding(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    onAdded()
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3">
        <TextField id="invite-email" label="Email address" onChange={setEmail} placeholder="user@example.com" type="email" value={email} />
        <div className="flex items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-500" htmlFor="invite-role">
              Role
            </label>
            <RoleSelect
              id="invite-role"
              onChange={setRole}
              value={role}
            />
          </div>
          <Button disabled={!email.trim() || adding} onClick={() => void handleAdd()} type="button">
            {adding ? 'Sending invite...' : 'Invite'}
          </Button>
          <Button onClick={onCancel} type="button" variant="secondary">
            Cancel
          </Button>
        </div>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  )
}
