import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation } from 'urql'
import { CREATE_OWNER_MUTATION, DELETE_OWNER_MUTATION } from '../../graphql/mutations'
import { useOwners } from '../../hooks/useEntityQueries'
import type { Owner } from '../../types/graphql'
import { Button } from '../../components/common/Button'
import { OwnerDot } from '../../components/common/OwnerDot'
import { setupInputClass } from './setupClasses'
import { SetupActions, SetupHeading, SetupListCard, SetupMessage } from './SetupLayout'

export function OwnersStep() {
  const navigate = useNavigate()
  const { owners, fetching, error, refetch } = useOwners()
  const [name, setName] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [createResult, createOwner] = useMutation<{ createOwner: Owner }, { input: { name: string } }>(CREATE_OWNER_MUTATION)
  const [deleteResult, deleteOwner] = useMutation<{ deleteOwner: boolean }, { id: string }>(DELETE_OWNER_MUTATION)

  async function addOwner() {
    const trimmed = name.trim()
    if (!trimmed) return
    setMessage(null)
    const result = await createOwner({ input: { name: trimmed } })
    if (!result.error) {
      setName('')
      refetch({ requestPolicy: 'network-only' })
    }
  }

  async function removeOwner(owner: Owner) {
    await deleteOwner({ id: owner.id })
    refetch({ requestPolicy: 'network-only' })
  }

  function continueSetup() {
    if (owners.length === 0) {
      setMessage('Add at least one household owner before continuing.')
      return
    }
    navigate('/setup/connections')
  }

  return (
    <div>
      <SetupHeading subtitle="Owners let Tallyo separate household members across linked accounts, assets, and reports." title="Household owners" />

      <div className="mt-4 flex max-w-[480px] gap-2">
        <input aria-label="Owner name" className={setupInputClass} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addOwner() } }} placeholder="Owner name" value={name} />
        <Button className="shrink-0 whitespace-nowrap" disabled={createResult.fetching || !name.trim()} onClick={addOwner}>{createResult.fetching ? 'Adding...' : '+ Add'}</Button>
      </div>

      {fetching && owners.length === 0 ? null : (
        <SetupListCard className="mt-3 max-w-[480px]">
          {owners.length === 0 ? <p className="p-4 text-center text-xs text-text-faint">No owners yet</p> : null}
          {owners.map((owner) => (
            <div className="flex h-11 items-center gap-2.5 pl-4 pr-3 transition hover:bg-raised" key={owner.id}>
              <OwnerDot name={owner.name} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-1">{owner.name}</span>
              <Button aria-label={`Delete ${owner.name}`} onClick={() => void removeOwner(owner)} size="sm" variant="danger">Remove</Button>
            </div>
          ))}
        </SetupListCard>
      )}

      {fetching ? <SetupMessage tone="muted">Loading owners...</SetupMessage> : null}
      {error ? <SetupMessage tone="negative">Failed to load owners.</SetupMessage> : null}
      {createResult.error ? <SetupMessage tone="negative">{createResult.error.message}</SetupMessage> : null}
      {deleteResult.error ? <SetupMessage tone="negative">{deleteResult.error.message}</SetupMessage> : null}
      {message ? <SetupMessage tone="warning">{message}</SetupMessage> : null}

      <SetupActions>
        <Button onClick={() => navigate(-1)} variant="secondary">Back</Button>
        <Button onClick={continueSetup}>Continue</Button>
      </SetupActions>
    </div>
  )
}
