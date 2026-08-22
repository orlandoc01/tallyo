package auth

import (
	"context"
	"fmt"
	"strings"
)

// Role represents a user's access level.
type Role string

const (
	RoleAdmin            Role = "admin"
	RoleWriter           Role = "writer"
	RoleReadonly         Role = "readonly"
	RoleSpendTracker     Role = "spend_tracker"
	RoleCashflowTracker  Role = "cashflow_tracker"
	RoleNetWorthTracker  Role = "net_worth_tracker"
	RolePortfolioTracker Role = "portfolio_tracker"
)

var validRoles = []Role{
	RoleAdmin, RoleWriter, RoleReadonly, RoleSpendTracker, RoleCashflowTracker, RoleNetWorthTracker, RolePortfolioTracker,
}

// Scope constants for the (read|write):(resource) format.
const (
	ScopeReadTransactions  = "read:transactions"
	ScopeWriteTransactions = "write:transactions"
	ScopeReadAccounts      = "read:accounts"
	ScopeWriteAccounts     = "write:accounts"
	ScopeReadUsers         = "read:users"
	ScopeWriteUsers        = "write:users"
	ScopeReadRules         = "read:rules"
	ScopeWriteRules        = "write:rules"
	ScopeReadCategories    = "read:categories"
	ScopeWriteCategories   = "write:categories"
	ScopeReadSpending      = "read:spending"
	ScopeReadCashflow      = "read:cashflow"
	ScopeReadOwners        = "read:owners"
	ScopeWriteOwners       = "write:owners"
	ScopeReadAssets        = "read:assets"
	ScopeWriteAssets       = "write:assets"
	ScopeReadWealth        = "read:wealth"
	ScopeWriteWealth       = "write:wealth"
	ScopeReadHoldings      = "read:holdings"
	ScopeReadPortfolio     = "read:portfolio"
	ScopeReadBudgets       = "read:budgets"
	ScopeWriteBudgets      = "write:budgets"
	ScopeReadTags          = "read:tags"
	ScopeWriteTags         = "write:tags"
	ScopeReadSettings      = "read:settings"
	ScopeWriteSettings     = "write:settings"
)

// AllScopes contains every defined scope; used when granting full admin access.
var AllScopes = []string{
	ScopeReadTransactions, ScopeWriteTransactions,
	ScopeReadAccounts, ScopeWriteAccounts,
	ScopeReadUsers, ScopeWriteUsers,
	ScopeReadRules, ScopeWriteRules,
	ScopeReadCategories, ScopeWriteCategories,
	ScopeReadSpending, ScopeReadCashflow,
	ScopeReadOwners, ScopeWriteOwners,
	ScopeReadAssets, ScopeWriteAssets,
	ScopeReadWealth, ScopeWriteWealth,
	ScopeReadHoldings,
	ScopeReadPortfolio,
	ScopeReadBudgets, ScopeWriteBudgets,
	ScopeReadTags, ScopeWriteTags,
	ScopeReadSettings, ScopeWriteSettings,
}

// ClientAllowedScopes includes AllScopes plus the "read" and "write" shorthand scopes.
// These are the primary request form — the SPA asks for "read write" on every login, and
// scope-less authorize requests default to them. Each shorthand expands to all granular
// scopes of that action before role intersection ("request everything, role decides").
var ClientAllowedScopes = append([]string{"read", "write"}, AllScopes...)

func (s *Service) roleForSession(ctx context.Context, session LoginSession) (Role, error) {
	if session.Subject == "" {
		return RoleWriter, nil
	}
	role, err := s.store.UserRole(ctx, session.Subject)
	if err != nil {
		return "", fmt.Errorf("load user role for %q: %w", session.Subject, err)
	}
	return role, nil
}

// ScopesForRole returns the scopes granted to a role.
func ScopesForRole(role Role) []string {
	switch role {
	case RoleAdmin:
		return AllScopes
	case RoleWriter:
		return []string{
			ScopeReadTransactions, ScopeWriteTransactions,
			ScopeReadAccounts, ScopeWriteAccounts,
			ScopeReadRules, ScopeWriteRules,
			ScopeReadCategories, ScopeWriteCategories,
			ScopeReadSpending, ScopeReadCashflow,
			ScopeReadOwners,
			ScopeReadAssets, ScopeWriteAssets,
			ScopeReadWealth, ScopeWriteWealth,
			ScopeReadHoldings,
			ScopeReadPortfolio,
			ScopeReadBudgets, ScopeWriteBudgets,
			ScopeReadTags, ScopeWriteTags,
		}
	case RoleReadonly:
		return []string{
			ScopeReadTransactions,
			ScopeReadAccounts,
			ScopeReadRules,
			ScopeReadCategories,
			ScopeReadSpending, ScopeReadCashflow,
			ScopeReadOwners,
			ScopeReadAssets,
			ScopeReadWealth,
			ScopeReadHoldings,
			ScopeReadPortfolio,
			ScopeReadBudgets,
			ScopeReadTags,
		}
	case RoleSpendTracker:
		return []string{
			ScopeReadSpending,
			ScopeReadCategories,
			ScopeReadOwners,
			ScopeReadTags,
		}
	case RoleCashflowTracker:
		return []string{
			ScopeReadSpending,
			ScopeReadCashflow,
			ScopeReadCategories,
			ScopeReadOwners,
			ScopeReadBudgets, ScopeWriteBudgets,
			ScopeReadTags,
		}
	case RoleNetWorthTracker:
		return []string{
			ScopeReadAssets,
			ScopeWriteAssets,
			ScopeReadWealth,
			ScopeWriteWealth,
			ScopeReadAccounts,
			ScopeReadOwners,
		}
	case RolePortfolioTracker:
		return []string{
			ScopeReadPortfolio,
			ScopeReadAccounts,
			ScopeReadOwners,
		}
	default:
		return nil
	}
}

func GrantedScopesForRole(role Role, requested []string) []string {
	requestedSet := expandRequestedScopeSet(requested)
	granted := []string{}
	for _, scope := range ScopesForRole(role) {
		if _, ok := requestedSet[scope]; ok {
			granted = append(granted, scope)
		}
	}
	return granted
}

func expandRequestedScopeSet(requested []string) map[string]struct{} {
	set := make(map[string]struct{}, len(requested))
	for _, scope := range requested {
		switch scope {
		case "read":
			addScopesWithAction(set, "read")
		case "write":
			addScopesWithAction(set, "write")
		default:
			set[scope] = struct{}{}
		}
	}
	return set
}

func addScopesWithAction(set map[string]struct{}, action string) {
	prefix := action + ":"
	for _, scope := range AllScopes {
		if strings.HasPrefix(scope, prefix) {
			set[scope] = struct{}{}
		}
	}
}
