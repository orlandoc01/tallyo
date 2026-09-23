import { useMutation } from 'urql'
import { Button } from '../../components/common/Button'
import { EmptyState } from '../../components/common/EmptyState'
import { UPDATE_CONFIGURATION_MUTATION } from '../../graphql/mutations'
import { useOwners } from '../../hooks/useEntityQueries'
import type { Configuration, UpdateConfigurationInput } from '../../types/graphql'
import { SetupActions, SetupListCard, SetupMessage } from './SetupLayout'
import { buildSetupConfigurationInput } from './setupConfigurationInput'
import { enabledProviderNames, type SetupState } from './setupState'
import { useSetup } from './useSetup'

const postSetupPath = '/accounts'

export function CompleteStep() {
  const setup = useSetup()
  const { owners } = useOwners()
  const [result, updateConfiguration] = useMutation<{ updateConfiguration: { configuration: Configuration } }, { input: UpdateConfigurationInput }>(UPDATE_CONFIGURATION_MUTATION)
  const authChosen = setup.passwordEnabled || setup.oauthEnabled

  async function finish() {
    const response = await updateConfiguration({ input: buildSetupConfigurationInput(setup) })
    if (response.error) return
    document.cookie = `st_post_login=${encodeURIComponent(postSetupPath)}; max-age=300; path=/; samesite=lax`
    window.location.assign(postSetupPath)
  }

  const rows = [
    ['Security model', securityModelSummary(setup)],
    ['Admin', setup.registeredEmail || 'Master password'],
    ['Owners', owners.map((owner) => owner.name).join(', ') || 'None'],
    ['Data provider', setup.dataProviderSummary.join(' · ') || 'Skipped for now'],
  ]

  return (
    <div>
      <EmptyState description="Tallyo has the basics it needs. You can refine authentication, owners, Plaid credentials, and runtime settings later from Settings." title="Setup complete" />
      <SetupListCard className="mt-3">
        {rows.map(([key, value]) => (
          <div className="grid min-h-10 grid-cols-[minmax(120px,160px)_minmax(0,1fr)] items-center gap-3 px-4 py-2" key={key}>
            <span className="text-xs text-text-muted">{key}</span>
            <span className="text-[13px] text-text-1">{value}</span>
          </div>
        ))}
      </SetupListCard>
      {authChosen ? <SetupMessage tone="warning">Sign-in settings apply immediately when you finish.</SetupMessage> : null}
      {result.error ? <SetupMessage tone="negative">{result.error.message}</SetupMessage> : null}

      <SetupActions>
        <Button disabled={result.fetching} onClick={() => window.history.back()} variant="secondary">Back</Button>
        <Button disabled={result.fetching} onClick={finish}>{result.fetching ? 'Applying...' : 'Finish'}</Button>
      </SetupActions>
    </div>
  )
}

function securityModelSummary(setup: SetupState) {
  const oauth = setup.oauthEnabled ? `OAuth · ${enabledProviderNames(setup).join(', ') || 'None'}` : null
  if (setup.passwordEnabled) return oauth ? `Single password + ${oauth}` : 'Single password'
  return oauth ?? 'Not chosen'
}
