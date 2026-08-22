package graph

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"testing"

	"github.com/99designs/gqlgen/client"

	"tallyo/internal/admin"
	"tallyo/internal/admin/runtimeconfig"
	"tallyo/internal/config"
	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
)

func TestConfigurationGraphQLExecution(t *testing.T) {
	store := &graphConfigStore{sections: runtimeconfig.Sections{
		Auth:     storedSection(true, runtimeconfig.AuthConfig{MasterPassword: stringPtr("master-secret")}),
		Google:   storedSection(true, runtimeconfig.GoogleConfig{ClientSecret: stringPtr("google-secret")}),
		Email:    storedSection(true, runtimeconfig.EmailConfig{Password: stringPtr("smtp-secret")}),
		MCP:      storedSection(true, runtimeconfig.MCPConfig{DynamicRedirectHosts: []string{"claude.ai"}}),
		Security: storedSection(true, runtimeconfig.SecurityConfig{TrustedProxyCIDRs: []string{"10.0.0.0/24"}}),
	}}
	service := admin.NewService(store, runtimeconfig.New(store))
	must.NoErr(t, service.LoadConfiguration(context.Background(), true, false))
	c := client.New(newExecServer(&Resolver{Config: config.Config{DBPath: "/tmp/tallyo.db"}, Admin: service}))
	var response struct {
		Configuration struct {
			DbPath         string
			Authorization  struct{ MasterPassword string }
			GoogleAuthn    struct{ GoogleClientSecret string }
			EmailCodeAuthn struct{ SMTPPassword string }
			Mcp            struct {
				Enabled              bool
				DynamicRedirectHosts []string
			}
			Security struct{ TrustedProxyCidrs []string }
		}
	}
	c.MustPost(`query { configuration { dbPath authorization { masterPassword } googleAuthn { googleClientSecret } emailCodeAuthn { smtpPassword } mcp { enabled dynamicRedirectHosts } security { trustedProxyCidrs } } }`, &response, withCtx(allScopesCtx()))
	configuration := response.Configuration
	if configuration.DbPath != "/tmp/tallyo.db" || configuration.Authorization.MasterPassword != obfuscatedSecret || configuration.GoogleAuthn.GoogleClientSecret != obfuscatedSecret || configuration.EmailCodeAuthn.SMTPPassword != obfuscatedSecret {
		t.Fatalf("configuration = %#v", configuration)
	}
	if !configuration.Mcp.Enabled || len(configuration.Mcp.DynamicRedirectHosts) != 1 || len(configuration.Security.TrustedProxyCidrs) != 1 {
		t.Fatalf("configuration = %#v", configuration)
	}
}

func TestTransactionReportsGraphQLExecution(t *testing.T) {
	store := openGraphTestStore(t)
	test.SeedPlaidAccount(t, store.Accounts, store.AdminDB, "acc", "alex")
	transactionID := seedResolverTransaction(t, store, "tx", "2026-05-20", 12.34)
	seedResolverTransaction(t, store, "staged", "2026-05-21", 23.45)
	_, err := store.Transactions.SQL().ExecContext(
		context.Background(),
		`UPDATE transactions SET staged_for_llm = 1 WHERE external_id = ?`,
		"staged",
	)
	must.NoErr(t, err)
	c := client.New(newExecServer(&Resolver{AccountsStore: store.Accounts, WealthDB: store.WealthDB, TransactionsStore: store.Transactions}))
	var response struct {
		Transactions struct {
			TotalCount int
			Edges      []struct{ Node struct{ ID string } }
		}
		Transaction                         struct{ ID string }
		TransactionsSummary                 struct{ TotalCount int }
		TransactionsStagedForCategorization struct{ Count int }
		SpendingByCategory                  struct{ TransactionCount int }
		CashFlow                            struct {
			Periods []struct{ PeriodLabel string }
		}
	}
	c.MustPost(`query($id: ID!) {
		transactions(input: { first: 10 }) { totalCount edges { node { id } } }
		transaction(id: $id) { id }
		transactionsSummary(filter: {}) { totalCount }
		transactionsStagedForCategorization { count }
		spendingByCategory(filter: { datetimeRange: { from: "2026-05-01T00:00:00Z", to: "2026-06-01T00:00:00Z" } }) { transactionCount }
		cashFlow(filter: { datetimeRange: { from: "2026-05-01T00:00:00Z", to: "2026-06-01T00:00:00Z" } }) { periods { periodLabel } }
	}`, &response, client.Var("id", transactionID.EncodedString()), withCtx(allScopesCtx()))
	if response.Transactions.TotalCount != 1 {
		t.Errorf("transactions totalCount = %d, want 1", response.Transactions.TotalCount)
	}
	if response.Transaction.ID != transactionID.EncodedString() {
		t.Errorf("transaction id = %q, want %q", response.Transaction.ID, transactionID.EncodedString())
	}
	if response.TransactionsSummary.TotalCount != 1 {
		t.Errorf("transactionsSummary totalCount = %d, want 1", response.TransactionsSummary.TotalCount)
	}
	if response.TransactionsStagedForCategorization.Count != 1 {
		t.Errorf("transactionsStagedForCategorization count = %d, want 1", response.TransactionsStagedForCategorization.Count)
	}
	if response.SpendingByCategory.TransactionCount != 1 {
		t.Errorf("spendingByCategory transactionCount = %d, want 1", response.SpendingByCategory.TransactionCount)
	}
	if len(response.CashFlow.Periods) != 1 {
		t.Errorf("cashFlow periods = %d, want 1", len(response.CashFlow.Periods))
	}
}

