import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useMutation, useQuery } from 'urql'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { refreshAccessToken } from '../../auth/tokenStore'
import { TimezoneSection } from './TimezoneSection'

vi.mock('urql', async () => (await import('../../test/urql')).mockUrql({ useMutation: vi.fn(), useQuery: vi.fn() }))

vi.mock('../../auth/tokenStore', () => ({
  refreshAccessToken: vi.fn(),
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('TimezoneSection', () => {
  it('renders read-only timezone without write permission', () => {
    vi.mocked(useQuery).mockReturnValue([{ data: { instanceTimezone: 'America/Chicago' }, fetching: false, error: undefined }, vi.fn()] as never)
    vi.mocked(useMutation).mockReturnValue([{ fetching: false, error: undefined }, vi.fn()] as never)

    render(<TimezoneSection canWriteSettings={false} />)

    expect(screen.getByText('America/Chicago')).toBeTruthy()
    expect(screen.queryByLabelText('Instance timezone')).toBeNull()
  })

  it('updates timezone and refreshes token', async () => {
    const reexecuteQuery = vi.fn()
    const updateConfiguration = vi.fn().mockResolvedValue({ data: { updateConfiguration: {} } })
    vi.mocked(refreshAccessToken).mockResolvedValue(true)
    vi.mocked(useQuery).mockReturnValue([{ data: { instanceTimezone: 'America/New_York' }, fetching: false, error: undefined }, reexecuteQuery] as never)
    vi.mocked(useMutation).mockReturnValue([{ fetching: false, error: undefined }, updateConfiguration] as never)

    render(<TimezoneSection canWriteSettings />)
    fireEvent.change(screen.getByLabelText('Instance timezone'), { target: { value: 'America/Los_Angeles' } })

    await waitFor(() => {
      expect(updateConfiguration).toHaveBeenCalledWith({ input: { locale: { timezone: 'America/Los_Angeles' } } })
      expect(refreshAccessToken).toHaveBeenCalled()
      expect(reexecuteQuery).toHaveBeenCalledWith({ requestPolicy: 'network-only' })
    })
  })
})
