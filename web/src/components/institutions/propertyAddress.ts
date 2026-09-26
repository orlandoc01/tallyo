import type { Account } from '../../types/graphql'

export function joinAddress(address: { street?: string | null; city?: string | null; state?: string | null; zip?: string | null }) {
  return [address.street, address.city, address.state, address.zip].filter(Boolean).join(', ')
}

export function formatAddress(accountWealthProperty: Account['accountWealthProperty']) {
  const address = accountWealthProperty?.__typename === 'RealEstateAssetDetails' ? accountWealthProperty.address : null
  return address ? joinAddress(address) : ''
}
