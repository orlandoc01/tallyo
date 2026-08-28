import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation } from 'urql'
import { ADD_USER_MUTATION, UPDATE_CONFIGURATION_MUTATION } from '../../graphql/mutations'
import { runPasskeyRegistration } from '../../auth/webauthn'
import { FormError } from '../../components/common/FormControls'
import { nullIfBlank, splitCSV } from '../../components/settings/configParsing'
import type { Configuration, UpdateConfigurationInput, User } from '../../types/graphql'
import { useSetup } from './useSetup'
import { SetupActions, SetupHeading, SetupTextField, primaryButtonClass, secondaryButtonClass } from './SetupLayout'

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
      <SetupHeading eyebrow="Initial admin" title="Register your admin account" />
      <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-600">This account is added with admin permissions. Invitation delivery may no-op until SMTP is configured, but the user will be authorized for OAuth sign-in after setup.</p>

      <SetupTextField className="mt-8 max-w-xl" disabled={Boolean(registeredEmail)} label="Admin email address" onChange={setEmail} placeholder="you@example.com" type="email" value={email} />
      <p className="mt-3 text-sm text-neutral-500">Selected providers: {[setup.passkeyEnabled ? 'Passkey' : null, setup.emailEnabled ? 'Email' : null, setup.googleEnabled ? 'Google' : null].filter(Boolean).join(', ')}</p>

      {result.error ? <FormError className="mt-5 font-semibold">{result.error.message}</FormError> : null}
      {configResult.error ? <FormError className="mt-5 font-semibold">{configResult.error.message}</FormError> : null}

      {setup.passkeyEnabled && registeredEmail ? (
        <section className="mt-8 max-w-xl rounded-2xl border border-brand-100 bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-neutral-950">Register an admin passkey</p>
          <p className="mt-2 text-sm leading-6 text-neutral-600">
            {passkeyOnly ? 'Passkeys are the only sign-in method. Register one now or you will be locked out after setup.' : 'Add a passkey now, or skip and add one later from Settings.'}
          </p>
          {!passkeyAvailable ? <FormError className="mt-4 font-semibold">This browser does not support passkeys. Complete setup on a device with platform passkey support.</FormError> : null}
          <SetupTextField className="mt-5" disabled={passkeyState === 'done'} label="Passkey name" onChange={setPasskeyName} value={passkeyName} />
          {passkeyState === 'done' ? <p className="mt-4 rounded-2xl bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">Passkey registered.</p> : null}
          {passkeyError ? <FormError className="mt-4 font-semibold">{passkeyError}</FormError> : null}
          <div className="mt-5 flex flex-wrap gap-3">
            <button className={primaryButtonClass} disabled={!passkeyAvailable || passkeyState === 'saving' || passkeyState === 'done' || !passkeyName.trim()} onClick={() => void registerPasskey()} type="button">{passkeyState === 'saving' ? 'Waiting...' : 'Register passkey'}</button>
            {!passkeyOnly ? <button className={secondaryButtonClass} onClick={continueNext} type="button">Skip for now</button> : null}
          </div>
        </section>
      ) : null}

      <SetupActions>
        <button className={secondaryButtonClass} onClick={() => navigate('/setup/oauth-setup')} type="button">Back</button>
        {registeredEmail && setup.passkeyEnabled ? (
          <button className={primaryButtonClass} disabled={passkeyOnly && passkeyState !== 'done'} onClick={continueNext} type="button">Continue</button>
        ) : (
          <button className={primaryButtonClass} disabled={result.fetching || configResult.fetching || !email.trim()} onClick={submit} type="button">{result.fetching || configResult.fetching ? 'Adding...' : 'Continue'}</button>
        )}
      </SetupActions>
    </div>
  )
}
