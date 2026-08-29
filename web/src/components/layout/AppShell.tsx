import clsx from 'clsx'
import { CheckSquare, LogOut, Menu, Settings, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, Outlet, useLocation } from 'react-router'
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

  const menuNavLinkClass = ({ isActive }: { isActive: boolean }) =>
    clsx(
      'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
      isActive ? 'bg-brand-50 text-brand-700' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950',
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
      <header className="fixed left-0 right-0 top-0 z-30 flex h-12 items-center justify-between border-b border-neutral-200 bg-white px-2 lg:hidden" data-mobile-header>
        {mobile.headerLeading ?? (
          <button
            aria-label="Open menu"
            className={mobileHeaderActionClass('touch-manipulation rounded-xl p-2.5')}
            onClick={() => setMenuOpen(true)}
            type="button"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}
        <div className="flex items-center gap-0.5">
          {mobile.headerActions ?? (
            <>
              {isTransactions ? (
                <div className="relative">
                  <button
                    aria-label={transactionSelection.isBulkMode ? 'Exit bulk select' : 'Bulk actions'}
                    aria-pressed={transactionSelection.isBulkMode}
                    className={mobileHeaderActionClass('touch-manipulation rounded-xl p-2.5', transactionSelection.isBulkMode)}
                    onClick={() => (transactionSelection.isBulkMode ? transactionSelection.exitBulkMode() : transactionSelection.enterBulkMode())}
                    type="button"
                  >
                    {transactionSelection.isBulkMode ? <X className="h-5 w-5" /> : <CheckSquare className="h-5 w-5" />}
                  </button>
                </div>
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
          <div aria-hidden className="fixed inset-x-0 bottom-0 top-12 z-40 bg-black/30 lg:hidden" onClick={closeMenu} />
          <div className="fixed bottom-0 left-0 top-0 z-50 flex w-64 flex-col bg-white shadow-xl lg:hidden">
            <div className="flex h-12 shrink-0 items-center justify-end border-b border-neutral-200 px-4">
              <IconButton ariaLabel="Close menu" onClick={closeMenu}>
                <X className="h-5 w-5" />
              </IconButton>
            </div>

            <nav aria-label="Menu navigation" className="flex-1 space-y-1 p-4">
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

            <div className="shrink-0 space-y-1 border-t border-neutral-200 p-4">
              <NavLink className={menuNavLinkClass} onClick={closeMenu} to="/settings">
                <Settings aria-hidden className="h-5 w-5 shrink-0" />
                Settings
              </NavLink>
              <button
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-950"
                onClick={handleSignOut}
                type="button"
              >
                <LogOut aria-hidden className="h-5 w-5 shrink-0" />
                Sign out
              </button>
            </div>
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
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-xl focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg"
        href="#main-content"
      >
        Skip to main content
      </a>
      <div className="flex min-h-screen bg-paper">
        <Sidebar collapsed={collapsed} hasReviewItems={hasReviewItems} onCollapsedChange={onCollapsedChange} />

        <div className="min-w-0 flex-1">
          <MobileHeader hasReviewItems={hasReviewItems} />

          <main className="mx-auto max-w-[1600px] p-4 pb-28 pt-16 lg:p-6 lg:pb-6 lg:pt-6" id="main-content">
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
      className="mobile-bottom-nav z-30 flex border-t border-neutral-200 bg-white lg:hidden"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        top: 'auto',
        width: '100vw',
        maxWidth: 'none',
        margin: 0,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {navItems.map((item) => {
        const Icon = item.icon
        return (
          <NavLink
            className={({ isActive }) =>
              clsx(
                'flex flex-1 flex-col items-center gap-0.5 py-1.5 text-xs font-semibold transition',
                isActive || (isStickySection(sectionOf(item.to)) && sectionOf(location.pathname) === sectionOf(item.to)) ? 'text-brand-600' : 'text-neutral-500',
              )
            }
            end={item.end}
            key={item.id}
            {...(item.id === 'review' ? { to: reviewRoute(disableTransactionTracking, canWriteTransactions, canWriteAccounts, canReviewBalances, canReviewAssets) } : stickyNavProps(item.to))}
          >
            <NavIcon Icon={Icon} iconClassName="h-6 w-6" needsReview={item.id === 'review' && hasReviewItems} />
            {item.label}
          </NavLink>
        )
      })}
    </nav>,
    document.body,
  )
}
