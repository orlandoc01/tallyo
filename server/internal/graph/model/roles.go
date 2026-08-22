package model

import "github.com/samber/lo"

const DefaultRoleName = "writer"

var roleNames = map[Role]string{
	RoleAdmin:            "admin",
	RoleWriter:           DefaultRoleName,
	RoleReadonly:         "readonly",
	RoleSpendTracker:     "spend_tracker",
	RoleCashflowTracker:  "cashflow_tracker",
	RoleNetWorthTracker:  "net_worth_tracker",
	RolePortfolioTracker: "portfolio_tracker",
}

var rolesByName = lo.Invert(roleNames)

func RoleFromName(name string) Role {
	return lo.CoalesceOrEmpty(rolesByName[name], RoleWriter)
}

func RoleName(role Role) string {
	return lo.CoalesceOrEmpty(roleNames[role], DefaultRoleName)
}
