import type { Configuration } from '../../types/graphql'
import { EmptyState } from '../common/EmptyState'
import { ConfigCard, ConfigStatus, pickDirtyFields, TextInput, ToggleInput } from './ConfigFormControls'
import { splitCSV } from './configParsing'
import { useConfigurationForm } from './useConfigFormState'

type FormState = {
  llmEnabled: boolean
  ollamaUrl: string
  ollamaModel: string
  mcpEnabled: boolean
  mcpDynamicRedirectHosts: string
}

type SectionKey = 'llm' | 'mcp'
type FieldKey = keyof FormState

const emptyState: FormState = {
  llmEnabled: false,
  ollamaUrl: '',
  ollamaModel: 'qwen2.5:7b-instruct',
  mcpEnabled: false,
  mcpDynamicRedirectHosts: '',
}

export function AiIntegrationTab() {
  const { canReadSettings, canWriteSettings, configuration, dirtyFields, error, fetching, mutationResult, save, setState, state } = useConfigurationForm(makeFormState)

  if (!canReadSettings) {
    return <EmptyState title="Settings access required" description="Your account cannot view server configuration." />
  }

  const sectionDirtyFields = {
    llm: pickDirtyFields(dirtyFields, ['llmEnabled', 'ollamaUrl', 'ollamaModel']),
    mcp: pickDirtyFields(dirtyFields, ['mcpEnabled', 'mcpDynamicRedirectHosts']),
  } satisfies Record<SectionKey, Set<FieldKey>>

  return (
    <section className="space-y-5">
      <ConfigStatus configuration={configuration} error={error} fetching={fetching} mutationError={mutationResult.error} />

      {!fetching && !error && configuration ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ConfigCard
            dirty={sectionDirtyFields.llm.size > 0}
            disabled={!canWriteSettings || mutationResult.fetching}
            title="LLM Categorization"
            onSubmit={() => void save({
              llmCategorization: {
                enabled: state.llmEnabled,
                provider: 'OLLAMA',
                ollama: { url: state.ollamaUrl.trim() || null, model: state.ollamaModel },
              },
            })}
          >
            <ToggleInput dirty={sectionDirtyFields.llm.has('llmEnabled')} label="Enabled" checked={state.llmEnabled} onChange={(llmEnabled) => setState((s) => ({ ...s, llmEnabled }))} />
            <TextInput disabled={!state.llmEnabled} dirty={sectionDirtyFields.llm.has('ollamaUrl')} label="Ollama URL" value={state.ollamaUrl} onChange={(ollamaUrl) => setState((s) => ({ ...s, ollamaUrl }))} />
            <TextInput disabled={!state.llmEnabled} dirty={sectionDirtyFields.llm.has('ollamaModel')} label="Ollama model" value={state.ollamaModel} onChange={(ollamaModel) => setState((s) => ({ ...s, ollamaModel }))} />
          </ConfigCard>

          <ConfigCard
            dirty={sectionDirtyFields.mcp.size > 0}
            disabled={!canWriteSettings || mutationResult.fetching}
            title="MCP"
            onSubmit={() => void save({
              mcp: {
                enabled: state.mcpEnabled,
                dynamicRedirectHosts: splitCSV(state.mcpDynamicRedirectHosts),
              },
            })}
          >
            <ToggleInput dirty={sectionDirtyFields.mcp.has('mcpEnabled')} label="Enabled" checked={state.mcpEnabled} onChange={(mcpEnabled) => setState((s) => ({ ...s, mcpEnabled }))} />
            <TextInput disabled={!state.mcpEnabled} dirty={sectionDirtyFields.mcp.has('mcpDynamicRedirectHosts')} label="Redirect hosts (comma-separated)" value={state.mcpDynamicRedirectHosts} onChange={(mcpDynamicRedirectHosts) => setState((s) => ({ ...s, mcpDynamicRedirectHosts }))} />
          </ConfigCard>
        </div>
      ) : null}
    </section>
  )
}

function makeFormState(configuration: Configuration | null | undefined): FormState {
  if (!configuration) return emptyState
  return {
    llmEnabled: configuration.llmCategorization.enabled,
    ollamaUrl: configuration.llmCategorization.ollama.url ?? '',
    ollamaModel: configuration.llmCategorization.ollama.model,
    mcpEnabled: configuration.mcp.enabled,
    mcpDynamicRedirectHosts: configuration.mcp.dynamicRedirectHosts?.join(', ') ?? '',
  }
}
