import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { configuration as configurationHandlerFixture } from '../../mocks/handlers'
import { captureMutation, captureQuery, mockGraphqlError, mockQuery } from '../../test/msw'
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
    expect(within(llmForm).getByLabelText('Batch size')).toHaveValue(5)
    expect(within(llmForm).getByLabelText('Max output tokens')).toHaveValue(2048)
    expect(within(llmForm).getByLabelText('Temperature')).toHaveValue(0.1)
    expect(within(llmForm).getByLabelText('Request timeout (seconds)')).toHaveValue(300)
    expect(within(llmForm).getByRole('switch', { name: 'Thinking' })).not.toBeChecked()
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
    fireEvent.change(within(llmForm).getByLabelText('Batch size'), { target: { value: '50' } })
    fireEvent.submit(llmForm)

    await waitFor(() => expect(update.called).toBe(true))
    expect(update.input).toEqual({
      llmCategorization: {
        enabled: true,
        provider: 'OLLAMA',
        ollama: {
          url: 'http://ollama.internal:11434',
          model: 'llama3',
          batchSize: 50,
          think: false,
          temperature: 0.1,
          maxOutputTokens: 2048,
          requestTimeoutSeconds: 300,
        },
      },
    })
  })

  it('disables save while a generation field is out of range', async () => {
    mockConfigurationQuery(configuration())
    renderTab()

    await screen.findByText('LLM Categorization')
    const llmForm = sectionForm('LLM Categorization')
    fireEvent.change(within(llmForm).getByLabelText('Batch size'), { target: { value: '0' } })
    expect(within(llmForm).getByText('Enter a number between 1 and 200.')).toBeInTheDocument()
    expect(within(llmForm).getByRole('button', { name: 'save' })).toBeDisabled()

    fireEvent.change(within(llmForm).getByLabelText('Batch size'), { target: { value: '10' } })
    expect(within(llmForm).getByRole('button', { name: 'save' })).toBeEnabled()

    fireEvent.change(within(llmForm).getByLabelText('Batch size'), { target: { value: '100' } })
    fireEvent.change(within(llmForm).getByLabelText('Max output tokens'), { target: { value: '1000' } })
    expect(within(llmForm).getByText('Allow at least 20 tokens per transaction in a batch.')).toBeInTheDocument()
    expect(within(llmForm).getByLabelText('Max output tokens')).toHaveAttribute('aria-invalid', 'true')
    expect(within(llmForm).getByRole('button', { name: 'save' })).toBeDisabled()
  })

  it('shows the server error when the connection test fails', async () => {
    mockConfigurationQuery(configuration())
    mockGraphqlError('OllamaModels', 'ollama http: error sending request')
    renderTab()

    await screen.findByText('LLM Categorization')
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(await screen.findByText(/ollama http: error sending request/)).toBeInTheDocument()
  })

  it('offers Test connection only with write access', async () => {
    mockConfigurationQuery(configuration())
    renderTab({ scopes: ['read:settings'] })

    await screen.findByText('LLM Categorization')
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled()
  })

  it('tests the connection with the URL in the form', async () => {
    mockConfigurationQuery(configuration())
    const models = captureQuery('OllamaModels', { ollamaModels: ['qwen2.5:7b-instruct', 'mistral'] })
    renderTab()

    await screen.findByText('LLM Categorization')
    const llmForm = sectionForm('LLM Categorization')
    fireEvent.change(within(llmForm).getByLabelText('Ollama URL'), { target: { value: 'http://ollama.internal:11434' } })
    fireEvent.click(within(llmForm).getByRole('button', { name: 'Test connection' }))

    expect(await within(llmForm).findByText('Found 2 models: qwen2.5:7b-instruct, mistral')).toBeInTheDocument()
    expect(within(llmForm).getByText('Model "llama3" is not in the list reported by this server.')).toBeInTheDocument()
    expect(models.variables).toEqual({ url: 'http://ollama.internal:11434' })

    fireEvent.change(within(llmForm).getByLabelText('Ollama URL'), { target: { value: 'http://other:11434' } })
    expect(within(llmForm).queryByText(/Found 2 models/)).not.toBeInTheDocument()
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
    expect(screen.getByLabelText('Batch size')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled()
  })
})
