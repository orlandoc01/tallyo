import { useMemo, useState } from 'react'
import { useMutation } from 'urql'
import { UPDATE_CONFIGURATION_MUTATION } from '../../graphql/mutations'
import { useConfiguration } from '../../hooks/useConfiguration'
import { usePermissions } from '../../hooks/usePermissions'
import type { Configuration, UpdateConfigurationInput } from '../../types/graphql'

// Full wiring for a settings configuration tab: permission gates, the
// configuration query, form state derived from it, and a save that refetches
// on success. Shared by the runtime and security configuration tabs.
// makeFormState must be a module-level function (stable identity).
export function useConfigurationForm<T extends object>(makeFormState: (configuration: Configuration | null | undefined) => T) {
  const { canRead, canWrite } = usePermissions()
  const canReadSettings = canRead('settings')
  const canWriteSettings = canWrite('settings')
  const { configuration, fetching, error, refetch } = useConfiguration(canReadSettings)
  const [mutationResult, updateConfiguration] = useMutation<
    { updateConfiguration: { configuration: Configuration } },
    { input: UpdateConfigurationInput }
  >(UPDATE_CONFIGURATION_MUTATION)

  const initialState = useMemo(() => makeFormState(configuration), [makeFormState, configuration])
  const { state, setState, dirtyFields } = useConfigFormState(initialState)

  async function save(input: UpdateConfigurationInput) {
    const result = await updateConfiguration({ input })
    if (!result.error) refetch({ requestPolicy: 'network-only' })
    return result
  }

  return {
    canReadSettings,
    canWriteSettings,
    configuration,
    dirtyFields,
    error,
    fetching,
    mutationResult,
    refetch,
    save,
    setState,
    state,
    updateConfiguration,
  }
}

// Tracks edits to a settings form: holds the working state, derives the set of
// fields that differ from the server-provided initial state, and resets when
// that initial state changes (e.g. after a refetch).
function useConfigFormState<T extends object>(initialState: T) {
  const [previousInitialState, setPreviousInitialState] = useState(initialState)
  const [state, setState] = useState<T>(initialState)

  if (initialState !== previousInitialState) {
    setPreviousInitialState(initialState)
    setState(initialState)
  }

  const dirtyFields = useMemo(() => {
    const fields = new Set<keyof T>()
    for (const key of Object.keys(initialState) as (keyof T)[]) {
      if (state[key] !== initialState[key]) fields.add(key)
    }
    return fields
  }, [initialState, state])

  return { state, setState, dirtyFields }
}
