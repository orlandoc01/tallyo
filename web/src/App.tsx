import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router'
import { Component, useEffect, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { AuthProvider } from './auth/AuthContext'
import { completeOAuthCallback } from './auth/oauth'
import { listPasskeys } from './auth/webauthn'
import { useAuth } from './auth/useAuth'
import { AuthGate } from './components/common/AuthGate'
import { Button } from './components/common/Button'
import { AuthPageShell } from './components/common/SignInPanel'
import { AppShell } from './components/layout/AppShell'
import { BudgetPage } from './pages/BudgetPage'
import { CashFlowPage } from './pages/CashFlowPage'
import { EmailChallengePage } from './pages/EmailChallengePage'
import { LoginPage } from './pages/LoginPage'
import { AccountsPage } from './pages/AccountsPage'
import { NetWorthPage } from './pages/NetWorthPage'
import { PortfolioPage } from './pages/PortfolioPage'
import { RecurringPage } from './pages/RecurringPage'
import { ReportsPage } from './pages/ReportsPage'
import { ReviewPage } from './pages/ReviewPage'
import { SettingsPage } from './pages/SettingsPage'
import { TransactionsPage } from './pages/TransactionsPage'
import { AuthConfigStep } from './pages/setup/AuthConfigStep'
import { CompleteStep } from './pages/setup/CompleteStep'
import { OwnersStep } from './pages/setup/OwnersStep'
import { PasswordSetupStep } from './pages/setup/PasswordSetupStep'
import { ConnectionsStep } from './pages/setup/ConnectionsStep'
import { RegisterAccountStep } from './pages/setup/RegisterAccountStep'
import { SecurityChoiceStep } from './pages/setup/SecurityChoiceStep'
import { SetupLayout } from './pages/setup/SetupLayout'
import { SetupProvider } from './pages/setup/SetupContext'
import { WelcomeStep } from './pages/setup/WelcomeStep'
import { useTheme } from './hooks/useTheme'
import { NavLayoutProvider } from './hooks/NavLayoutProvider'
import { SectionHistoryProvider } from './hooks/SectionHistoryProvider'
import { usePermissions } from './hooks/usePermissions'
import { reviewRoute } from './hooks/navItems'
import { ACCOUNTS_PATHS, NET_WORTH_PATHS, PORTFOLIO_PATHS, REVIEW_PATHS, SETTINGS_PATHS, TRANSACTION_PATHS } from './routes'
import { currentBudgetPath } from './utils/dates'

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  /* v8 ignore next -- @preserve */
  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  /* v8 ignore next -- @preserve */
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App render error:', error, info)
  }

  render() {
    /* v8 ignore if -- @preserve */
    if (this.state.error) {
      return (
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-paper p-8 text-center">
          <p className="text-lg font-semibold text-neutral-800">Something went wrong.</p>
          <p className="text-sm text-neutral-500">{this.state.error.message}</p>
          <Button onClick={() => window.location.reload()} type="button">
            Reload page
          </Button>
        </main>
      )
    }
    return this.props.children
  }
}

export function App() {
  return (
    <AppErrorBoundary>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  )
}

