import { useCallback, useEffect, useMemo, useState } from 'react'
import { Provider } from 'urql'
import { createGraphqlClient } from '../graphql/client'
import { GENERAL_CONFIGURATION_QUERY } from '../graphql/queries'
import type { GeneralConfiguration } from '../types/graphql'
import { AuthContext, type AuthContextValue, type MasterPasswordStatus } from './authContextValue'
import { beginEmailOAuthLogin } from './emailAuth'
import { beginOAuthLogin } from './oauth'
import { beginPasskeyOAuthLogin } from './webauthn'
import { isPastIdleTimeout, markActivity, useIdleTimeout } from '../hooks/useIdleTimeout'
import { DialogButtonRow } from '../components/common/Button'
import { clearMasterPassword, clearTokens, getMasterPassword, getScopes, hasAccessToken, hasRefreshToken, refreshAccessToken, setMasterPassword } from './tokenStore'

const fullScopes = [
  'read:transactions',
  'write:transactions',
  'read:accounts',
  'write:accounts',
  'read:users',
  'write:users',
  'read:rules',
  'write:rules',
  'read:categories',
  'write:categories',
  'read:spending',
  'read:cashflow',
  'read:owners',
  'write:owners',
  'read:assets',
  'write:assets',
  'read:wealth',
  'write:wealth',
  'read:holdings',
  'read:portfolio',
  'read:budgets',
  'write:budgets',
  'read:tags',
  'write:tags',
  'read:settings',
  'write:settings',
]

type AuthConfigResponse = {
  master_password_status: MasterPasswordStatus
  email_auth_enabled: boolean
  google_auth_enabled: boolean
  webauthn_enabled: boolean
  disable_all_auth: boolean
  setup_complete?: boolean
  scopes: string[]
}

