import clsx from 'clsx'
import { CheckSquare, ChevronLeft, LogOut, Menu, Settings, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../../auth/useAuth'
import { usePermissions } from '../../hooks/usePermissions'
import { ALL_NAV_ITEMS, MAX_NAVBAR_ITEMS, navItemAllowed, navItemVisible, reviewRoute } from '../../hooks/navItems'
import { isStickySection, sectionOf } from '../../hooks/sectionHistory'
import { useNavLayout } from '../../hooks/useNavLayout'
import { useReviewStatus } from '../../hooks/useReviewStatus'
import { useSectionHistory } from '../../hooks/useSectionHistory'
import { MobileHeaderProvider } from './MobileHeaderContext'
import { useMobileHeader } from './useMobileHeader'
import { Sidebar } from './Sidebar'
import { MobileFilterButton } from '../common/MobileFilterDropdown'
import { IconButton } from '../common/Button'
import { mobileHeaderActionClass } from '../common/mobileHeaderActionClass'
import { TransactionSelectionProvider } from '../transactions/TransactionSelectionProvider'
import { useTransactionSelection } from '../transactions/useTransactionSelection'
import { NavIcon } from './NavIcon'
import { DemoBanner } from './DemoBanner'
import { settingsTabFromPath } from '../../hooks/settingsTabs'
import { mobileTitle } from '../../hooks/mobileTitle'

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'app-sidebar-collapsed'

function loadSidebarCollapsed() {
  try {
    const raw = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)
    if (raw === null) return true
    return raw === '1'
  } catch {
    return true
  }
}

function MobileHeader({ hasReviewItems }: { hasReviewItems: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const { disableTransactionTracking, disableWealthTracking, logout } = useAuth()
  const { canRead, canWrite } = usePermissions()
  const canWriteTransactions = canWrite('transactions')
  const canWriteAccounts = canWrite('accounts')
  const canReviewBalances = canWrite('wealth') && !disableWealthTracking
  const canReviewAssets = canWrite('assets') && !disableWealthTracking
  const { layout } = useNavLayout()
  const { stickyNavProps } = useSectionHistory()
  const mobile = useMobileHeader()
  const transactionSelection = useTransactionSelection()

  function closeMenu() {
    setMenuOpen(false)
  }

  function handleSignOut() {
    closeMenu()
    logout()
  }

  const isTransactions = location.pathname === '/transactions' || location.pathname.startsWith('/transactions/')
  const isReports = location.pathname === '/expenses' || location.pathname.startsWith('/expenses/')
  const isCashFlow = location.pathname === '/cash-flow'
  const showFilters = isTransactions || isReports || isCashFlow
  const isSettingsSubpage = settingsTabFromPath(location.pathname) !== null

  const menuNavLinkClass = ({ isActive }: { isActive: boolean }) =>
    clsx(
      'flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition',
      isActive ? 'bg-raised-nav text-text-1' : 'text-text-2 hover:bg-raised',
    )

  const menuItemClassName = (defaultTo: string) => isStickySection(sectionOf(defaultTo))
    ? ({ isActive }: { isActive: boolean }) => menuNavLinkClass({
      isActive: isActive || sectionOf(location.pathname) === sectionOf(defaultTo),
    })
    : menuNavLinkClass

  const menuItems = ALL_NAV_ITEMS
    .filter((item) => layout.sidemenu.includes(item.id))
    .sort((a, b) => layout.sidemenu.indexOf(a.id) - layout.sidemenu.indexOf(b.id))
    .filter((item) => navItemVisible(item, disableTransactionTracking, disableWealthTracking))
    .filter((item) => navItemAllowed(item, canRead, canWrite))
    .filter((item) => item.id !== 'review' || canWriteTransactions || canWriteAccounts || canReviewBalances || canReviewAssets)

  return (
    <>
      {/* Mobile header bar */}
      <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-2.5 border-b border-border bg-surface px-3 lg:hidden">
        {isSettingsSubpage ? (
          <IconButton ariaLabel="Back to settings" className="touch-manipulation" onClick={() => navigate('/settings')}>
            <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
          </IconButton>
        ) : (
          <IconButton ariaLabel="Open menu" className="touch-manipulation" onClick={() => setMenuOpen(true)}>
            <Menu className="h-5 w-5" strokeWidth={1.8} />
          </IconButton>
        )}
        <span className="flex-1 truncate text-base font-semibold tracking-[-0.2px] text-text-1">{mobileTitle(location.pathname)}</span>
        <div className="flex items-center gap-2.5">
          {mobile.headerActions ?? (
            <>
              {isTransactions ? (
                <button
                  aria-label={transactionSelection.isBulkMode ? 'Exit bulk select' : 'Bulk actions'}
                  aria-pressed={transactionSelection.isBulkMode}
                  className={mobileHeaderActionClass('w-9 touch-manipulation', transactionSelection.isBulkMode)}
                  onClick={() => (transactionSelection.isBulkMode ? transactionSelection.exitBulkMode() : transactionSelection.enterBulkMode())}
                  type="button"
                >
                  {transactionSelection.isBulkMode ? <X className="h-4 w-4" /> : <CheckSquare className="h-4 w-4" />}
                </button>
              ) : null}
              {showFilters ? (
                <MobileFilterButton active={mobile.filterOpen} highlighted={mobile.filtersActive} onClick={mobile.filterOpen ? mobile.closeFilter : mobile.openFilter} />
              ) : null}
            </>
          )}
        </div>
      </header>

      {/* Mobile hamburger panel — slides from left */}
      {menuOpen ? (
        <>
          <div aria-hidden className="fixed inset-0 z-40 bg-overlay lg:hidden" onClick={closeMenu} />
          <div className="fixed inset-y-0 left-0 z-50 flex w-[250px] flex-col border-r border-border bg-surface px-2 py-3 lg:hidden">
            <div className="flex h-10 shrink-0 items-center justify-between px-2.5">
              <span className="text-[17px] font-bold tracking-[-0.3px] text-text-1">tallyo</span>
              <IconButton ariaLabel="Close menu" onClick={closeMenu} size="sm">
                <X className="h-4 w-4" />
              </IconButton>
            </div>

            <nav aria-label="Menu navigation" className="mt-2 flex flex-1 flex-col gap-0.5">
              {menuItems.map((item) => {
                const Icon = item.icon
                return (
                  <NavLink
                    className={menuItemClassName(item.to)}
                    key={item.id}
                    {...(item.id === 'review' ? { onClick: closeMenu, to: reviewRoute(disableTransactionTracking, canWriteTransactions, canWriteAccounts, canReviewBalances, canReviewAssets) } : stickyNavProps(item.to, closeMenu))}
                  >
                    <NavIcon Icon={Icon} needsReview={item.id === 'review' && hasReviewItems} />
                    {item.label}
                  </NavLink>
                )
              })}
            </nav>

            <div className="mx-0.5 my-1.5 border-t border-border" />
            <NavLink className={menuNavLinkClass} onClick={closeMenu} to="/settings">
              <Settings aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.6} />
              Settings
            </NavLink>
            <button
              className={clsx('w-full', menuNavLinkClass({ isActive: false }))}
              onClick={handleSignOut}
              type="button"
            >
              <LogOut aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.6} />
              Sign out
            </button>
          </div>
        </>
      ) : null}
    </>
  )
}