function AppRoutes() {
  useTheme()
  const location = useLocation()
  const { isAuthenticated, isLoading, masterPasswordStatus, emailAuthEnabled, googleAuthEnabled, webauthnEnabled, disableAllAuth, disableTransactionTracking, disableWealthTracking, setupComplete, login, loginWithEmail, loginWithPasskey, loginWithMasterPassword } = useAuth()
  const { canRead, canWrite } = usePermissions()
  const masterPasswordEnabled = masterPasswordStatus !== 'DISABLED'
  const setupPath = location.pathname.startsWith('/setup')
  const passkeyOnly = webauthnEnabled && !emailAuthEnabled && !googleAuthEnabled
  const signingIn = <main className="flex min-h-screen items-center justify-center bg-paper text-neutral-500">Signing in...</main>
  const authGate = <AuthGate onLogin={login} onLoginWithEmail={loginWithEmail} onLoginWithPasskey={loginWithPasskey} onLoginWithMasterPassword={loginWithMasterPassword} masterPasswordEnabled={masterPasswordEnabled} emailAuthEnabled={emailAuthEnabled} googleAuthEnabled={googleAuthEnabled} webauthnEnabled={webauthnEnabled} />

  useEffect(() => {
    if (!setupComplete || isLoading || !isAuthenticated || !passkeyOnly || location.pathname === '/settings/access') return
    let cancelled = false
    listPasskeys()
      .then((items) => {
        if (!cancelled && items.length === 0) window.location.assign(`${import.meta.env.BASE_URL}settings/access?onboarding=passkey`)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [isAuthenticated, isLoading, location.pathname, passkeyOnly, setupComplete])

  if (location.pathname === '/auth/callback') {
    return <AuthCallback />
  }

  if (location.pathname === '/auth/email-challenge') {
    return <EmailChallengePage />
  }

  if (location.pathname === '/auth/login') {
    return <LoginPage />
  }

  if (!setupComplete) {
    if (isLoading) {
      return signingIn
    }
    if (!disableAllAuth && !isAuthenticated) {
      return authGate
    }
    if (!setupPath) {
      return <Navigate replace to="/setup/welcome" />
    }
    return (
      <SetupProvider>
        <Routes>
          <Route element={<SetupLayout />} path="setup">
            <Route element={<Navigate replace to="/setup/welcome" />} index />
            <Route element={<WelcomeStep />} path="welcome" />
            <Route element={<SecurityChoiceStep />} path="security" />
            <Route element={<PasswordSetupStep />} path="password-setup" />
            <Route element={<AuthConfigStep />} path="oauth-setup" />
            <Route element={<RegisterAccountStep />} path="register" />
            <Route element={<OwnersStep />} path="owners" />
            <Route element={<ConnectionsStep />} path="connections" />
            <Route element={<CompleteStep />} path="complete" />
            <Route element={<Navigate replace to="/setup/welcome" />} path="*" />
          </Route>
        </Routes>
      </SetupProvider>
    )
  }

  if (setupPath) {
    return <Navigate replace to="/" />
  }

  if (isLoading) {
    return signingIn
  }

  if (!isAuthenticated) {
    return authGate
  }

  const canReadAccounts = canRead('accounts')
  const canReadBudgets = canRead('budgets')
  const canReadCashflow = canRead('cashflow')
  const canReadSpending = canRead('spending')
  const canReadTransactions = canRead('transactions')
  const canReadWealth = canRead('wealth')
  const canReadPortfolio = canRead('portfolio')
  const canWriteAccounts = canWrite('accounts')
  const canWriteTransactions = canWrite('transactions')
  const canReviewBalances = canWrite('wealth') && !disableWealthTracking
  const canReviewAssets = canWrite('assets') && !disableWealthTracking
  const defaultRoute = defaultAuthenticatedRoute({
    canReadAccounts,
    canReadBudgets,
    canReadCashflow,
    canReadPortfolio,
    canReadSpending,
    canReadWealth,
    disableTransactionTracking,
    disableWealthTracking,
  })
  const defaultReviewRoute = reviewRoute(disableTransactionTracking, canWriteTransactions, canWriteAccounts, canReviewBalances, canReviewAssets)
  const guardedPage = (allowed: boolean, element: ReactNode) => allowed ? element : <Navigate replace to={defaultRoute} />
  const transactionFeaturePage = (allowed: boolean, element: ReactNode) => guardedPage(!disableTransactionTracking && allowed, element)
  const wealthPage = (allowed: boolean, element: ReactNode) => guardedPage(!disableWealthTracking && allowed, element)
  const routedPages = [
    { element: wealthPage(canReadWealth, <NetWorthPage />), paths: NET_WORTH_PATHS },
    { element: wealthPage(canReadPortfolio, <PortfolioPage />), paths: PORTFOLIO_PATHS },
    { element: transactionFeaturePage(canReadTransactions, <TransactionsPage />), paths: TRANSACTION_PATHS },
    { element: <ReviewPage />, paths: REVIEW_PATHS },
    { element: guardedPage(canReadAccounts, <AccountsPage />), paths: ACCOUNTS_PATHS },
    { element: <SettingsPage />, paths: SETTINGS_PATHS },
  ]

  return (
    <NavLayoutProvider>
      <SectionHistoryProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route element={<Navigate replace to={defaultRoute} />} index />
            <Route element={transactionFeaturePage(canReadSpending, <Navigate replace to="/expenses/breakdown" />)} path="expenses" />
            <Route element={transactionFeaturePage(canReadSpending, <ReportsPage />)} path="expenses/:tab" />
            <Route element={transactionFeaturePage(canReadCashflow, <CashFlowPage />)} path="cash-flow" />
            <Route element={transactionFeaturePage(canReadBudgets, <Navigate replace to={currentBudgetPath()} />)} path="budgets" />
            <Route element={transactionFeaturePage(canReadBudgets, <BudgetPage />)} path="budgets/:month" />
            <Route element={defaultReviewRoute === '/' ? <Navigate replace to={defaultRoute} /> : <Navigate replace to={defaultReviewRoute} />} path="review" />
            <Route element={transactionFeaturePage(canReadTransactions, <RecurringPage />)} path="recurring" />
            <Route element={<Navigate replace to={!disableTransactionTracking && canReadTransactions ? '/settings/rules' : '/settings/general'} />} path="rules" />
            <Route element={<Navigate replace to={disableTransactionTracking ? '/settings/general' : '/settings/categories'} />} path="categories" />
            <Route element={<Navigate replace to="/settings/access" />} path="access" />
            {routedPages.flatMap(({ element, paths }) => paths.map((path) => <Route element={element} key={path} path={path} />))}
            <Route element={<Navigate replace to={defaultRoute} />} path="*" />
          </Route>
        </Routes>
      </SectionHistoryProvider>
    </NavLayoutProvider>
  )
}

function defaultAuthenticatedRoute({
  canReadAccounts,
  canReadBudgets,
  canReadCashflow,
  canReadPortfolio,
  canReadSpending,
  canReadWealth,
  disableTransactionTracking,
  disableWealthTracking,
}: {
  canReadAccounts: boolean
  canReadBudgets: boolean
  canReadCashflow: boolean
  canReadPortfolio: boolean
  canReadSpending: boolean
  canReadWealth: boolean
  disableTransactionTracking: boolean
  disableWealthTracking: boolean
}) {
  if (!disableTransactionTracking && canReadSpending) return '/expenses/breakdown'
  if (!disableTransactionTracking && canReadCashflow) return '/cash-flow'
  if (!disableTransactionTracking && canReadBudgets) return currentBudgetPath()
  if (!disableWealthTracking && canReadWealth) return '/net-worth'
  if (!disableWealthTracking && canReadPortfolio) return '/portfolio'
  if (canReadAccounts) return '/accounts'
  return '/settings/general'
}

function AuthCallback() {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    completeOAuthCallback(window.location.search)
      .then(() => window.location.assign(readAndClearPostLoginRedirect() ?? `${import.meta.env.BASE_URL}expenses/breakdown`))
      .catch((e) => setError(e instanceof Error ? e.message : 'Sign-in failed'))
  }, [])

  return (
    <AuthPageShell>
      <p className="text-neutral-600">{error ?? 'Completing sign-in...'}</p>
    </AuthPageShell>
  )
}

function readAndClearPostLoginRedirect() {
  const match = document.cookie.match(/(?:^|;\s*)st_post_login=([^;]+)/)
  if (!match) return null
  document.cookie = 'st_post_login=; max-age=0; path=/'
  return decodeURIComponent(match[1])
}
