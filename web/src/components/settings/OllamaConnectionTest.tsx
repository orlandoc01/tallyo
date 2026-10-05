import { useState } from 'react'
import { useQuery } from 'urql'

import { OLLAMA_MODELS_QUERY } from '../../graphql/queries'
import { Button } from '../common/Button'

export function OllamaConnectionTest({ url, model, disabled }: { url: string; model: string; disabled: boolean }) {
  const [testedUrl, setTestedUrl] = useState<string | null>(null)
  const [{ data, error, fetching }, reexecute] = useQuery<{ ollamaModels: string[] }, { url: string }>({
    query: OLLAMA_MODELS_QUERY,
    variables: { url: testedUrl ?? '' },
    pause: testedUrl === null,
    requestPolicy: 'network-only',
  })
  const trimmedUrl = url.trim()
  const stale = testedUrl !== trimmedUrl

  function test() {
    if (testedUrl === trimmedUrl) reexecute({ requestPolicy: 'network-only' })
    else setTestedUrl(trimmedUrl)
  }

  return (
    <div className="space-y-1.5">
      <Button disabled={disabled || trimmedUrl === '' || fetching} onClick={test} size="sm" type="button" variant="secondary">
        {fetching ? 'Testing…' : 'Test connection'}
      </Button>
      {stale || fetching ? null : <TestResult error={error?.message} model={model} models={data?.ollamaModels} />}
    </div>
  )
}

function TestResult({ error, model, models }: { error?: string; model: string; models?: string[] }) {
  if (error) return <p className="text-xs text-negative">{error}</p>
  if (!models) return null
  return (
    <div className="space-y-0.5 text-xs">
      <p className="text-text-2">Found {models.length} {models.length === 1 ? 'model' : 'models'}{models.length > 0 ? `: ${models.join(', ')}` : ''}</p>
      {model.trim() !== '' && !models.includes(model.trim()) ? <p className="text-warning">Model "{model.trim()}" is not in the list reported by this server.</p> : null}
    </div>
  )
}
