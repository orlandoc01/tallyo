import { useMutation } from 'urql'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '../../components/common/Button'
import { FormError } from '../../components/common/FormControls'
import { UPDATE_CONFIGURATION_MUTATION } from '../../graphql/mutations'
import type { Configuration, UpdateConfigurationInput } from '../../types/graphql'
import { SetupActions, SetupHeading } from './SetupLayout'
import { buildSetupConfigurationInput } from './setupConfigurationInput'
import { useSetup } from './useSetup'

const postSetupPath = '/accounts'

export function CompleteStep() {
  const setup = useSetup()
  const [result, updateConfiguration] = useMutation<{ updateConfiguration: { configuration: Configuration } }, { input: UpdateConfigurationInput }>(UPDATE_CONFIGURATION_MUTATION)
  const authChosen = setup.passwordEnabled || setup.oauthEnabled

  async function finish() {
    const response = await updateConfiguration({ input: buildSetupConfigurationInput(setup) })
    if (response.error) return
    document.cookie = `st_post_login=${encodeURIComponent(postSetupPath)}; max-age=300; path=/; samesite=lax`
    window.location.assign(postSetupPath)
  }

  return (
    <div className="text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-green-100 text-green-700">
        <CheckCircle2 className="h-9 w-9" />
      </div>
      <SetupHeading eyebrow="Ready" eyebrowClassName="mt-6 text-sm font-bold uppercase tracking-[0.25em] text-amber-700" title="Setup Complete" />
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-neutral-600">Tallyo has the basics it needs. You can refine authentication, owners, Plaid credentials, and runtime settings later from Settings.</p>
      {authChosen ? <p className="mx-auto mt-5 max-w-xl rounded-2xl bg-green-50 px-4 py-3 text-sm font-semibold text-green-800">Sign-in settings apply immediately when you finish.</p> : null}
      {result.error ? <FormError className="mt-5 font-semibold">{result.error.message}</FormError> : null}

      <SetupActions>
        <Button disabled={result.fetching} onClick={() => window.history.back()} size="lg" variant="secondary">Back</Button>
        <Button className="shadow-lg" disabled={result.fetching} onClick={finish} size="lg">{result.fetching ? 'Applying...' : 'Finish'}</Button>
      </SetupActions>
    </div>
  )
}