export function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsed)

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed ? '1' : '0')
    } catch {
      // localStorage may be unavailable
    }
  }, [sidebarCollapsed])

  return (
    <MobileHeaderProvider>
      <TransactionSelectionProvider>
        <AppShellInner collapsed={sidebarCollapsed} onCollapsedChange={setSidebarCollapsed} />
      </TransactionSelectionProvider>
    </MobileHeaderProvider>
  )
}

function AppShellInner({ collapsed, onCollapsedChange }: { collapsed: boolean; onCollapsedChange: (value: boolean) => void }) {
  const { canRead, canWrite } = usePermissions()
  const { disableTransactionTracking, disableWealthTracking } = useAuth()
  const { layout } = useNavLayout()
  const canWriteTransactions = canWrite('transactions')
  const canWriteAccounts = canWrite('accounts')
  const canReviewBalances = canWrite('wealth') && !disableWealthTracking
  const canReviewAssets = canWrite('assets') && !disableWealthTracking
  const { hasReviewItems } = useReviewStatus({
    transactions: canWriteTransactions && !disableTransactionTracking,
    accounts: canWriteAccounts,
    balances: canReviewBalances,
    assets: canReviewAssets,
  })

  const navItems = ALL_NAV_ITEMS
    .filter((item) => layout.navbar.includes(item.id))
    .sort((a, b) => layout.navbar.indexOf(a.id) - layout.navbar.indexOf(b.id))
    .filter((item) => navItemVisible(item, disableTransactionTracking, disableWealthTracking))
    .filter((item) => navItemAllowed(item, canRead, canWrite))
    .filter((item) => item.id !== 'review' || canWriteTransactions || canWriteAccounts || canReviewBalances || canReviewAssets)
    .slice(0, MAX_NAVBAR_ITEMS)

  return (
    <>
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg"
        href="#main-content"
      >
        Skip to main content
      </a>
      <div className="flex min-h-screen bg-paper">
        <Sidebar collapsed={collapsed} hasReviewItems={hasReviewItems} onCollapsedChange={onCollapsedChange} />

        <div className="min-w-0 flex-1">
          <MobileHeader hasReviewItems={hasReviewItems} />

          <main className="mx-auto w-full max-w-[1600px] px-3 pb-[calc(102px+env(safe-area-inset-bottom,0px))] pt-[68px] lg:px-6 lg:pb-10 lg:pt-4" id="main-content">
            <DemoBanner />
            <Outlet />
          </main>
        </div>
      </div>

      <MobileBottomNav canReviewAssets={canReviewAssets} canReviewBalances={canReviewBalances} canWriteAccounts={canWriteAccounts} canWriteTransactions={canWriteTransactions} disableTransactionTracking={disableTransactionTracking} hasReviewItems={hasReviewItems} navItems={navItems} />
    </>
  )
}

