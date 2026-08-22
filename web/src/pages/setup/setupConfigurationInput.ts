import type { UpdateConfigurationInput } from '../../types/graphql'
import { nullIfBlank, splitCSV } from '../../components/settings/configParsing'
import type { SetupState } from './setupState'

export function buildSetupConfigurationInput(setup: SetupState): UpdateConfigurationInput {
  const input: UpdateConfigurationInput = { setupComplete: true }
  if (!setup.passwordEnabled && !setup.oauthEnabled) return input

  input.authorization = {
    masterPassword: setup.passwordEnabled ? setup.masterPassword : '',
    disableAllAuth: false,
    oauthIssuerUrl: setup.oauthIssuerUrl.trim(),
    frontendRedirectUris: splitCSV(setup.frontendRedirectUris),
    accessTokenLifetime: '15m0s',
    refreshTokenLifetime: '168h0m0s',
    devCorsAllowedOrigins: [],
  }
  if (!setup.oauthEnabled) return input

  input.passKeyAuthn = {
    enabled: setup.passkeyEnabled,
    webauthnRpId: nullIfBlank(setup.webauthnRpId),
    webauthnRpName: setup.webauthnRpName,
    webauthnRpOrigins: splitCSV(setup.webauthnRpOrigins),
  }
  input.googleAuthn = {
    enabled: setup.googleEnabled,
    googleClientId: nullIfBlank(setup.googleClientId),
    googleClientSecret: nullIfBlank(setup.googleClientSecret),
  }
  input.emailCodeAuthn = {
    enabled: setup.emailEnabled,
    smtpHost: nullIfBlank(setup.smtpHost),
    smtpPort: setup.smtpPort,
    smtpFrom: nullIfBlank(setup.smtpFrom),
    smtpUsername: nullIfBlank(setup.smtpUsername),
    smtpPassword: nullIfBlank(setup.smtpPassword),
  }
  return input
}
