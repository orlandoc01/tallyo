import { useMemo } from 'react'
import { useAuth } from '../auth/useAuth'

export function usePermissions() {
  const { scopes } = useAuth()
  return useMemo(() => ({
    canRead: (resource: string) => scopes.includes(`read:${resource}`),
    canWrite: (resource: string) => scopes.includes(`write:${resource}`),
    hasScope: (scope: string) => scopes.includes(scope),
  }), [scopes])
}
