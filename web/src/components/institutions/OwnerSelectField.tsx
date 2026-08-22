import type { CombinedError } from 'urql'
import type { Owner } from '../../types/graphql'
import { ErrorState } from '../common/ErrorState'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { OwnerSelect } from './OwnerSelect'

export function OwnerSelectField({ owners, ownersFetching, ownersError, canCreateOwner, selectedOwner, setSelectedOwner, onOwnerCreated }: {
  owners: Owner[]
  ownersFetching: boolean
  ownersError?: CombinedError
  canCreateOwner: boolean
  selectedOwner: string
  setSelectedOwner: (ownerId: string) => void
  onOwnerCreated: (owner: Owner) => void
}) {
  if (ownersFetching || ownersError || (owners.length === 0 && !canCreateOwner)) return null

  return (
    <label className="block text-sm font-semibold text-neutral-950">
      Owner <span className="text-red-500">*</span>
      <OwnerSelect canCreate={canCreateOwner} onChange={setSelectedOwner} onOwnerCreated={onOwnerCreated} owners={owners} value={selectedOwner} />
    </label>
  )
}

export function OwnerLoadStatus({ fetching, error }: { fetching: boolean; error?: CombinedError }) {
  return (
    <>
      {fetching ? <LoadingSpinner label="Loading owners" /> : null}
      {error ? <ErrorState message="Could not load owners." /> : null}
    </>
  )
}
