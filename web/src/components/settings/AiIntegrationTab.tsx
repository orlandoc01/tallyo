import type { Configuration } from '../../types/graphql'
import { EmptyState } from '../common/EmptyState'
import { ConfigCard, ConfigStatus, NumberInput, pickDirtyFields, TextInput, ToggleInput } from './ConfigFormControls'
import { numberInRange, splitCSV } from './configParsing'
import { OllamaConnectionTest } from './OllamaConnectionTest'
import { useConfigurationForm } from './useConfigFormState'

type FormState = {
  llmEnabled: boolean
  ollamaUrl: string
  ollamaModel: string
  ollamaBatchSize: string
  ollamaThink: boolean
  ollamaTemperature: string
  ollamaMaxOutputTokens: string
  ollamaRequestTimeoutSeconds: string
  mcpEnabled: boolean
  mcpDynamicRedirectHosts: string
}

type SectionKey = 'llm' | 'mcp'
type FieldKey = keyof FormState

const emptyState: FormState = {
  llmEnabled: false,
  ollamaUrl: '',
  ollamaModel: 'qwen2.5:7b-instruct',
  ollamaBatchSize: '5',
  ollamaThink: false,
  ollamaTemperature: '0.1',
  ollamaMaxOutputTokens: '2048',
  ollamaRequestTimeoutSeconds: '300',
  mcpEnabled: false,
  mcpDynamicRedirectHosts: '',
}

const generationFields = ['ollamaBatchSize', 'ollamaTemperature', 'ollamaMaxOutputTokens', 'ollamaRequestTimeoutSeconds'] as const satisfies readonly FieldKey[]

const generationRanges: Record<(typeof generationFields)[number], { min: number; max: number; step?: number }> = {
  ollamaBatchSize: { min: 1, max: 200 },
  ollamaTemperature: { min: 0, max: 2, step: 0.1 },
  ollamaMaxOutputTokens: { min: 64, max: 65535 },
  ollamaRequestTimeoutSeconds: { min: 10, max: 3600 },
}

const OUTPUT_TOKENS_PER_TRANSACTION = 20

const llmFields: FieldKey[] = ['llmEnabled', 'ollamaUrl', 'ollamaModel', 'ollamaBatchSize', 'ollamaThink', 'ollamaTemperature', 'ollamaMaxOutputTokens', 'ollamaRequestTimeoutSeconds']