type GeneralConfigurationResponse = {
  generalConfiguration: GeneralConfiguration
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(() => hasAccessToken() || Boolean(getMasterPassword()))
  const [isLoading, setIsLoading] = useState(() => !hasAccessToken() && hasRefreshToken() && !getMasterPassword())
  const [scopes, setScopes] = useState<string[]>(() => getMasterPassword() ? fullScopes : getScopes())
  const [masterPasswordStatus, setMasterPasswordStatus] = useState<MasterPasswordStatus>('DISABLED')
  const [emailAuthEnabled, setEmailAuthEnabled] = useState(false)
  const [googleAuthEnabled, setGoogleAuthEnabled] = useState(false)
  const [webauthnEnabled, setWebauthnEnabled] = useState(false)
  const [authConfigScopes, setAuthConfigScopes] = useState<string[]>([])
  const [disableAllAuth, setDisableAllAuth] = useState(false)
  const [disableTransactionTracking, setDisableTransactionTracking] = useState(false)
  const [disableWealthTracking, setDisableWealthTracking] = useState(false)
  const [hideOwners, setHideOwners] = useState(false)
  const [setupComplete, setSetupComplete] = useState(true)
  const [showIdleWarning, setShowIdleWarning] = useState(false)
  const client = useMemo(() => createGraphqlClient(), [])

  const applyAuthConfig = useCallback((data: AuthConfigResponse) => {
    const configScopes = data.scopes ?? []
    setMasterPasswordStatus(data.master_password_status ?? 'DISABLED')
    setEmailAuthEnabled(data.email_auth_enabled)
    setGoogleAuthEnabled(data.google_auth_enabled)
    setWebauthnEnabled(data.webauthn_enabled ?? false)
    setAuthConfigScopes(configScopes)
    setDisableAllAuth(data.disable_all_auth)
    setSetupComplete(data.setup_complete ?? true)
    if (data.disable_all_auth) {
      setIsAuthenticated(true)
      setScopes(configScopes.length > 0 ? configScopes : fullScopes)
      setIsLoading(false)
    } else if (getMasterPassword()) {
      setScopes(configScopes.length > 0 ? configScopes : fullScopes)
    }
  }, [])

  const refreshAuthConfig = useCallback(async () => {
    const res = await fetch(`${window.location.origin}/auth/config`)
    const data = await res.json() as AuthConfigResponse
    applyAuthConfig(data)
  }, [applyAuthConfig])

  useEffect(() => {
    refreshAuthConfig().catch(() => {
      setMasterPasswordStatus('DISABLED')
      setEmailAuthEnabled(false)
      setGoogleAuthEnabled(false)
      setAuthConfigScopes([])
      setDisableAllAuth(false)
    })
  }, [refreshAuthConfig])

  const refreshGeneralConfiguration = useCallback(async () => {
    const result = await client.query<GeneralConfigurationResponse>(GENERAL_CONFIGURATION_QUERY, {}, { requestPolicy: 'network-only' }).toPromise()
    if (result.error) throw result.error
    const general = result.data?.generalConfiguration
    setDisableTransactionTracking(general?.disableTransactionTracking ?? false)
    setDisableWealthTracking(general?.disableWealthTracking ?? false)
    setHideOwners(general?.hideOwners ?? false)
  }, [client])

  useEffect(() => {
    if (!isAuthenticated) {
      setDisableTransactionTracking(false)
      setDisableWealthTracking(false)
      setHideOwners(false)
      return
    }
    refreshGeneralConfiguration().catch(() => {
      setDisableTransactionTracking(false)
      setDisableWealthTracking(false)
      setHideOwners(false)
    })
  }, [isAuthenticated, refreshGeneralConfiguration])

  useEffect(() => {
    if (isPastIdleTimeout()) {
      clearTokens()
      clearMasterPassword()
      setIsAuthenticated(false)
      setScopes([])
      setIsLoading(false)
      return
    }
    if (hasAccessToken() || getMasterPassword() || !hasRefreshToken()) return
    let cancelled = false
    refreshAccessToken().then((ok) => {
      if (!cancelled) {
        setIsAuthenticated(ok)
        setScopes(getScopes())
        setIsLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const logout = () => {
    clearTokens()
    clearMasterPassword()
    setIsAuthenticated(false)
    setScopes([])
    setShowIdleWarning(false)
  }

  const resetIdleTimer = useIdleTimeout({
    enabled: isAuthenticated && !disableAllAuth,
    onWarn: () => setShowIdleWarning(true),
    onIdle: logout,
  })

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated,
      isLoading,
      scopes,
      masterPasswordStatus,
      emailAuthEnabled,
      googleAuthEnabled,
      webauthnEnabled,
      disableAllAuth,
      disableTransactionTracking,
      disableWealthTracking,
      hideOwners,
      setupComplete,
      login() {
        void beginOAuthLogin()
      },
      loginWithPasskey() {
        return beginPasskeyOAuthLogin()
      },
      loginWithEmail() {
        void beginEmailOAuthLogin()
      },
      refreshGeneralConfiguration,
      loginWithMasterPassword(password: string) {
        setMasterPassword(password)
        markActivity()
        setScopes(authConfigScopes.length > 0 ? authConfigScopes : fullScopes)
        setIsAuthenticated(true)
      },
      logout,
    }),
    [isAuthenticated, isLoading, scopes, masterPasswordStatus, emailAuthEnabled, googleAuthEnabled, webauthnEnabled, authConfigScopes, disableAllAuth, disableTransactionTracking, disableWealthTracking, hideOwners, setupComplete, refreshGeneralConfiguration],
  )

  return (
    <AuthContext.Provider value={value}>
      <Provider value={client}>{children}</Provider>
      {showIdleWarning ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/40 p-4">
          <section aria-modal="true" className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl" role="dialog">
            <h2 className="text-lg font-bold text-neutral-950">Still there?</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-600">You will be signed out in about a minute because of inactivity.</p>
            <DialogButtonRow
              onPrimary={() => { resetIdleTimer(); setShowIdleWarning(false) }}
              onSecondary={logout}
              primaryLabel="Stay signed in"
              secondaryLabel="Sign out now"
            />
          </section>
        </div>
      ) : null}
    </AuthContext.Provider>
  )
}
