import { useState } from 'react'
import { useMutation } from 'urql'
import { LINK_REAL_ESTATE_MUTATION } from '../../graphql/mutations'
import { useSaveAction } from '../../hooks/useSaveAction'
import type { LinkRealEstatePayload } from '../../types/graphql'
import { emptyAddressDraft, type AddressField } from './addressDraft'
import { useLinkOwners } from './useLinkOwners'

export function useLinkRealEstateForm({ onLinked }: { onLinked: (payload: LinkRealEstatePayload) => void }) {
  const owners = useLinkOwners()
  const [label, setLabel] = useState('')
  const [valuationUSD, setValuationUSD] = useState('')
  const [addressDraft, setAddressDraft] = useState(emptyAddressDraft)
  const { error: submitError, saving: submitting, save, setError: setSubmitError } = useSaveAction()
  const [, linkRealEstate] = useMutation<{ linkRealEstate: LinkRealEstatePayload }>(LINK_REAL_ESTATE_MUTATION)

  function handleAddressChange(field: AddressField, value: string) {
    setAddressDraft((draft) => ({ ...draft, [field]: value }))
  }

  async function submit() {
    const value = Number(valuationUSD)
    if (!Number.isFinite(value) || value <= 0) {
      setSubmitError('Enter a positive valuation.')
      return
    }
    if (!owners.selectedOwner) {
      setSubmitError('Select an owner.')
      return
    }
    await save(
      () => linkRealEstate({ input: { street: addressDraft.street || null, city: addressDraft.city || null, state: addressDraft.state || null, zip: addressDraft.zip || null, ownerId: owners.selectedOwner, label: label || null, manualValuationUSD: value } }),
      (result) => { if (result.data?.linkRealEstate) onLinked(result.data.linkRealEstate) },
    )
  }

  return { ...owners, addressDraft, handleAddressChange, label, setLabel, setValuationUSD, submit, submitError, submitting, valuationUSD }
}
