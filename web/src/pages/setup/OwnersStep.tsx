import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Trash2 } from 'lucide-react'
import { useMutation } from 'urql'
import { CREATE_OWNER_MUTATION, DELETE_OWNER_MUTATION } from '../../graphql/mutations'
import { useOwners } from '../../hooks/useEntityQueries'
import type { Owner } from '../../types/graphql'
import { SetupActions, SetupHeading, inputClass, primaryButtonClass, secondaryButtonClass } from './SetupLayout'

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
      <SetupHeading eyebrow="Household owners" title="Who owns the accounts?" />
      <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600">Owners let Tallyo separate household members across linked accounts, assets, and reports.</p>

      <div className="mt-8 max-w-2xl space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className={inputClass} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addOwner() } }} placeholder="Owner name" value={name} />
          <button className={primaryButtonClass} disabled={createResult.fetching || !name.trim()} onClick={addOwner} type="button">{createResult.fetching ? 'Adding...' : 'Add'}</button>
        </div>
        {fetching ? <p className="text-sm text-neutral-500">Loading owners...</p> : null}
        {error ? <p className="text-sm font-semibold text-red-700">Failed to load owners.</p> : null}
        {createResult.error ? <p className="text-sm font-semibold text-red-700">{createResult.error.message}</p> : null}
        {deleteResult.error ? <p className="text-sm font-semibold text-red-700">{deleteResult.error.message}</p> : null}
        {message ? <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">{message}</p> : null}

        <ul className="space-y-2">
          {owners.map((owner) => (
            <li className="flex items-center justify-between rounded-2xl border border-brand-100 bg-white px-4 py-3" key={owner.id}>
              <span className="font-bold text-neutral-900">{owner.name}</span>
              <button aria-label={`Delete ${owner.name}`} className="rounded-xl p-2 text-neutral-400 hover:bg-red-50 hover:text-red-600" onClick={() => void removeOwner(owner)} type="button"><Trash2 className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      </div>

      <SetupActions>
        <button className={secondaryButtonClass} onClick={() => navigate(-1)} type="button">Back</button>
        <button className={primaryButtonClass} onClick={continueSetup} type="button">Continue</button>
      </SetupActions>
    </div>
  )
}
