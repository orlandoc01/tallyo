import { vi } from 'vitest'

type UrqlOverrides = Partial<{
  gql: unknown
  useClient: unknown
  useMutation: unknown
  useQuery: unknown
}>

export function mockUrql(overrides: UrqlOverrides = {}) {
  return {
    gql: vi.fn(() => ''),
    useMutation: vi.fn(() => [{ fetching: false, error: null }, vi.fn()]),
    useQuery: vi.fn(() => [{ data: undefined, fetching: false, error: null }, vi.fn()]),
    ...overrides,
  }
}
