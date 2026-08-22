import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { configuration as configurationHandlerFixture } from '../../mocks/handlers'
import { captureMutation, mockQuery } from '../../test/msw'
import { renderWithProviders } from '../../test/renderWithProviders'
import type { Configuration } from '../../types/graphql'
import { AiIntegrationTab } from './AiIntegrationTab'

const settingsScopes = ['read:settings', 'write:settings']
const baseConfiguration = configurationHandlerFixture as unknown as Configuration

function renderTab(auth: { scopes: string[] } = { scopes: settingsScopes }) {
  return renderWithProviders(<AiIntegrationTab />, { withGraphql: true, auth })
}

function mockConfigurationQuery(configuration: Configuration) {
  mockQuery('Configuration', { configuration })
}

function configuration(overrides: Partial<Configuration['llmCategorization']> = {}): Configuration {
  return {
    ...baseConfiguration,
    mcp: { ...baseConfiguration.mcp, dynamicRedirectHosts: ['claude.ai'] },
    llmCategorization: { ...baseConfiguration.llmCategorization, ...overrides },
  }
}

function sectionForm(title: string) {
  const form = screen.getByText(title).closest('form')
  if (!form) throw new Error(`${title} form not found`)
  return form
}

describe('AiIntegrationTab', () => {
  it('requires settings read access', () => {
    renderTab({ scopes: [] })
    expect(screen.getByText('Settings access required')).toBeTruthy()
  })

  it('renders independent LLM and MCP cards', async () => {
    mockConfigurationQuery(configuration())
    renderTab()

    await screen.findByText('LLM Categorization')
    const llmForm = sectionForm('LLM Categorization')
    const mcpForm = sectionForm('MCP')
    expect(within(llmForm).getByLabelText('Ollama URL')).toHaveValue('http://ollama:11434')
    expect(within(llmForm).getByLabelText('Ollama model')).toHaveValue('llama3')
    expect(within(mcpForm).getByRole('switch', { name: 'Enabled' })).toBeChecked()
    expect(within(mcpForm).getByLabelText('Redirect hosts (comma-separated)')).toHaveValue('claude.ai')
    expect(screen.queryByRole('button', { name: 'save' })).not.toBeInTheDocument()
  })

  it('saves only the LLM configuration', async () => {
    const current = configuration()
    mockConfigurationQuery(current)
    const update = captureMutation('UpdateConfiguration', {
      updateConfiguration: { __typename: 'UpdateConfigurationPayload', configuration: current },
    })
    renderTab()

    await screen.findByText('LLM Categorization')
    const llmForm = sectionForm('LLM Categorization')
    fireEvent.change(within(llmForm).getByLabelText('Ollama URL'), { target: { value: ' http://ollama.internal:11434 ' } })
    fireEvent.submit(llmForm)

    await waitFor(() => expect(update.called).toBe(true))
    expect(update.input).toEqual({
      llmCategorization: {
        enabled: true,
        provider: 'OLLAMA',
        ollama: { url: 'http://ollama.internal:11434', model: 'llama3' },
      },
    })
  })

  it('keeps the MCP redirect hosts editing behavior', async () => {
    const current = configuration()
    mockConfigurationQuery(current)
    const update = captureMutation('UpdateConfiguration', {
      updateConfiguration: { __typename: 'UpdateConfigurationPayload', configuration: current },
    })
    renderTab()

    await screen.findByText('MCP')
    const mcpForm = sectionForm('MCP')
    fireEvent.change(within(mcpForm).getByLabelText('Redirect hosts (comma-separated)'), { target: { value: 'claude.ai, mcp.example.com' } })
    fireEvent.submit(mcpForm)

    await waitFor(() => expect(update.called).toBe(true))
    expect(update.input).toEqual({ mcp: { enabled: true, dynamicRedirectHosts: ['claude.ai', 'mcp.example.com'] } })
  })

  it('disables Ollama inputs while categorization is off', async () => {
    mockConfigurationQuery(configuration({ enabled: false }))
    renderTab()

    expect(await screen.findByLabelText('Ollama URL')).toBeDisabled()
    expect(screen.getByLabelText('Ollama model')).toBeDisabled()
  })
})