func TestTransactionsGraphQLExecutionRejectsInvalidPageArgs(t *testing.T) {
	store := openGraphTestStore(t)
	test.SeedPlaidAccount(t, store.Accounts, store.AdminDB, "acc", "alex")
	seedResolverTransaction(t, store, "page-arg-tx", "2026-05-20", 12.34)
	c := client.New(newExecServer(&Resolver{AccountsStore: store.Accounts, WealthDB: store.WealthDB, TransactionsStore: store.Transactions}))

	encodeCursor := func(json string) string { return base64.RawURLEncoding.EncodeToString([]byte(json)) }

	cases := []struct {
		name  string
		input string
	}{
		{name: "first and last together", input: `{first: 1, last: 1}`},
		{name: "after and before together", input: fmt.Sprintf(`{first: 1, after: %q, before: %q}`, encodeCursor(`{"datetime":"2026-05-20T00:00:00Z","id":1}`), encodeCursor(`{"datetime":"2026-05-20T00:00:00Z","id":1}`))},
		{name: "non-positive first", input: `{first: 0}`},
		{name: "first above max", input: `{first: 100000}`},
		{name: "malformed base64 cursor", input: `{first: 1, after: "not-valid-base64!!"}`},
		{name: "structurally decodable empty cursor object", input: fmt.Sprintf(`{first: 1, after: %q}`, encodeCursor(`{}`))},
		{name: "invalid datetime cursor", input: fmt.Sprintf(`{first: 1, after: %q}`, encodeCursor(`{"datetime":"not-a-date","id":1}`))},
		{name: "zero id cursor", input: fmt.Sprintf(`{first: 1, after: %q}`, encodeCursor(`{"datetime":"2026-05-20T00:00:00Z","id":0}`))},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var response map[string]any
			err := c.Post(fmt.Sprintf(`query { transactions(input: %s) { totalCount } }`, tc.input), &response, withCtx(allScopesCtx()))
			if err == nil {
				t.Fatal("expected error")
			}
			if !strings.Contains(err.Error(), "BAD_USER_INPUT") {
				t.Fatalf("error = %v, want BAD_USER_INPUT", err)
			}
		})
	}
}

func TestCreateManualAccountGraphQLRejectsUnknownReferences(t *testing.T) {
	resolver, store := testResolver(t)
	owner := test.MustCreateOwner(t, store.Accounts, model.CreateOwnerInput{Name: "manual-owner"})
	c := client.New(newExecServer(resolver))
	mutation := `mutation($input: CreateManualAccountInput!) { createManualAccount(input: $input) { account { id } } }`

	cases := map[string]map[string]any{
		"unknown owner": {
			"name":    "Cash",
			"type":    "DEPOSITORY",
			"ownerId": model.New(model.GlobalIDOwner, 999999).EncodedString(),
		},
		"unknown connection": {
			"name":         "Cash",
			"type":         "DEPOSITORY",
			"ownerId":      owner.ID.EncodedString(),
			"connectionId": model.New(model.GlobalIDConnection, 999999).EncodedString(),
		},
		"zero connection": {
			"name":         "Cash",
			"type":         "DEPOSITORY",
			"ownerId":      owner.ID.EncodedString(),
			"connectionId": model.New(model.GlobalIDConnection, 0).EncodedString(),
		},
	}
	for name, input := range cases {
		t.Run(name, func(t *testing.T) {
			var resp map[string]any
			err := c.Post(mutation, &resp, client.Var("input", input), withCtx(allScopesCtx()))
			if err == nil || !strings.Contains(err.Error(), "BAD_USER_INPUT") {
				t.Fatalf("createManualAccount() error = %v, want BAD_USER_INPUT", err)
			}
			accounts, err := store.Accounts.Accounts(context.Background())
			must.NoErr(t, err)
			if len(accounts) != 0 {
				t.Fatalf("accounts created after failed mutation: %#v", accounts)
			}
		})
	}
}

