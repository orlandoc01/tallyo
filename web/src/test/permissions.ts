import { expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AnyVariables } from '@urql/core'
import type { useMutation, UseMutationResponse } from 'urql'
import type { ReactElement } from 'react'

import { useConfiguration } from '../hooks/useConfiguration'
import type { usePermissions } from '../hooks/usePermissions'
import type { Configuration } from '../types/graphql'

export const allowAllPermissionResult: ReturnType<typeof usePermissions> = {
  canRead: () => true,
  canWrite: () => true,
  hasScope: () => true,
}

export function allowAllPermissions() {
  return {
    usePermissions: vi.fn(() => allowAllPermissionResult),
  }
}

export function mockSettingsPermissions(canReadSettings: boolean, permissionsHook: typeof usePermissions, mutationHook: typeof useMutation) {
  vi.mocked(permissionsHook).mockReturnValue({
    canRead: (resource: string) => resource === 'settings' && canReadSettings,
    canWrite: (resource: string) => resource === 'settings' && canReadSettings,
    hasScope: vi.fn(),
  })
  vi.mocked(mutationHook).mockReturnValue(idleMutationResponse())
}

export function mockConfiguration({ configuration = null, fetching = false, error = null, refetch = vi.fn() }: {
  configuration?: Configuration | null
  fetching?: boolean
  error?: Error | null
  refetch?: ReturnType<typeof vi.fn>
} = {}) {
  vi.mocked(useConfiguration).mockReturnValue({ configuration, fetching, error, refetch } as never)
}

export function itHandlesConfigTabQueryStates(Component: () => ReactElement, errorText: string, permissionsHook: typeof usePermissions, mutationHook: typeof useMutation) {
  it('requires settings read access', () => {
    mockSettingsPermissions(false, permissionsHook, mutationHook)
    mockConfiguration()
    render(Component())
    expect(screen.getByText('Settings access required')).toBeTruthy()
  })

  it('renders loading, error, and empty states', () => {
    mockSettingsPermissions(true, permissionsHook, mutationHook)
    mockConfiguration({ fetching: true })
    const { rerender } = render(Component())
    expect(screen.getByText(/Loading/i)).toBeTruthy()

    mockConfiguration({ error: new Error(errorText) })
    rerender(Component())
    expect(screen.getByText(errorText)).toBeTruthy()

    mockConfiguration()
    rerender(Component())
    expect(screen.getByText('No configuration')).toBeTruthy()
  })
}

function idleMutationResponse(): UseMutationResponse<unknown, AnyVariables> {
  return [{ fetching: false, stale: false, hasNext: false }, vi.fn(async () => { throw new Error('mutation mock not configured') })]
}
