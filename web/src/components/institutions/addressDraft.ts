export type AddressDraft = {
  city: string
  homeType: string
  state: string
  street: string
  zip: string
}

export type AddressField = keyof AddressDraft

export function emptyAddressDraft(): AddressDraft {
  return { city: '', homeType: '', state: '', street: '', zip: '' }
}