function MobileBottomNav({
  canReviewAssets,
  canReviewBalances,
  canWriteAccounts,
  canWriteTransactions,
  disableTransactionTracking,
  hasReviewItems,
  navItems,
}: {
  canReviewAssets: boolean
  canReviewBalances: boolean
  canWriteAccounts: boolean
  canWriteTransactions: boolean
  disableTransactionTracking: boolean
  hasReviewItems: boolean
  navItems: typeof ALL_NAV_ITEMS
}) {
  const location = useLocation()
  const { stickyNavProps } = useSectionHistory()

  if (typeof document === 'undefined') return null

  // -------------------------------------------------------------------------
  // The mobile bottom nav has regressed FOUR times with the same symptom (the
  // bar "floats to the center" on mobile as the user scrolls). Each prior fix
  // patched one failure mode but left another reachable. The layers below all
  // have to be in place at once — do not relax any of them without checking
  // issues #17, #52, #62, #78 first.
  //
  //   1. Portal to `document.body`: keeps the nav out of any ancestor that
  //      could establish a new containing block via `transform`, `filter`,
  //      `perspective`, or `contain` and break `position: fixed`.
  //   2. Inline `position`/`bottom`/`left`/`right`/`top`/`margin`: survive a
  //      class-string refactor that strips the Tailwind utilities. `top: auto`
  //      and `margin: 0` are explicit defenses against a stray `top: ...` or
  //      external margin rule stretching the bar across the viewport.
  //   3. `mobile-bottom-nav` class (in `styles/index.css`): re-declares the
  //      same positioning with `!important`, so any future external CSS that
  //      tries to override the inline styles still loses. Also rebases the
  //      `transform` containing block via `html, body { transform: none
  //      !important }`, so descendant utility classes (e.g., `scale-*`) can
  //      never silently turn the root into a containing block.
  //
  // The companion regression test `mobile bottom nav positioning on <route>`
  // in `App.integration.test.tsx` asserts the matching DOM invariants on
  // every authenticated route. If you touch this file, run it.
  // -------------------------------------------------------------------------
  return createPortal(
    <nav
      aria-label="Mobile navigation"
      className="mobile-bottom-nav z-30 flex min-h-[78px] border-t border-border bg-surface px-2 pt-1.5 lg:hidden"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        top: 'auto',
        width: '100vw',
        maxWidth: 'none',
        margin: 0,
        paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
      }}
    >
      {navItems.map((item) => {
        const Icon = item.icon
        return (
          <NavLink
            className={({ isActive }) =>
              clsx(
                'flex flex-1 flex-col items-center gap-1 text-[11px] font-medium transition',
                isActive || (isStickySection(sectionOf(item.to)) && sectionOf(location.pathname) === sectionOf(item.to)) ? 'text-text-1 [&>span]:bg-raised-nav' : 'text-text-muted',
              )
            }
            end={item.end}
            key={item.id}
            {...(item.id === 'review' ? { to: reviewRoute(disableTransactionTracking, canWriteTransactions, canWriteAccounts, canReviewBalances, canReviewAssets) } : stickyNavProps(item.to))}
          >
            <span className="flex h-[30px] w-[52px] items-center justify-center rounded-lg">
              <NavIcon Icon={Icon} iconClassName="h-5 w-5" needsReview={item.id === 'review' && hasReviewItems} />
            </span>
            {item.label}
          </NavLink>
        )
      })}
    </nav>,
    document.body,
  )
}
