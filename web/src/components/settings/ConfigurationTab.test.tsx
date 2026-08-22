import { render, screen } from '@testing-library/react'
import { useMutation } from 'urql'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { usePermissions } from '../../hooks/usePermissions'
import { configurationFixture as configuration } from '../../mocks/fixtures'
import { itHandlesConfigTabQueryStates, mockConfiguration, mockSettingsPermissions } from '../../test/permissions'
import { ConfigurationTab } from './ConfigurationTab'

vi.mock('../../hooks/useConfiguration', () => ({
  useConfiguration: vi.fn(),
}))

vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

vi.mock('urql', async () => (await import('../../test/urql')).mockUrql({ useMutation: vi.fn() }))

describe('ConfigurationTab', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  itHandlesConfigTabQueryStates(() => <ConfigurationTab />, 'fetch failed', usePermissions, useMutation)

  it('renders the runtime card only', () => {
    mockSettingsPermissions(true, usePermissions, useMutation)
    mockConfiguration({ configuration })
    render(<ConfigurationTab />)

    expect(screen.getByText('Runtime')).toBeTruthy()
    expect(screen.getByText('/config.yaml')).toBeTruthy()
    expect(screen.getByText('/data/tallyo.db')).toBeTruthy()
    expect(screen.getByText('8080')).toBeTruthy()

    // The Services card (LLM + MCP) moved to the AI Integration tab.
    expect(screen.queryByText('LLM Categorization')).not.toBeInTheDocument()
    expect(screen.queryByText('MCP')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'save' })).not.toBeInTheDocument()
  })
})
