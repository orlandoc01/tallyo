import type { Account } from '../../types/graphql'
import { AddressFields } from './AddressFields'
import type { AddressDraft, AddressField } from './addressDraft'
import { formatAddress } from './propertyAddress'

export function PropertyAddressSection({
  addressDraft,
  canEdit,
  account,
  onAddressChange,
}: {
  addressDraft: AddressDraft
  canEdit: boolean
  account: Account
  onAddressChange: (field: AddressField, value: string) => void
}) {
  if (!canEdit) return <ReadOnlyPropertyAddress account={account} />

  return (
    <fieldset className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-sm text-neutral-700 lg:col-span-2">
      <legend className="px-1 font-medium text-neutral-900">Address</legend>
      <AddressFields address={addressDraft} includeHomeType onChange={onAddressChange} />
    </fieldset>
  )
}

function ReadOnlyPropertyAddress({ account }: { account: Account }) {
  const address = formatAddress(account.accountWealthProperty)
  const realEstateDetails = account.accountWealthProperty?.__typename === 'RealEstateAssetDetails' ? account.accountWealthProperty : null

  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700 lg:col-span-2">
      <div className="font-medium text-neutral-900">Address</div>
      <div>{address || 'Address not available'}</div>
      {realEstateDetails?.address.homeType ? (
        <div className="mt-1 text-xs text-neutral-500">{realEstateDetails.address.homeType}</div>
      ) : null}
    </div>
  )
}
