import { useState } from 'react'
import { useOwners } from '../../hooks/useEntityQueries'
import { usePermissions } from '../../hooks/usePermissions'
import type { Owner } from '../../types/graphql'

// Owner selection shared by the manual link modals (crypto wallet, real estate):
// fetch owners, keep a local copy that newly created owners can be appended to,
// and auto-select when there is exactly one owner.
export function useLinkOwners() {
  const { owners: fetchedOwners, fetching: ownersFetching, error: ownersError } = useOwners()
  const { canWrite } = usePermissions()
  const canCreateOwner = canWrite('owners')
  const [createdOwners, setCreatedOwners] = useState<Owner[]>([])
  const [selectedOwnerId, setSelectedOwner] = useState('')

  const owners = createdOwners.length === 0
    ? fetchedOwners
    : fetchedOwners.concat(createdOwners.filter((created) => !fetchedOwners.some((owner) => owner.id === created.id)))
  const selectedOwnerExists = owners.some((owner) => owner.id === selectedOwnerId)
  const selectedOwner = owners.length === 1 ? owners[0].id : selectedOwnerExists ? selectedOwnerId : ''

  function handleOwnerCreated(owner: Owner) {
    setCreatedOwners((current) => current.some((created) => created.id === owner.id) ? current : [...current, owner])
  }

  return { owners, ownersFetching, ownersError, canCreateOwner, selectedOwner, setSelectedOwner, handleOwnerCreated }
}
