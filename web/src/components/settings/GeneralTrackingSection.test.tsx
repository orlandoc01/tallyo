import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configuration } from '../../mocks/handlers'
import { captureMutation } from '../../test/msw'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import { GeneralTrackingSection } from './GeneralTrackingSection'

const mockAuth = vi.hoisted(() => ({
  disableTransactionTracking: false,
  disableWealthTracking: false,
  hideOwners: false,
  refreshGeneralConfiguration: vi.fn(async () => undefined),
}))

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => mockAuth,
}))

afterEach(() => {
  mockAuth.disableTransactionTracking = false
  mockAuth.disableWealthTracking = false
  mockAuth.hideOwners = false
  mockAuth.refreshGeneralConfiguration.mockClear()
})

describe('GeneralTrackingSection', () => {
  it('saves the full general configuration from one form', async () => {
    const user = userEvent.setup()
    const updateConfiguration = captureMutation('UpdateConfiguration', { updateConfiguration: { __typename: 'UpdateConfigurationPayload', configuration } })

    render(<GeneralTrackingSection canWriteSettings />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getByRole('switch', { name: 'Disable wealth tracking' }))
    await user.click(screen.getByRole('switch', { name: 'Hide owners' }))
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(updateConfiguration.input?.general).toEqual({
        disableTransactionTracking: false,
        disableWealthTracking: true,
        hideOwners: true,
      })
    })
    expect(mockAuth.refreshGeneralConfiguration).toHaveBeenCalled()
  })
})
