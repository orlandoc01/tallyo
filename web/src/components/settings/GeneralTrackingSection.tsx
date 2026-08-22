import { useState } from 'react'
import { useMutation } from 'urql'

import { useAuth } from '../../auth/useAuth'
import { UPDATE_CONFIGURATION_MUTATION } from '../../graphql/mutations'
import type { Configuration, UpdateConfigurationInput } from '../../types/graphql'
import { Button } from '../common/Button'
import { ErrorState } from '../common/ErrorState'
import { SectionLabel } from '../common/FormControls'
import { SettingsToggleInput } from './SettingsToggleInput'

type FormState = {
  disableTransactionTracking: boolean
  disableWealthTracking: boolean
  hideOwners: boolean
}

export function GeneralTrackingSection({ canWriteSettings }: { canWriteSettings: boolean }) {
  const { disableTransactionTracking, disableWealthTracking, hideOwners } = useAuth()
  const initialState = { disableTransactionTracking, disableWealthTracking, hideOwners }

  return (
    <GeneralTrackingForm
      canWriteSettings={canWriteSettings}
      initialState={initialState}
      key={`${disableTransactionTracking}:${disableWealthTracking}:${hideOwners}`}
    />
  )
}

function GeneralTrackingForm({ canWriteSettings, initialState }: { canWriteSettings: boolean; initialState: FormState }) {
  const { refreshGeneralConfiguration } = useAuth()
  const [state, setState] = useState<FormState>(initialState)
  const [mutationResult, updateConfiguration] = useMutation<
    { updateConfiguration: { configuration: Configuration } },
    { input: UpdateConfigurationInput }
  >(UPDATE_CONFIGURATION_MUTATION)

  const dirty = state.disableTransactionTracking !== initialState.disableTransactionTracking
    || state.disableWealthTracking !== initialState.disableWealthTracking
    || state.hideOwners !== initialState.hideOwners

  async function save() {
    const result = await updateConfiguration({ input: { general: state } })
    if (!result.error) await refreshGeneralConfiguration()
  }

  return (
    <section className="space-y-3">
      <div>
        <SectionLabel>Runtime controls</SectionLabel>
      </div>

      {mutationResult.error ? <ErrorState message={mutationResult.error.message} /> : null}

      <div className="max-w-xl rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="space-y-4">
          <SettingsToggleInput
            checked={state.disableTransactionTracking}
            dirty={state.disableTransactionTracking !== initialState.disableTransactionTracking}
            disabled={!canWriteSettings || mutationResult.fetching}
            label="Disable transaction tracking"
            onChange={(value) => setState((current) => ({ ...current, disableTransactionTracking: value }))}
          />
          <SettingsToggleInput
            checked={state.disableWealthTracking}
            dirty={state.disableWealthTracking !== initialState.disableWealthTracking}
            disabled={!canWriteSettings || mutationResult.fetching}
            label="Disable wealth tracking"
            onChange={(value) => setState((current) => ({ ...current, disableWealthTracking: value }))}
          />
          <SettingsToggleInput
            checked={state.hideOwners}
            dirty={state.hideOwners !== initialState.hideOwners}
            disabled={!canWriteSettings || mutationResult.fetching}
            label="Hide owners"
            onChange={(value) => setState((current) => ({ ...current, hideOwners: value }))}
          />
        </div>
        {dirty ? (
          <div className="mt-4 flex justify-end border-t border-neutral-100 pt-4">
            <Button disabled={!canWriteSettings || mutationResult.fetching} onClick={() => { void save() }}>save</Button>
          </div>
        ) : null}
      </div>
    </section>
  )
}
