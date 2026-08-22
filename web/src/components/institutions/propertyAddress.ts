import type { Account } from '../../types/graphql'

export function formatAddress(accountWealthProperty: Account['accountWealthProperty']) {
  const address = accountWealthProperty?.__typename === 'RealEstateAssetDetails' ? accountWealthProperty.address : null
  if (!address) return ''
  return [address.street, address.city, address.state, address.zip].filter(Boolean).join(', ')
}
