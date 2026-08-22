import type { Account, AccountType, EVMWallet, UpdateAccountInput, UpdateRealEstateInput } from '../../types/graphql'
import { emptyAddressDraft } from './addressDraft'

type AccountAddressDraft = ReturnType<typeof emptyAddressDraft>

export type AccountInfoDraft = {
  address: AccountAddressDraft
  chainIds: string[]
  closed: boolean
  hidden: boolean
  name: string
  notes: string
  ownerId: string
  subtype: string
  type: AccountType
}

export function accountAddressDraft(account: Account): AccountAddressDraft {
  const propertyAddress = account.accountWealthProperty?.__typename === 'RealEstateAssetDetails'
    ? account.accountWealthProperty.address
    : null

  return {
    ...emptyAddressDraft(),
    city: propertyAddress?.city ?? '',
    homeType: propertyAddress?.homeType ?? '',
    state: propertyAddress?.state ?? '',
    street: propertyAddress?.street ?? '',
    zip: propertyAddress?.zip ?? '',
  }
}

export function accountEVMWallet(account: Account): EVMWallet | null {
  return account.connection?.provider?.__typename === 'EVMWallet' ? account.connection.provider : null
}

export function accountInfoDraft(account: Account): AccountInfoDraft {
  return {
    address: accountAddressDraft(account),
    chainIds: accountEVMWallet(account)?.chainIds ?? [],
    closed: account.closed,
    hidden: account.hidden,
    name: account.name,
    notes: account.notes ?? '',
    ownerId: account.owner.id,
    subtype: account.subtype ?? '',
    type: account.type,
  }
}

export function accountInfoDirty(account: Account, draft: AccountInfoDraft, needsTypeReview: boolean) {
  return needsTypeReview ||
    draft.name !== account.name ||
    draft.ownerId !== account.owner.id ||
    draft.type !== account.type ||
    draft.subtype !== (account.subtype ?? '') ||
    draft.notes !== (account.notes ?? '') ||
    draft.closed !== account.closed ||
    draft.hidden !== account.hidden
}

export function addressDirty(current: AccountAddressDraft, draft: AccountAddressDraft) {
  return draft.street !== current.street ||
    draft.city !== current.city ||
    draft.state !== current.state ||
    draft.zip !== current.zip ||
    draft.homeType !== current.homeType
}

export function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id) => right.includes(id))
}

export function buildAccountInfoInput(account: Account, draft: AccountInfoDraft): Omit<UpdateAccountInput, 'id'> {
  const input: Omit<UpdateAccountInput, 'id'> = {}
  if (draft.name !== account.name) input.name = draft.name
  if (draft.ownerId !== account.owner.id) input.ownerId = draft.ownerId
  if (draft.type !== account.type || account.needsReview) input.type = draft.type
  if (draft.subtype !== (account.subtype ?? '')) input.subtype = draft.subtype
  if (draft.notes !== (account.notes ?? '')) input.notes = draft.notes
  if (draft.closed !== account.closed) input.closed = draft.closed
  if (draft.hidden !== account.hidden) input.hidden = draft.hidden
  return input
}

export function buildRealEstateInput(connectionId: string, current: AccountAddressDraft, draft: AccountAddressDraft): UpdateRealEstateInput {
  const input: UpdateRealEstateInput = { connectionId }
  if (draft.street !== current.street) input.street = draft.street
  if (draft.city !== current.city) input.city = draft.city
  if (draft.state !== current.state) input.state = draft.state
  if (draft.zip !== current.zip) input.zip = draft.zip
  if (draft.homeType !== current.homeType) input.homeType = draft.homeType
  return input
}
