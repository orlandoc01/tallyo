import { useState } from 'react'
import { useAuth } from '../../auth/useAuth'

import type { Configuration } from '../../types/graphql'
import { waitForHealthz } from '../../utils/healthz'
import { EmptyState } from '../common/EmptyState'
import { SectionLabel } from '../common/FormControls'
import { ConfigCard, ConfigStatus, pickDirtyFields, TextInput, ToggleInput } from './ConfigFormControls'
import { nullIfBlank, splitCSV } from './configParsing'
import { type RestartPhase, ServerRestartOverlay } from './ServerRestartOverlay'
import { useConfigurationForm } from './useConfigFormState'

type FormState = {
  masterPasswordEnabled: boolean
  masterPassword: string
  disableAllAuth: boolean
  oauthIssuerUrl: string
  frontendRedirectUris: string
  accessTokenLifetime: string
  refreshTokenLifetime: string
  devCorsAllowedOrigins: string
  googleEnabled: boolean
  googleClientId: string
  googleClientSecret: string
  emailEnabled: boolean
  smtpHost: string
  smtpPort: string
  smtpFrom: string
  smtpUsername: string
  smtpPassword: string
  passKeyEnabled: boolean
  webauthnRpId: string
  webauthnRpName: string
  webauthnRpOrigins: string
  trustedProxyCidrs: string
}

type SectionKey = 'authorization' | 'google' | 'email' | 'passKey' | 'security'
type FieldKey = keyof FormState

const emptyState: FormState = {
  masterPasswordEnabled: false,
  masterPassword: '',
  disableAllAuth: false,
  oauthIssuerUrl: '',
  frontendRedirectUris: '',
  accessTokenLifetime: '15m0s',
  refreshTokenLifetime: '168h0m0s',
  devCorsAllowedOrigins: '',
  googleEnabled: false,
  googleClientId: '',
  googleClientSecret: '',
  emailEnabled: false,
  smtpHost: '',
  smtpPort: '587',
  smtpFrom: '',
  smtpUsername: '',
  smtpPassword: '',
  passKeyEnabled: false,
  webauthnRpId: '',
  webauthnRpName: 'Tallyo',
  webauthnRpOrigins: '',
  trustedProxyCidrs: '',
}

