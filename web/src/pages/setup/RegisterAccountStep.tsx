import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation } from 'urql'
import { ADD_USER_MUTATION, UPDATE_CONFIGURATION_MUTATION } from '../../graphql/mutations'
import { runPasskeyRegistration } from '../../auth/webauthn'
import { Button } from '../../components/common/Button'
import { nullIfBlank, splitCSV } from '../../components/settings/configParsing'
import type { Configuration, UpdateConfigurationInput, User } from '../../types/graphql'
import { enabledProviderNames } from './setupState'
import { useSetup } from './useSetup'
import { SetupActions, SetupBadge, SetupHeading, SetupMessage, SetupTextField } from './SetupLayout'

export function RegisterAccountStep() {
  const navigate = useNavigate()
  const setup = useSetup()
  const [email, setEmail] = useState(setup.registeredEmail)
  const [passkeyName, setPasskeyName] = useState('My passkey')
  const [passkeyState, setPasskeyState] = useState<'idle' | 'saving' | 'done'>('idle')
  const [passkeyError, setPasskeyError] = useState<string | null>(null)
  const [result, addUser] = useMutation<{ addUser: { user: User } }, { input: { email: string; role: 'ADMIN' } }>(ADD_USER_MUTATION)
  const [configResult, updateConfiguration] = useMutation<{ updateConfiguration: { configuration: Configuration } }, { input: UpdateConfigurationInput }>(UPDATE_CONFIGURATION_MUTATION)
  const passkeyOnly = setup.passkeyEnabled && !setup.emailEnabled && !setup.googleEnabled
  const registeredEmail = setup.registeredEmail
  const passkeyAvailable = typeof window !== 'undefined' && 'PublicKeyCredential' in window
  const providers = enabledProviderNames(setup)

  async function submit() {
    const trimmed = email.trim()
    if (!trimmed) return
    const response = await addUser({ input: { email: trimmed, role: 'ADMIN' } })
    if (!response.error) {
      setup.updateSetup({ registeredEmail: trimmed })
      if (setup.passkeyEnabled) {
        const configResponse = await updateConfiguration({ input: { passKeyAuthn: { enabled: true, webauthnRpId: nullIfBlank(setup.webauthnRpId), webauthnRpName: setup.webauthnRpName, webauthnRpOrigins: splitCSV(setup.webauthnRpOrigins) } } })
        if (configResponse.error) return
        return
      }
      navigate('/setup/owners')
    }
  }

  async function registerPasskey() {
    if (!registeredEmail || !passkeyName.trim()) return
    setPasskeyState('saving')
    setPasskeyError(null)
    try {
      await runPasskeyRegistration(passkeyName.trim(), registeredEmail)
      setPasskeyState('done')
    } catch (e) {
      setPasskeyError(e instanceof Error ? e.message : 'Passkey registration failed')
      setPasskeyState('idle')
    }
  }

  function continueNext() {
    navigate('/setup/owners')
  }

  return (
    <div>
      <SetupHeading subtitle="Added with admin permissions. Invitation delivery may no-op until SMTP is configured, but the user will be authorized for OAuth sign-in after setup." title="Initial admin" />

      <SetupTextField className="mt-4 max-w-[400px]" disabled={Boolean(registeredEmail)} label="Admin email address" onChange={setEmail} placeholder="you@example.com" type="email" value={email} />
      <p className="mt-3 flex items-center gap-2 text-xs text-text-muted">
        Selected providers
        {providers.length === 0 ? <SetupBadge>None</SetupBadge> : providers.map((provider) => <SetupBadge key={provider}>{provider}</SetupBadge>)}
      </p>

      {result.error ? <SetupMessage tone="negative">{result.error.message}</SetupMessage> : null}
      {configResult.error ? <SetupMessage tone="negative">{configResult.error.message}</SetupMessage> : null}

      {setup.passkeyEnabled && registeredEmail ? (
        <section className="mt-4 max-w-[400px] rounded-md border border-border bg-surface-2 px-4 py-3.5">
          <h2 className="text-[13px] font-semibold text-text-1">Register an admin passkey</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {passkeyOnly ? 'Passkeys are the only sign-in method. Register one now or you will be locked out after setup.' : 'Add a passkey now, or skip and add one later from Settings.'}
          </p>
          {!passkeyAvailable ? <SetupMessage tone="negative">This browser does not support passkeys. Complete setup on a device with platform passkey support.</SetupMessage> : null}
          <SetupTextField className="mt-3" disabled={passkeyState === 'done'} label="Passkey name" onChange={setPasskeyName} value={passkeyName} />
          {passkeyState === 'done' ? <SetupMessage tone="positive">Passkey registered.</SetupMessage> : null}
          {passkeyError ? <SetupMessage tone="negative">{passkeyError}</SetupMessage> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={!passkeyAvailable || passkeyState === 'saving' || passkeyState === 'done' || !passkeyName.trim()} onClick={() => void registerPasskey()}>{passkeyState === 'saving' ? 'Waiting...' : 'Register passkey'}</Button>
            {!passkeyOnly ? <Button onClick={continueNext} variant="ghost">Skip for now</Button> : null}
          </div>
        </section>
      ) : null}

      <SetupActions>
        <Button onClick={() => navigate('/setup/oauth-setup')} variant="secondary">Back</Button>
        {registeredEmail && setup.passkeyEnabled ? (
          <Button disabled={passkeyOnly && passkeyState !== 'done'} onClick={continueNext}>Continue</Button>
        ) : (
          <Button disabled={result.fetching || configResult.fetching || !email.trim()} onClick={submit}>{result.fetching || configResult.fetching ? 'Adding...' : 'Continue'}</Button>
        )}
      </SetupActions>
    </div>
  )
}
