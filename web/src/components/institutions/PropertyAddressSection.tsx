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
    <section aria-labelledby="property-address-heading" className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700 lg:col-span-2" role="group">
      <div className="mb-3 font-medium text-neutral-900" id="property-address-heading">Address</div>
      <AddressFields address={addressDraft} includeHomeType onChange={onAddressChange} />
    </section>
  )
}

function ReadOnlyPropertyAddress({ account }: { account: Account }) {
  const address = formatAddress(account.accountWealthProperty)
  const realEstateDetails = account.accountWealthProperty?.__typename === 'RealEstateAssetDetails' ? account.accountWealthProperty : null

  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700 lg:col-span-2">
      <div className="font-medium text-neutral-900">Address</div>
      <div>{address || 'Address not available'}</div>
      {realEstateDetails?.address.homeType ? (
        <div className="mt-1 text-xs text-neutral-500">{realEstateDetails.address.homeType}</div>
      ) : null}
    </div>
  )
}