// TestGraphQLComplexityLimitAllowsRealAccountProviderQueries guards against
// reintroducing a per-field complexity multiplier on the Account/Connection
// list and cycle fields (AccountList.items, ConnectionList.items,
// PlaidItem.accounts, SimpleFinConnection.accounts). A prior attempt at
// bounding the Account -> Connection -> provider -> PlaidItem/SimpleFinConnection
// -> accounts cycle with a flat per-hop multiplier broke ordinary production
// queries: the frontend's single-hop `connections { items { provider { ...
// on PlaidItem { accounts { ...fields } } } } }` already exceeds a 500-point
// budget under a large-enough multiplier to reject a two-hop cycle written
// with minimal fields, so no single multiplier value can satisfy both goals.
// FixedComplexityLimit(500) alone still bounds total query size.
func TestGraphQLComplexityLimitAllowsRealAccountProviderQueries(t *testing.T) {
	store := openGraphTestStore(t)
	test.SeedPlaidAccount(t, store.Accounts, store.AdminDB, "acc", "alex")
	c := client.New(newExecServer(&Resolver{AccountsStore: store.Accounts, WealthDB: store.WealthDB, TransactionsStore: store.Transactions, Wealth: testWealthService(store.WealthDB)}))

	var resp map[string]any
	err := c.Post(`query {
		accounts { items { id name connection { id provider { __typename } } } }
		connections {
			items {
				id
				name
				isActive
				provider {
					... on PlaidItem {
						accounts { id name type subtype mask notes closed hidden manual typeLocked lastSyncedAt createdAt updatedAt }
					}
					... on SimpleFinConnection {
						accounts { id name type }
					}
				}
			}
		}
	}`, &resp, withCtx(allScopesCtx()))
	must.NoErr(t, err)
}

func TestNodesGraphQLExecution(t *testing.T) {
	store := openGraphTestStore(t)
	account := test.SeedPlaidAccount(t, store.Accounts, store.AdminDB, "acc", "alex")
	transactionID := seedResolverTransaction(t, store, "node", "2026-05-20", 5)
	user, err := store.AdminDB.InsertUser(context.Background(), admin.InsertUserInput{Email: "nodes-exec@example.com", Role: "ADMIN"})
	must.NoErr(t, err)
	resolver := &Resolver{AccountsStore: store.Accounts, WealthDB: store.WealthDB, TransactionsStore: store.Transactions, Admin: admin.NewService(store.AdminDB, runtimeconfig.New(store.AdminDB))}
	c := client.New(newExecServer(resolver))
	ids := []string{transactionID.EncodedString(), model.EncodeGlobalID(model.GlobalIDTransaction, "999999"), account.Connection.ID.EncodedString(), user.ID.EncodedString()}
	var response struct {
		Nodes []*struct {
			Typename string `json:"__typename"`
			ID       string
		}
		Node *struct{ ID string }
	}
	c.MustPost(`query($ids: [ID!]!, $missing: ID!) { nodes(ids: $ids) { __typename id } node(id: $missing) { id } }`, &response, client.Var("ids", ids), client.Var("missing", ids[1]), withCtx(allScopesCtx()))
	if len(response.Nodes) != 4 || response.Nodes[0] == nil || response.Nodes[0].Typename != "Transaction" || response.Nodes[1] != nil || response.Nodes[2] == nil || response.Nodes[2].Typename != "Connection" || response.Nodes[3] == nil || response.Nodes[3].Typename != "User" || response.Node != nil {
		t.Fatalf("response = %#v", response)
	}
}
