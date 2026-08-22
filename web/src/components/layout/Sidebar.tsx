import clsx from 'clsx'
import { BarChart3, ChevronLeft, ChevronRight, ClipboardCheck, CreditCard, Landmark, LogOut, PieChart, Repeat2, Settings, Target, TrendingUp, WalletCards } from 'lucide-react'
import { NavLink, useLocation } from 'react-router'
import { useAuth } from '../../auth/useAuth'
import { usePermissions } from '../../hooks/usePermissions'
import { reviewRoute } from '../../hooks/navItems'
import { isStickySection, sectionOf } from '../../hooks/sectionHistory'
import { useSectionHistory } from '../../hooks/useSectionHistory'
import { currentBudgetPath } from '../../utils/dates'
import { IconButton } from '../common/Button'
import { NavIcon } from './NavIcon'

const coreNavItemsBeforeReview = [
  { to: '/transactions', label: 'Transactions', icon: CreditCard },
]

const coreNavItemsAfterReview = [
  { to: '/recurring', label: 'Recurring', icon: Repeat2 },
  { to: '/accounts', label: 'Accounts', icon: Landmark },
]

export function Sidebar({ collapsed, hasReviewItems, onCollapsedChange }: { collapsed: boolean; hasReviewItems: boolean; onCollapsedChange: (collapsed: boolean) => void }) {
  const { disableTransactionTracking, disableWealthTracking, logout } = useAuth()
  const { canRead, canWrite } = usePermissions()
  const canReadTransactions = canRead('transactions')
  const canReadAccounts = canRead('accounts')
  const canReadWealth = canRead('wealth')
  const canReadPortfolio = canRead('portfolio')
  const canWriteTransactions = canWrite('transactions')
  const canWriteAccounts = canWrite('accounts')
  const canReviewBalances = canWrite('wealth') && !disableWealthTracking
  const canReviewAssets = canWrite('assets') && !disableWealthTracking
  const { stickyNavProps } = useSectionHistory()
  const location = useLocation()

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    clsx(
      'flex items-center rounded-xl text-sm font-medium transition',
      collapsed ? 'h-12 w-12 justify-center' : 'gap-3 px-3 py-2.5',
      isActive ? 'bg-brand-50 text-brand-700' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950',
    )

  const bottomItemClass = clsx(
    'flex w-full items-center rounded-xl text-sm font-medium transition text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950',
    collapsed ? 'h-12 w-12 justify-center' : 'gap-3 px-3 py-2.5',
  )

  const stickyNavLinkClass = (defaultTo: string) => ({ isActive }: { isActive: boolean }) => navLinkClass({
    isActive: isActive || sectionOf(location.pathname) === sectionOf(defaultTo),
  })

  const navItemClassName = (defaultTo: string) => isStickySection(sectionOf(defaultTo)) ? stickyNavLinkClass(defaultTo) : navLinkClass

  const renderCoreNavItem = (item: { to: string; label: string; icon: typeof CreditCard }) => (
    <NavLink
      className={navItemClassName(item.to)}
      end={item.to === '/'}
      key={item.to}
      title={collapsed ? item.label : undefined}
      {...stickyNavProps(item.to)}
    >
      <item.icon aria-hidden className="h-5 w-5 shrink-0" />
      <span className={collapsed ? 'sr-only' : undefined}>{item.label}</span>
    </NavLink>
  )

  return (
    <aside className={clsx('hidden shrink-0 border-r border-neutral-200 bg-white/90 p-4 transition-[width] lg:flex lg:flex-col sticky top-0 h-screen overflow-y-auto', collapsed ? 'w-20' : 'w-52')}>
      <div className={clsx('mb-8 flex items-start', collapsed ? 'justify-center' : 'justify-between gap-3')}>
        {!collapsed ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-brand-600">Tallyo</p>
            <h1 className="mt-2 text-xl font-bold text-neutral-950">Household</h1>
          </div>
        ) : null}
        <IconButton ariaLabel={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => onCollapsedChange(!collapsed)}>
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </IconButton>
      </div>

      <nav aria-label="Main navigation" className="flex-1 space-y-1">
        {canReadWealth && !disableWealthTracking ? (
          <NavLink className={stickyNavLinkClass('/net-worth')} key="/net-worth" title={collapsed ? 'Net Worth' : undefined} {...stickyNavProps('/net-worth')}>
            <TrendingUp aria-hidden className="h-5 w-5 shrink-0" />
            <span className={collapsed ? 'sr-only' : undefined}>Net Worth</span>
          </NavLink>
        ) : null}
        {canReadPortfolio && !disableWealthTracking ? (
          <NavLink className={stickyNavLinkClass('/portfolio')} key="/portfolio" title={collapsed ? 'Portfolio' : undefined} {...stickyNavProps('/portfolio')}>
            <PieChart aria-hidden className="h-5 w-5 shrink-0" />
            <span className={collapsed ? 'sr-only' : undefined}>Portfolio</span>
          </NavLink>
        ) : null}
        {canRead('spending') && !disableTransactionTracking ? (
          <NavLink className={stickyNavLinkClass('/expenses/breakdown')} key="/expenses" title={collapsed ? 'Expenses' : undefined} {...stickyNavProps('/expenses/breakdown')}>
            <BarChart3 aria-hidden className="h-5 w-5 shrink-0" />
            <span className={collapsed ? 'sr-only' : undefined}>Expenses</span>
          </NavLink>
        ) : null}
        {canRead('cashflow') && !disableTransactionTracking ? (
          <NavLink className={stickyNavLinkClass('/cash-flow')} key="/cash-flow" title={collapsed ? 'Cash Flow' : undefined} {...stickyNavProps('/cash-flow')}>
            <WalletCards aria-hidden className="h-5 w-5 shrink-0" />
            <span className={collapsed ? 'sr-only' : undefined}>Cash Flow</span>
          </NavLink>
        ) : null}
        {canRead('budgets') && !disableTransactionTracking ? (
          <NavLink className={navLinkClass} key="/budgets" title={collapsed ? 'Budget' : undefined} to={currentBudgetPath()}>
            <Target aria-hidden className="h-5 w-5 shrink-0" />
            <span className={collapsed ? 'sr-only' : undefined}>Budget</span>
          </NavLink>
        ) : null}
        {canReadTransactions && !disableTransactionTracking ? coreNavItemsBeforeReview.map(renderCoreNavItem) : null}
        {canWriteTransactions || canWriteAccounts || canReviewBalances || canReviewAssets ? (
          <NavLink
            className={navLinkClass}
            key="/review"
            title={collapsed ? 'Review' : undefined}
            to={reviewRoute(disableTransactionTracking, canWriteTransactions, canWriteAccounts, canReviewBalances, canReviewAssets)}
          >
            <NavIcon Icon={ClipboardCheck} needsReview={hasReviewItems} />
            <span className={collapsed ? 'sr-only' : undefined}>Review</span>
          </NavLink>
        ) : null}
        {coreNavItemsAfterReview.filter((item) => {
          if (item.to === '/recurring') return canReadTransactions && !disableTransactionTracking
          if (item.to === '/accounts') return canReadAccounts
          return true
        }).map(renderCoreNavItem)}
      </nav>

      <div className="mt-4 space-y-1 border-t border-neutral-200 pt-4">
        <NavLink
          className={({ isActive }) => navLinkClass({ isActive: isActive || location.pathname.startsWith('/settings') })}
          title={collapsed ? 'Settings' : undefined}
          to="/settings/general"
        >
          <Settings aria-hidden className="h-5 w-5 shrink-0" />
          <span className={collapsed ? 'sr-only' : undefined}>Settings</span>
        </NavLink>
        <button className={bottomItemClass} onClick={logout} title={collapsed ? 'Sign out' : undefined} type="button">
          <LogOut aria-hidden className="h-5 w-5 shrink-0" />
          <span className={collapsed ? 'sr-only' : undefined}>Sign out</span>
        </button>
      </div>
    </aside>
  )
}
