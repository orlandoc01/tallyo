import { useState } from 'react'
import { useMutation } from 'urql'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '../../components/common/Button'
import { FormError } from '../../components/common/FormControls'
import { LoadingSpinner } from '../../components/common/LoadingSpinner'
import { UPDATE_CONFIGURATION_MUTATION } from '../../graphql/mutations'
import type { Configuration, UpdateConfigurationInput } from '../../types/graphql'
import { getApiBaseUrl } from '../../utils/apiUrl'
import { SetupActions, SetupHeading } from './SetupLayout'
import { buildSetupConfigurationInput } from './setupConfigurationInput'
import type { SetupState } from './setupState'
import { useSetup } from './useSetup'

const postSetupPath = '/accounts'

type AuthConfigResponse = {
  master_password_status?: string
  email_auth_enabled?: boolean
  google_auth_enabled?: boolean
  webauthn_enabled?: boolean
  setup_complete?: boolean
}

export function CompleteStep() {
  const setup = useSetup()
  const [phase, setPhase] = useState<'idle' | 'finalizing'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, updateConfiguration] = useMutation<{ updateConfiguration: { configuration: Configuration } }, { input: UpdateConfigurationInput }>(UPDATE_CONFIGURATION_MUTATION)
  const authChosen = setup.passwordEnabled || setup.oauthEnabled

  async function finish() {
    const input = buildSetupConfigurationInput(setup)
    setError(null)
    if (authChosen) setPhase('finalizing')
    const response = await updateConfiguration({ input })
    if (response.error) {
      setPhase('idle')
      return
    }
    try {
      if (authChosen) await waitForSetupAuthConfig(setup)
      document.cookie = `st_post_login=${encodeURIComponent(postSetupPath)}; max-age=300; path=/; samesite=lax`
      window.location.assign(postSetupPath)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Server did not finish applying sign-in settings.')
      setPhase('idle')
    }
  }

  return (
    <div className="text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-green-100 text-green-700">
        <CheckCircle2 className="h-9 w-9" />
      </div>
      <SetupHeading eyebrow="Ready" eyebrowClassName="mt-6 text-sm font-bold uppercase tracking-[0.25em] text-amber-700" title="Setup Complete" />
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-neutral-600">Tallyo has the basics it needs. You can refine authentication, owners, Plaid credentials, and runtime settings later from Settings.</p>
      {authChosen ? <p className="mx-auto mt-5 max-w-xl rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">Finishing sign-in setup will restart the server so the new authentication settings are active.</p> : null}
      {phase === 'finalizing' ? <div className="mt-5 flex justify-center"><LoadingSpinner label="Applying sign-in settings..." /></div> : null}
      {result.error ? <FormError className="mt-5 font-semibold">{result.error.message}</FormError> : null}
      {error ? <FormError className="mt-5 font-semibold">{error}</FormError> : null}

      <SetupActions>
        <Button disabled={phase === 'finalizing'} onClick={() => window.history.back()} size="lg" variant="secondary">Back</Button>
        <Button className="shadow-lg" disabled={result.fetching || phase === 'finalizing'} onClick={finish} size="lg">{phase === 'finalizing' ? 'Applying...' : 'Finish'}</Button>
      </SetupActions>
    </div>
  )
}

async function waitForSetupAuthConfig(setup: SetupState) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const config = await fetchAuthConfig().catch(() => null)
    if (config && setupAuthConfigMatches(setup, config)) return
    await new Promise((resolve) => window.setTimeout(resolve, 1000))
  }
  throw new Error('Server did not finish applying sign-in settings. Try again in a moment.')
}

async function fetchAuthConfig() {
  const response = await fetch(`${getApiBaseUrl()}/auth/config`, { cache: 'no-store' })
  if (!response.ok) throw new Error('auth config unavailable')
  return response.json() as Promise<AuthConfigResponse>
}

function setupAuthConfigMatches(setup: SetupState, config: AuthConfigResponse) {
  if (config.setup_complete !== true) return false
  if (setup.passwordEnabled && config.master_password_status === 'DISABLED') return false
  if (!setup.oauthEnabled) return true
  return config.google_auth_enabled === setup.googleEnabled
    && config.email_auth_enabled === setup.emailEnabled
    && config.webauthn_enabled === setup.passkeyEnabled
}