export function SecurityConfigTab() {
  const { masterPasswordStatus } = useAuth()
  const { canReadSettings, canWriteSettings, configuration, dirtyFields, error, fetching, mutationResult, refetch, save, setState, state, updateConfiguration } = useConfigurationForm(makeFormState)
  const [restartPhase, setRestartPhase] = useState<RestartPhase>('idle')

  if (!canReadSettings) {
    return <EmptyState title="Settings access required" description="Your account cannot view server configuration." />
  }

  async function confirmSaveAuthorization() {
    setRestartPhase('restarting')
    const result = await updateConfiguration({
      input: {
        authorization: {
          masterPassword: state.masterPasswordEnabled ? nullIfBlank(state.masterPassword) : null,
          disableAllAuth: state.disableAllAuth,
          oauthIssuerUrl: state.oauthIssuerUrl.trim(),
          frontendRedirectUris: splitCSV(state.frontendRedirectUris),
          accessTokenLifetime: state.accessTokenLifetime.trim(),
          refreshTokenLifetime: state.refreshTokenLifetime.trim(),
          devCorsAllowedOrigins: splitCSV(state.devCorsAllowedOrigins),
        },
      },
    })
    if (result.error) {
      setRestartPhase('idle')
      return
    }
    await waitForHealthz()
    setRestartPhase('idle')
    refetch({ requestPolicy: 'network-only' })
  }

  const sectionDirtyFields = {
    authorization: pickDirtyFields(dirtyFields, ['masterPasswordEnabled', 'masterPassword', 'disableAllAuth', 'oauthIssuerUrl', 'frontendRedirectUris', 'accessTokenLifetime', 'refreshTokenLifetime', 'devCorsAllowedOrigins']),
    google: pickDirtyFields(dirtyFields, ['googleEnabled', 'googleClientId', 'googleClientSecret']),
    email: pickDirtyFields(dirtyFields, ['emailEnabled', 'smtpHost', 'smtpPort', 'smtpFrom', 'smtpUsername', 'smtpPassword']),
    passKey: pickDirtyFields(dirtyFields, ['passKeyEnabled', 'webauthnRpId', 'webauthnRpName', 'webauthnRpOrigins']),
    security: pickDirtyFields(dirtyFields, ['trustedProxyCidrs']),
  } satisfies Record<SectionKey, Set<FieldKey>>

  const oauthActive = state.googleEnabled || state.emailEnabled || state.passKeyEnabled

  return (
    <section className="space-y-5">
      <p className="max-w-2xl text-sm text-neutral-500">Secret fields are obfuscated. Some changes may require a server restart.</p>

      <ConfigStatus configuration={configuration} error={error} fetching={fetching} mutationError={mutationResult.error} />

      <ServerRestartOverlay onCancel={() => setRestartPhase('idle')} onConfirm={confirmSaveAuthorization} phase={restartPhase} />

      {!fetching && !error && configuration ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ConfigCard dirty={sectionDirtyFields.authorization.size > 0} title="Authorization" disabled={!canWriteSettings || mutationResult.fetching || (state.masterPasswordEnabled && !state.masterPassword.trim())} onSubmit={() => setRestartPhase('confirm')}>
            <ToggleInput dirty={sectionDirtyFields.authorization.has('disableAllAuth')} label="Disable all auth" checked={state.disableAllAuth} onChange={(disableAllAuth) => setState((s) => ({ ...s, disableAllAuth }))} />
            <div className={`space-y-4${state.disableAllAuth ? ' pointer-events-none select-none opacity-40' : ''}`}>
            <SectionLabel as="h4" tone="muted">Master Password</SectionLabel>
            <ToggleInput
              dirty={sectionDirtyFields.authorization.has('masterPasswordEnabled') || sectionDirtyFields.authorization.has('masterPassword')}
              label="Master password"
              warning={masterPasswordStatus === 'ENV_VAR_OVERRIDE' ? 'Currently set by ENV VAR, which overrides whatever you set here' : undefined}
              checked={state.masterPasswordEnabled}
              onChange={(masterPasswordEnabled) => setState((s) => ({ ...s, masterPasswordEnabled, masterPassword: masterPasswordEnabled ? s.masterPassword : '' }))}
            />
            <input
              aria-label="Master password value"
              className={`w-full rounded-lg border px-3 py-2 font-mono text-sm transition-colors ${state.masterPasswordEnabled ? 'border-neutral-200 text-neutral-950' : 'cursor-not-allowed border-neutral-100 bg-neutral-50 text-neutral-400'}`}
              disabled={!state.masterPasswordEnabled}
              onChange={(e) => setState((s) => ({ ...s, masterPassword: e.target.value }))}
              placeholder={state.masterPasswordEnabled ? 'Enter new password' : '—'}
              type="password"
              value={state.masterPassword}
            />
            <hr className="border-neutral-100" />
            <div className="flex items-center gap-2">
              <SectionLabel as="h4" tone="muted">OAuth</SectionLabel>
              {!oauthActive ? <span className="text-xs text-neutral-400">(must enable Email, Google, or Passkey Sign on)</span> : null}
            </div>
            <TextInput disabled={oauthActive === false} dirty={sectionDirtyFields.authorization.has('oauthIssuerUrl')} label="Issuer URL" value={state.oauthIssuerUrl} onChange={(oauthIssuerUrl) => setState((s) => ({ ...s, oauthIssuerUrl }))} />
            <TextInput disabled={oauthActive === false} dirty={sectionDirtyFields.authorization.has('frontendRedirectUris')} label="Frontend redirect URIs" value={state.frontendRedirectUris} onChange={(frontendRedirectUris) => setState((s) => ({ ...s, frontendRedirectUris }))} />
            <TextInput disabled={oauthActive === false} dirty={sectionDirtyFields.authorization.has('accessTokenLifetime')} label="Access token lifetime" value={state.accessTokenLifetime} onChange={(accessTokenLifetime) => setState((s) => ({ ...s, accessTokenLifetime }))} />
            <TextInput disabled={oauthActive === false} dirty={sectionDirtyFields.authorization.has('refreshTokenLifetime')} label="Refresh token lifetime" value={state.refreshTokenLifetime} onChange={(refreshTokenLifetime) => setState((s) => ({ ...s, refreshTokenLifetime }))} />
            <TextInput disabled={oauthActive === false} dirty={sectionDirtyFields.authorization.has('devCorsAllowedOrigins')} label="Dev CORS allowed origins" placeholder="Optional" value={state.devCorsAllowedOrigins} onChange={(devCorsAllowedOrigins) => setState((s) => ({ ...s, devCorsAllowedOrigins }))} />
            </div>
          </ConfigCard>
          <ConfigCard dirty={sectionDirtyFields.security.size > 0} title="Trusted Proxies" disabled={!canWriteSettings || mutationResult.fetching} onSubmit={() => save({ security: { trustedProxyCidrs: splitCSV(state.trustedProxyCidrs) } })}>
            <p className="text-sm leading-6 text-neutral-500">Reverse-proxy CIDRs trusted for X-Forwarded-For and X-Real-IP rate-limit IPs. Leave empty when directly exposed.</p>
            <TextInput dirty={sectionDirtyFields.security.has('trustedProxyCidrs')} label="Trusted proxy CIDRs" placeholder="Optional" value={state.trustedProxyCidrs} onChange={(trustedProxyCidrs) => setState((s) => ({ ...s, trustedProxyCidrs }))} />
          </ConfigCard>
          <ConfigCard dirty={sectionDirtyFields.passKey.size > 0} title="Passkeys" disabled={!canWriteSettings || mutationResult.fetching} inactive={state.disableAllAuth} inactiveReason="Auth disabled" onSubmit={() => save({ passKeyAuthn: { enabled: state.passKeyEnabled, webauthnRpId: nullIfBlank(state.webauthnRpId), webauthnRpName: state.webauthnRpName, webauthnRpOrigins: splitCSV(state.webauthnRpOrigins) } })}>
            <ToggleInput dirty={sectionDirtyFields.passKey.has('passKeyEnabled')} label="Enabled" checked={state.passKeyEnabled} onChange={(passKeyEnabled) => setState((s) => ({ ...s, passKeyEnabled }))} />
            <TextInput disabled={!state.passKeyEnabled} dirty={sectionDirtyFields.passKey.has('webauthnRpId')} label="RP ID" placeholder="Optional" value={state.webauthnRpId} onChange={(webauthnRpId) => setState((s) => ({ ...s, webauthnRpId }))} />
            <TextInput disabled={!state.passKeyEnabled} dirty={sectionDirtyFields.passKey.has('webauthnRpName')} label="RP name" value={state.webauthnRpName} onChange={(webauthnRpName) => setState((s) => ({ ...s, webauthnRpName }))} />
            <TextInput disabled={!state.passKeyEnabled} dirty={sectionDirtyFields.passKey.has('webauthnRpOrigins')} label="RP origins" placeholder="Optional" value={state.webauthnRpOrigins} onChange={(webauthnRpOrigins) => setState((s) => ({ ...s, webauthnRpOrigins }))} />
          </ConfigCard>
          <ConfigCard dirty={sectionDirtyFields.google.size > 0} title="Google Sign-In" disabled={!canWriteSettings || mutationResult.fetching} inactive={state.disableAllAuth} inactiveReason="Auth disabled" onSubmit={() => save({ googleAuthn: { enabled: state.googleEnabled, googleClientId: nullIfBlank(state.googleClientId), googleClientSecret: nullIfBlank(state.googleClientSecret) } })}>
            <ToggleInput dirty={sectionDirtyFields.google.has('googleEnabled')} label="Enabled" checked={state.googleEnabled} onChange={(googleEnabled) => setState((s) => ({ ...s, googleEnabled }))} />
            <TextInput disabled={!state.googleEnabled} dirty={sectionDirtyFields.google.has('googleClientId')} label="Client ID" value={state.googleClientId} onChange={(googleClientId) => setState((s) => ({ ...s, googleClientId }))} />
            <TextInput disabled={!state.googleEnabled} dirty={sectionDirtyFields.google.has('googleClientSecret')} label="Client secret" value={state.googleClientSecret} onChange={(googleClientSecret) => setState((s) => ({ ...s, googleClientSecret }))} />
          </ConfigCard>
          <ConfigCard dirty={sectionDirtyFields.email.size > 0} title="Email Sign-In" disabled={!canWriteSettings || mutationResult.fetching} inactive={state.disableAllAuth} inactiveReason="Auth disabled" onSubmit={() => save({ emailCodeAuthn: { enabled: state.emailEnabled, smtpHost: nullIfBlank(state.smtpHost), smtpPort: state.smtpPort, smtpFrom: nullIfBlank(state.smtpFrom), smtpUsername: nullIfBlank(state.smtpUsername), smtpPassword: nullIfBlank(state.smtpPassword) } })}>
            <ToggleInput dirty={sectionDirtyFields.email.has('emailEnabled')} label="Enabled" checked={state.emailEnabled} onChange={(emailEnabled) => setState((s) => ({ ...s, emailEnabled }))} />
            <TextInput disabled={!state.emailEnabled} dirty={sectionDirtyFields.email.has('smtpHost')} label="SMTP host" value={state.smtpHost} onChange={(smtpHost) => setState((s) => ({ ...s, smtpHost }))} />
            <TextInput disabled={!state.emailEnabled} dirty={sectionDirtyFields.email.has('smtpPort')} label="SMTP port" value={state.smtpPort} onChange={(smtpPort) => setState((s) => ({ ...s, smtpPort }))} />
            <TextInput disabled={!state.emailEnabled} dirty={sectionDirtyFields.email.has('smtpFrom')} label="SMTP from" value={state.smtpFrom} onChange={(smtpFrom) => setState((s) => ({ ...s, smtpFrom }))} />
            <TextInput disabled={!state.emailEnabled} dirty={sectionDirtyFields.email.has('smtpUsername')} label="SMTP username" value={state.smtpUsername} onChange={(smtpUsername) => setState((s) => ({ ...s, smtpUsername }))} />
            <TextInput disabled={!state.emailEnabled} dirty={sectionDirtyFields.email.has('smtpPassword')} label="SMTP password" value={state.smtpPassword} onChange={(smtpPassword) => setState((s) => ({ ...s, smtpPassword }))} />
          </ConfigCard>
        </div>
      ) : null}
    </section>
  )
}
function makeFormState(configuration: Configuration | null | undefined): FormState {
  if (!configuration) return emptyState

  return {
    masterPasswordEnabled: Boolean(configuration.authorization.masterPassword),
    masterPassword: configuration.authorization.masterPassword ?? '',
    disableAllAuth: configuration.authorization.disableAllAuth,
    oauthIssuerUrl: configuration.authorization.oauthIssuerUrl,
    frontendRedirectUris: configuration.authorization.frontendRedirectUris.join(', '),
    accessTokenLifetime: configuration.authorization.accessTokenLifetime,
    refreshTokenLifetime: configuration.authorization.refreshTokenLifetime,
    devCorsAllowedOrigins: (configuration.authorization.devCorsAllowedOrigins ?? []).join(', '),
    googleEnabled: configuration.googleAuthn.enabled,
    googleClientId: configuration.googleAuthn.googleClientId ?? '',
    googleClientSecret: configuration.googleAuthn.googleClientSecret ?? '',
    emailEnabled: configuration.emailCodeAuthn.enabled,
    smtpHost: configuration.emailCodeAuthn.smtpHost ?? '',
    smtpPort: configuration.emailCodeAuthn.smtpPort,
    smtpFrom: configuration.emailCodeAuthn.smtpFrom ?? '',
    smtpUsername: configuration.emailCodeAuthn.smtpUsername ?? '',
    smtpPassword: configuration.emailCodeAuthn.smtpPassword ?? '',
    passKeyEnabled: configuration.passKeyAuthn.enabled,
    webauthnRpId: configuration.passKeyAuthn.webauthnRpId ?? '',
    webauthnRpName: configuration.passKeyAuthn.webauthnRpName,
    webauthnRpOrigins: (configuration.passKeyAuthn.webauthnRpOrigins ?? []).join(', '),
    trustedProxyCidrs: configuration.security.trustedProxyCidrs.join(', '),
  }
}