export function AiIntegrationTab() {
  const { canReadSettings, canWriteSettings, configuration, dirtyFields, error, fetching, mutationResult, save, setState, state } = useConfigurationForm(makeFormState)

  if (!canReadSettings) {
    return <EmptyState title="Settings access required" description="Your account cannot view server configuration." />
  }

  const sectionDirtyFields = {
    llm: pickDirtyFields(dirtyFields, llmFields),
    mcp: pickDirtyFields(dirtyFields, ['mcpEnabled', 'mcpDynamicRedirectHosts']),
  } satisfies Record<SectionKey, Set<FieldKey>>
  const rangesValid = generationFields.every((key) => numberInRange(state[key], generationRanges[key].min, generationRanges[key].max))
  const budgetValid = Number(state.ollamaMaxOutputTokens) >= Number(state.ollamaBatchSize) * OUTPUT_TOKENS_PER_TRANSACTION

  return (
    <section className="space-y-3">
      <ConfigStatus configuration={configuration} error={error} fetching={fetching} mutationError={mutationResult.error} />

      {!fetching && !error && configuration ? (
        <div className="grid gap-3 lg:grid-cols-[repeat(auto-fit,minmax(300px,1fr))]">
          <ConfigCard
            dirty={sectionDirtyFields.llm.size > 0}
            disabled={!canWriteSettings || mutationResult.fetching || !rangesValid || !budgetValid}
            enabled={{ label: 'Enabled', checked: state.llmEnabled, dirty: sectionDirtyFields.llm.has('llmEnabled'), onChange: (llmEnabled) => setState((s) => ({ ...s, llmEnabled })) }}
            title="LLM Categorization"
            onSubmit={() => void save({
              llmCategorization: {
                enabled: state.llmEnabled,
                provider: 'OLLAMA',
                ollama: {
                  url: state.ollamaUrl.trim() || null,
                  model: state.ollamaModel,
                  batchSize: Number(state.ollamaBatchSize),
                  think: state.ollamaThink,
                  temperature: Number(state.ollamaTemperature),
                  maxOutputTokens: Number(state.ollamaMaxOutputTokens),
                  requestTimeoutSeconds: Number(state.ollamaRequestTimeoutSeconds),
                },
              },
            })}
          >
            <TextInput disabled={!state.llmEnabled} dirty={sectionDirtyFields.llm.has('ollamaUrl')} label="Ollama URL" value={state.ollamaUrl} onChange={(ollamaUrl) => setState((s) => ({ ...s, ollamaUrl }))} />
            <OllamaConnectionTest disabled={!state.llmEnabled || !canWriteSettings} model={state.ollamaModel} url={state.ollamaUrl} />
            <TextInput disabled={!state.llmEnabled} dirty={sectionDirtyFields.llm.has('ollamaModel')} label="Ollama model" value={state.ollamaModel} onChange={(ollamaModel) => setState((s) => ({ ...s, ollamaModel }))} />
            <p className="text-xs font-medium text-text-2">Generation</p>
            <div className="grid gap-3.5 lg:grid-cols-2">
              <NumberInput {...generationRanges.ollamaBatchSize} disabled={!state.llmEnabled} dirty={sectionDirtyFields.llm.has('ollamaBatchSize')} hint="Transactions per request. 5 for a local CPU model, 50 to 100 for a hosted model." label="Batch size" value={state.ollamaBatchSize} onChange={(ollamaBatchSize) => setState((s) => ({ ...s, ollamaBatchSize }))} />
              <NumberInput {...generationRanges.ollamaMaxOutputTokens} disabled={!state.llmEnabled} dirty={sectionDirtyFields.llm.has('ollamaMaxOutputTokens')} error={budgetValid ? undefined : `Allow at least ${OUTPUT_TOKENS_PER_TRANSACTION} tokens per transaction in a batch.`} hint="Allow about 25 tokens per transaction in a batch." label="Max output tokens" value={state.ollamaMaxOutputTokens} onChange={(ollamaMaxOutputTokens) => setState((s) => ({ ...s, ollamaMaxOutputTokens }))} />
              <NumberInput {...generationRanges.ollamaTemperature} disabled={!state.llmEnabled} dirty={sectionDirtyFields.llm.has('ollamaTemperature')} label="Temperature" value={state.ollamaTemperature} onChange={(ollamaTemperature) => setState((s) => ({ ...s, ollamaTemperature }))} />
              <NumberInput {...generationRanges.ollamaRequestTimeoutSeconds} disabled={!state.llmEnabled} dirty={sectionDirtyFields.llm.has('ollamaRequestTimeoutSeconds')} label="Request timeout (seconds)" value={state.ollamaRequestTimeoutSeconds} onChange={(ollamaRequestTimeoutSeconds) => setState((s) => ({ ...s, ollamaRequestTimeoutSeconds }))} />
            </div>
            <ToggleInput checked={state.ollamaThink} dirty={sectionDirtyFields.llm.has('ollamaThink')} disabled={!state.llmEnabled} label="Thinking" onChange={(ollamaThink) => setState((s) => ({ ...s, ollamaThink }))} />
          </ConfigCard>

          <ConfigCard
            dirty={sectionDirtyFields.mcp.size > 0}
            disabled={!canWriteSettings || mutationResult.fetching}
            enabled={{ label: 'Enabled', checked: state.mcpEnabled, dirty: sectionDirtyFields.mcp.has('mcpEnabled'), onChange: (mcpEnabled) => setState((s) => ({ ...s, mcpEnabled })) }}
            title="MCP"
            onSubmit={() => void save({
              mcp: {
                enabled: state.mcpEnabled,
                dynamicRedirectHosts: splitCSV(state.mcpDynamicRedirectHosts),
              },
            })}
          >
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
    ollamaBatchSize: String(configuration.llmCategorization.ollama.batchSize),
    ollamaThink: configuration.llmCategorization.ollama.think,
    ollamaTemperature: String(configuration.llmCategorization.ollama.temperature),
    ollamaMaxOutputTokens: String(configuration.llmCategorization.ollama.maxOutputTokens),
    ollamaRequestTimeoutSeconds: String(configuration.llmCategorization.ollama.requestTimeoutSeconds),
    mcpEnabled: configuration.mcp.enabled,
    mcpDynamicRedirectHosts: configuration.mcp.dynamicRedirectHosts?.join(', ') ?? '',
  }
}
