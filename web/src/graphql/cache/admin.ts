import { invalidateRoot, type MutationUpdater, type MutationUpdaters } from './shared'

const adminMutationRoots = {
  createOwner: 'owners',
  deleteOwner: 'owners',
  addUser: 'users',
  removeUser: 'users',
  updateUser: 'users',
} as const

const invalidatesRoot = (fieldName: string): MutationUpdater => (_result, _args, cache) => invalidateRoot(cache, fieldName)

export const adminMutationUpdaters = Object.fromEntries(
  Object.entries(adminMutationRoots).map(([mutationName, fieldName]) => [mutationName, invalidatesRoot(fieldName)]),
) satisfies MutationUpdaters
