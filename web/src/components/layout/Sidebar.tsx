import clsx from 'clsx'
import { BarChart3, ClipboardCheck, CreditCard, Landmark, PanelLeftClose, PanelLeftOpen, PieChart, Repeat2, Settings, Target, TrendingUp, WalletCards } from 'lucide-react'
import { NavLink, useLocation } from 'react-router'
import { useAuth } from '../../auth/useAuth'
import { usePermissions } from '../../hooks/usePermissions'
import { reviewRoute } from '../../hooks/navItems'
import { isStickySection, sectionOf } from '../../hooks/sectionHistory'
import { useSectionHistory } from '../../hooks/useSectionHistory'
import { currentBudgetPath } from '../../utils/dates'
import { NavIcon } from './NavIcon'

const coreNavItemsBeforeReview = [
  { to: '/transactions', label: 'Transactions', icon: CreditCard },
]

const coreNavItemsAfterReview = [
  { to: '/recurring', label: 'Recurring', icon: Repeat2 },
  { to: '/accounts', label: 'Accounts', icon: Landmark },
]

export function Sidebar({ collapsed, hasReviewItems, onCollapsedChange }: { collapsed: boolean; hasReviewItems: boolean; onCollapsedChange: (collapsed: boolean) => void }) {
  const { disableTransactionTracking, disableWealthTracking } = useAuth()
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
      'flex h-9 items-center gap-2.5 rounded-md text-sm font-medium transition',
      collapsed ? 'justify-center px-0' : 'px-2.5',
      isActive ? 'bg-raised-nav text-text-1' : 'text-text-muted hover:bg-raised',
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
      <item.icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.6} />
      <span className={collapsed ? 'sr-only' : undefined}>{item.label}</span>
    </NavLink>
  )

  return (
    <aside className={clsx('sticky top-0 hidden h-screen shrink-0 flex-col gap-0.5 overflow-hidden border-r border-border bg-surface px-2 py-3 transition-[width] duration-[180ms] ease-out lg:flex', collapsed ? 'w-14' : 'w-[200px]')}>
      <div className={clsx('mb-2 flex h-10 items-center', collapsed ? 'justify-center' : 'px-2.5')}>
        <span className="text-[17px] font-bold tracking-[-0.3px] text-text-1">{collapsed ? 't' : 'tallyo'}</span>
      </div>

      <nav aria-label="Main navigation" className="flex flex-1 flex-col gap-0.5">
        {canReadWealth && !disableWealthTracking ? (
          <NavLink className={stickyNavLinkClass('/net-worth')} key="/net-worth" title={collapsed ? 'Net Worth' : undefined} {...stickyNavProps('/net-worth')}>
            <TrendingUp aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.6} />
            <span className={collapsed ? 'sr-only' : undefined}>Net Worth</span>
          </NavLink>
        ) : null}
        {canReadPortfolio && !disableWealthTracking ? (
          <NavLink className={stickyNavLinkClass('/portfolio')} key="/portfolio" title={collapsed ? 'Portfolio' : undefined} {...stickyNavProps('/portfolio')}>
            <PieChart aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.6} />
            <span className={collapsed ? 'sr-only' : undefined}>Portfolio</span>
          </NavLink>
        ) : null}
        {canRead('spending') && !disableTransactionTracking ? (
          <NavLink className={stickyNavLinkClass('/expenses/breakdown')} key="/expenses" title={collapsed ? 'Expenses' : undefined} {...stickyNavProps('/expenses/breakdown')}>
            <BarChart3 aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.6} />
            <span className={collapsed ? 'sr-only' : undefined}>Expenses</span>
          </NavLink>
        ) : null}
        {canRead('cashflow') && !disableTransactionTracking ? (
          <NavLink className={stickyNavLinkClass('/cash-flow')} key="/cash-flow" title={collapsed ? 'Cash Flow' : undefined} {...stickyNavProps('/cash-flow')}>
            <WalletCards aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.6} />
            <span className={collapsed ? 'sr-only' : undefined}>Cash Flow</span>
          </NavLink>
        ) : null}
        {canRead('budgets') && !disableTransactionTracking ? (
          <NavLink className={navLinkClass} key="/budgets" title={collapsed ? 'Budget' : undefined} to={currentBudgetPath()}>
            <Target aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.6} />
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

      <div className="mx-0.5 my-1.5 border-t border-border" />
      <NavLink
        className={({ isActive }) => navLinkClass({ isActive: isActive || location.pathname.startsWith('/settings') })}
        title={collapsed ? 'Settings' : undefined}
        to="/settings/general"
      >
        <Settings aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.6} />
        <span className={collapsed ? 'sr-only' : undefined}>Settings</span>
      </NavLink>
      <button
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className={clsx('flex h-9 items-center gap-2.5 rounded-md text-[13px] text-text-muted transition hover:bg-raised', collapsed ? 'justify-center px-0' : 'px-2.5')}
        onClick={() => onCollapsedChange(!collapsed)}
        type="button"
      >
        {collapsed ? <PanelLeftOpen aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.6} /> : <PanelLeftClose aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.6} />}
        <span className={collapsed ? 'sr-only' : undefined}>Collapse</span>
      </button>
    </aside>
  )
}
