package graph

import (
	"testing"

	"tallyo/internal/graph/model"
)

func TestFromModelRoles(t *testing.T) {
	t.Run("nil defaults writer", func(t *testing.T) {
		if got := fromModelRole(nil); got != "writer" {
			t.Fatalf("fromModelRole() = %q, want %q", got, "writer")
		}
	})
	cases := map[string]struct {
		input model.Role
		want  string
	}{
		"admin":             {input: model.RoleAdmin, want: "admin"},
		"readonly":          {input: model.RoleReadonly, want: "readonly"},
		"spend tracker":     {input: model.RoleSpendTracker, want: "spend_tracker"},
		"cashflow tracker":  {input: model.RoleCashflowTracker, want: "cashflow_tracker"},
		"net worth tracker": {input: model.RoleNetWorthTracker, want: "net_worth_tracker"},
		"portfolio tracker": {input: model.RolePortfolioTracker, want: "portfolio_tracker"},
		"unknown defaults":  {input: model.Role("BAD"), want: "writer"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if got := fromModelRole(&tc.input); got != tc.want {
				t.Fatalf("fromModelRole() = %q, want %q", got, tc.want)
			}
		})
	}
}
