package mcpserver

import (
	"context"
	"fmt"
	"strings"
	"testing"

	accountsdb "tallyo/internal/accounts/db"
	"tallyo/internal/admin"
	admindb "tallyo/internal/admin/db"
	"tallyo/internal/admin/runtimeconfig"
	"tallyo/internal/auth"
	"tallyo/internal/budgets"
	budgetsdb "tallyo/internal/budgets/db"
	"tallyo/internal/graph"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/portfolio"
	"tallyo/internal/transactions"
	transactionsdb "tallyo/internal/transactions/db"
	"tallyo/internal/utils/test"
	"tallyo/internal/wealth"
	wealthdb "tallyo/internal/wealth/db"
	"tallyo/internal/wealth/manual"

	"github.com/mark3labs/mcp-go/mcp"
	mcpsdk "github.com/mark3labs/mcp-go/server"
	"tallyo/internal/utils/must"
)

type mcpTestStore struct {
	*test.Store
	Accounts     *accountsdb.Store
	AdminDB      *admindb.Store
	Transactions *transactionsdb.Store
	WealthDB     *wealthdb.Store
	Budgets      *budgetsdb.Store
}

func openMCPTestStore(tb testing.TB) *mcpTestStore {
	tb.Helper()
	base := test.OpenStore(tb)
	return &mcpTestStore{
		Store:        base,
		Accounts:     accountsdb.New(base.Database()),
		AdminDB:      admindb.New(base.Database()),
		Transactions: transactionsdb.New(base.Database()),
		WealthDB:     wealthdb.New(base.Database()),
		Budgets:      budgetsdb.New(base.Database()),
	}
}

func testResolver(tb testing.TB, store *mcpTestStore) *graph.Resolver {
	tb.Helper()
	config := runtimeconfig.New(store.AdminDB)
	must.NoErr(tb, config.LoadConfiguration(context.Background(), true, false))
	return &graph.Resolver{
		AccountsStore:     store.Accounts,
		WealthDB:          store.WealthDB,
		TransactionsStore: store.Transactions,
		Admin:             admin.NewService(store.AdminDB, config),
		Wealth:            &wealth.Service{Store: store.WealthDB, Log: test.Logger, PriceProvider: test.LastKnownPriceProvider{}, Timezone: func() string { return "UTC" }},
		ManualSnapshot:    &manual.Service{Store: store.WealthDB, Prices: test.LastKnownPriceProvider{}},
		Portfolio:         &fakePortfolioService{},
	}
}

func openMCPTestServer(tb testing.TB) (*mcpTestStore, *Server) {
	tb.Helper()
	store := openMCPTestStore(tb)
	return store, &Server{resolver: testResolver(tb, store), log: test.Logger}
}

func mustSeedMCPTransaction(t *testing.T, store *mcpTestStore, externalID, accountID string, amount float64, datetime string) {
	t.Helper()
	merchant := "Coffee Shop"
	_, err := store.Transactions.UpsertSyncedTransaction(context.Background(), transactions.SyncedTransaction{
		ExternalID:     externalID,
		AccountID:      accountID,
		Amount:         amount,
		Datetime:       test.DateTime(datetime),
		PostedDatetime: test.DateTime(datetime),
		MerchantName:   &merchant,
	})
	must.NoErr(t, err)
}

type fakePortfolioService struct {
	view   model.AnalysisView
	filter portfolio.HoldingsFilter
}

func (s *fakePortfolioService) Analyze(_ context.Context, view model.AnalysisView, filter portfolio.HoldingsFilter) (*model.AnalysisReport, error) {
	s.view = view
	s.filter = filter
	return &model.AnalysisReport{
		View:          view,
		TotalValueUsd: money.FromDollars(123.45),
		Slices:        []*model.AnalysisSlice{{Label: "Technology", ValueUsd: money.FromDollars(123.45), Percent: 100}},
	}, nil
}

func TestCuratedToolsReadAndMutateTransactions(t *testing.T) {
	ctx := auth.ContextWithScopes(context.Background(), auth.AllScopes)
	store, srv := openMCPTestServer(t)
	account := test.SeedPlaidAccount(t, store.Accounts, store.AdminDB, "acc", "alex")

	mustSeedMCPTransaction(t, store, "tx-1", "acc", 4.50, "2026-05-20T12:00:00Z")
	mustSeedMCPTransaction(t, store, "tx-2", "acc", 9.25, "2026-05-21T12:00:00Z")

	accID := account.ID
	tx1 := test.MustTransactionBySourceExternalID(t, store.Transactions, transactions.TransactionSourcePlaid, "tx-1", "TransactionByExternalID() error = %v")
	tx1ID := tx1.ID
	missingTxID := model.New(model.GlobalIDTransaction, 999999)
	smoke := func(name string, call func() (any, string, error)) {
		t.Helper()
		value, _, err := call()
		if err != nil || value == nil {
			t.Fatalf("%s() = %#v, %v", name, value, err)
		}
	}
	value, _, err := srv.listTransactions(ctx, model.TransactionsInput{First: new(int32(10))})
	must.NoErr(t, err)
	conn := value.(*leanTransactionConnection)
	if conn.TotalCount != 2 || len(conn.Items) != 2 {
		t.Fatalf("connection = %#v", conn)
	}
	includeInactive := true
	itemsResult, _, err := srv.listPlaidItems(ctx, model.PlaidItemsInput{IncludeInactive: &includeInactive})
	must.NoErr(t, err)
	items := itemsResult.(*leanList[leanPlaidItem]).Items
	if len(items) != 1 || items[0].Credential == nil || len(items[0].Accounts) != 1 {
		t.Fatalf("listPlaidItems() items = %#v", items)
	}
	spending := model.SpendingFilter{DatetimeRange: &model.DateTimeRange{From: new(test.DateTime("2026-05-01T00:00:00Z")), To: new(test.DateTime("2026-06-01T00:00:00Z"))}}
	smoke("getTransaction", func() (any, string, error) { return srv.getTransaction(ctx, getTransactionInput{ID: tx1ID}) })
	smoke("spendingByCategory", func() (any, string, error) { return srv.spendingByCategory(ctx, spending) })
	smoke("cashFlow", func() (any, string, error) { return srv.cashFlow(ctx, spending) })
	smoke("transactionsSummary", func() (any, string, error) { return srv.transactionsSummary(ctx, model.TransactionsFilter{}) })
	smoke("listCategories", func() (any, string, error) { return srv.listCategories(ctx, noInput{}) })
	smoke("listCategoryGroups", func() (any, string, error) { return srv.listCategoryGroups(ctx, noInput{}) })
	smoke("listRecurringCharges", func() (any, string, error) { return srv.listRecurringCharges(ctx, noInput{}) })
	smoke("listOwners", func() (any, string, error) { return srv.listOwners(ctx, noInput{}) })
	credsResult, _, err := srv.listPlaidCredentials(ctx, noInput{})
	must.NoErr(t, err)
	creds := credsResult.(*leanList[leanPlaidCredential]).Items
	if len(creds) != 1 || creds[0].ItemCount != 1 {
		t.Fatalf("listPlaidCredentials() creds = %#v", creds)
	}
	groceries := model.New(model.GlobalIDCategory, test.CategoryIDByName(t, store.Transactions, "Groceries"))
	if _, _, err := srv.bulkUpdateTransactions(ctx, model.BulkUpdateTransactionsInput{TransactionIds: []*model.GlobalID{&tx1ID}, Updates: &model.TransactionUpdates{CategoryID: &groceries}}); err != nil {
		t.Fatalf("bulkUpdateTransactions() error = %v", err)
	}
	merchantName := "Reviewed Coffee"
	updatedTransaction, _, err := srv.updateTransaction(ctx, model.UpdateTransactionInput{ID: tx1ID, Updates: &model.TransactionUpdates{MerchantName: &merchantName, Notes: new("reviewed")}})
	if err != nil {
		t.Fatalf("updateTransaction() error = %v", err)
	}
	merchant := updatedTransaction.(leanTransactionPayload).Transaction.MerchantName
	if merchant == nil || *merchant != merchantName {
		t.Fatalf("updateTransaction() merchant = %#v", merchant)
	}
	_, _, err = srv.updateTransaction(ctx, model.UpdateTransactionInput{
		ID:      missingTxID,
		Updates: &model.TransactionUpdates{Notes: new("missing")},
	})
	if err == nil || err.Error() != "transaction not found" {
		t.Fatalf("updateTransaction(missing) error = %v, want transaction not found", err)
	}
	tag, err := store.Transactions.CreateTag(ctx, model.CreateTagInput{Name: "Recurring Bills", Color: "#ff0000"})
	must.NoErr(t, err)
	if _, _, err := srv.createRule(ctx, model.CreateRuleInput{
		MerchantPattern: new("Coffee"),
		Changes:         &model.TransactionUpdates{CategoryID: &groceries, TagIds: []*model.GlobalID{&tag.ID}},
		AccountIds:      []*model.GlobalID{&accID},
	}); err != nil {
		t.Fatalf("createRule() error = %v", err)
	}
	rules, _, err := srv.listRules(ctx, model.RulesInput{})
	must.NoErr(t, err)
	firstRule := rules.(*leanList[leanRule]).Items[0]
	if len(firstRule.Tags) != 1 || firstRule.Tags[0].Name != "Recurring Bills" || len(firstRule.Accounts) != 1 {
		t.Fatalf("listRules() first rule = %#v", firstRule)
	}
	if filtered, _, err := srv.listRules(ctx, model.RulesInput{MerchantPattern: new("zzz-no-match")}); err != nil {
		t.Fatalf("listRules(filtered) error = %v", err)
	} else if len(filtered.(*leanList[leanRule]).Items) != 0 {
		t.Fatalf("listRules(filtered) = %d rules, want 0", len(filtered.(*leanList[leanRule]).Items))
	}
	ruleID, err := model.DecodeGlobalID(firstRule.ID)
	must.NoErr(t, err)
	if _, _, err := srv.deleteRule(ctx, deleteRuleInput{ID: ruleID, Confirm: true}); err != nil {
		t.Fatalf("deleteRule() error = %v", err)
	}
	alexOwner, _ := test.OwnerByName(ctx, store.Accounts, "alex")
	if _, _, err := srv.createManualAccount(ctx, model.CreateManualAccountInput{Name: "Cash", OwnerID: alexOwner.ID, Type: model.AccountTypeDepository}); err != nil {
		t.Fatalf("createManualAccount() error = %v", err)
	}
	if _, _, err := srv.updateAccount(ctx, model.UpdateAccountInput{ID: accID, Name: new("Updated Checking"), Type: new(model.AccountTypeCredit)}); err != nil {
		t.Fatalf("updateAccount() error = %v", err)
	}
	badType := model.AccountType("BAD")
	if _, _, err := srv.updateAccount(ctx, model.UpdateAccountInput{ID: accID, Type: &badType}); err == nil {
		t.Fatalf("updateAccount bad type should fail")
	}
	created, _, err := srv.createTransaction(ctx, model.CreateTransactionInput{AccountID: accID, Date: model.Date("2026-05-22"), Amount: money.FromDollars(12.34), MerchantName: new("Manual Coffee"), CategoryID: &groceries})
	must.NoErr(t, err)
	manualID, err := model.DecodeGlobalID(created.(leanTransactionPayload).Transaction.ID)
	must.NoErr(t, err)
	if _, _, err := srv.bulkDeleteTransactions(ctx, bulkDeleteTransactionsInput{TransactionIds: []*model.GlobalID{&manualID}, Confirm: true}); err != nil {
		t.Fatalf("bulkDeleteTransactions() error = %v", err)
	}
	value, _, err = srv.deleteTransaction(ctx, deleteTransactionInput{ID: tx1ID, Confirm: true})
	must.NoErr(t, err)
	if !value.(*model.DeleteTransactionPayload).Success {
		t.Fatalf("delete payload = %#v", value)
	}
}

func TestPortfolioTools(t *testing.T) {
	ctx := auth.ContextWithScopes(context.Background(), auth.AllScopes)
	portfolioSvc := &fakePortfolioService{}
	resolver := &graph.Resolver{Portfolio: portfolioSvc}
	srv := &Server{resolver: resolver}
	ownerID := model.New(model.GlobalIDOwner, 1)
	accountID := model.New(model.GlobalIDAccount, 123)
	includeUnclassified := true

	value, summary, err := srv.portfolioAnalysis(ctx, model.AnalysisInput{
		View:                model.AnalysisViewSectors,
		OwnerIds:            []*model.GlobalID{&ownerID},
		AccountSubtypes:     []string{"401k"},
		AccountIds:          []*model.GlobalID{&accountID},
		IncludeUnclassified: &includeUnclassified,
	})
	must.NoErr(t, err)
	report := value.(*leanAnalysisReport)
	if report.TotalValueUsd != money.FromDollars(123.45) || summary == "" {
		t.Fatalf("portfolio analysis value=%#v summary=%q", value, summary)
	}
	if portfolioSvc.view != model.AnalysisViewSectors ||
		len(portfolioSvc.filter.OwnerIDs) != 1 ||
		portfolioSvc.filter.OwnerIDs[0] != 1 ||
		len(portfolioSvc.filter.AccountIDs) != 1 ||
		portfolioSvc.filter.AccountIDs[0] != 123 ||
		!portfolioSvc.filter.IncludeUnclassified {
		t.Fatalf("portfolio filter = %#v", portfolioSvc.filter)
	}
	if _, _, err := srv.portfolioAnalysis(ctx, model.AnalysisInput{View: model.AnalysisView("BAD")}); err == nil {
		t.Fatalf("portfolioAnalysis bad view should fail")
	}

}

func TestBudgetTools(t *testing.T) {
	ctx := auth.ContextWithScopes(context.Background(), auth.AllScopes)
	store := openMCPTestStore(t)
	budgetsSvc := &budgets.Service{Store: store.Budgets, Spending: store.Transactions, Categories: store.Transactions}
	resolver := &graph.Resolver{AccountsStore: store.Accounts, WealthDB: store.WealthDB, TransactionsStore: store.Transactions, Budgets: budgetsSvc}
	srv := &Server{resolver: resolver}
	groceries := model.New(model.GlobalIDCategory, test.CategoryIDByName(t, store.Transactions, "Groceries"))

	value, summary, err := srv.setBudget(ctx, model.SetBudgetInput{Month: "2026-05", CategoryID: groceries, Amount: 500})
	must.NoErr(t, err)
	if value.(map[string]leanBudget)["budget"].Amount != 500 || summary == "" {
		t.Fatalf("set budget value=%#v summary=%q", value, summary)
	}

	value, summary, err = srv.budgetReport(ctx, model.BudgetReportInput{Month: "2026-05"})
	must.NoErr(t, err)
	if value.(*leanBudgetReport).Month != "2026-05" || summary == "" {
		t.Fatalf("budget report value=%#v summary=%q", value, summary)
	}
}

func TestRegisteredToolsSDKPath(t *testing.T) {
	store, srv := openMCPTestServer(t)
	account := test.SeedPlaidAccount(t, store.Accounts, store.AdminDB, "acc", "alex")
	mustSeedMCPTransaction(t, store, "sdk-tx-1", "acc", 4.50, "2026-05-20T12:00:00Z")
	mcpSrv := mcpsdk.NewMCPServer("test", "0.0.0", mcpsdk.WithInputSchemaValidation())
	srv.registerTools(mcpSrv)
	call := func(tb testing.TB, ctx context.Context, tool, arguments string) *mcp.CallToolResult {
		tb.Helper()
		message := fmt.Appendf(
			nil,
			`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":%q,"arguments":%s}}`,
			tool,
			arguments,
		)
		response, ok := mcpSrv.HandleMessage(ctx, message).(mcp.JSONRPCResponse)
		if !ok {
			tb.Fatalf("HandleMessage(%s) returned an unexpected response", tool)
		}
		result, ok := response.Result.(*mcp.CallToolResult)
		if !ok {
			tb.Fatalf("HandleMessage(%s) result = %T", tool, response.Result)
		}
		return result
	}

	ctx := auth.ContextWithScopes(context.Background(), auth.AllScopes)
	result := call(t, ctx, "list_accounts", `{}`)
	accounts, ok := result.StructuredContent.(*leanList[leanAccount])
	if result.IsError || !ok || len(accounts.Items) != 1 || accounts.Items[0].OwnerName != "alex" {
		t.Fatalf("list_accounts result = %#v", result)
	}
	assertError := func(ctx context.Context, tool, arguments, want string) {
		t.Helper()
		result := call(t, ctx, tool, arguments)
		text, ok := mcp.AsTextContent(result.Content[0])
		if !result.IsError || !ok || !strings.Contains(text.Text, want) {
			t.Fatalf("%s result = %#v, want error containing %q", tool, result, want)
		}
	}
	assertError(context.Background(), "list_accounts", `{}`, "forbidden: read:accounts access required")
	assertError(ctx, "get_transaction", `{"id":1}`, "input schema validation failed")
	badDate := fmt.Sprintf(`{"accountId":%q,"date":"bad","amount":1}`, account.ID.EncodedString())
	assertError(ctx, "create_transaction", badDate, "date must use YYYY-MM-DD")
	sdkTx1 := test.MustTransactionBySourceExternalID(t, store.Transactions, transactions.TransactionSourcePlaid, "sdk-tx-1", "TransactionByExternalID() error = %v")
	// Explicit confirm:false (key present) bypasses JSON-schema "required"
	// presence checks and exercises the shared validator's required-struct
	// enforcement instead.
	assertError(ctx, "delete_transaction", fmt.Sprintf(`{"id":%q,"confirm":false}`, sdkTx1.ID.EncodedString()), "required")
	assertError(ctx, "delete_rule", fmt.Sprintf(`{"id":%q,"confirm":false}`, sdkTx1.ID.EncodedString()), "required")
	assertError(ctx, "delete_transaction", `{"confirm":true}`, "input schema validation failed")
	badBulkDelete := fmt.Sprintf(
		`{"transactionIds":[null],"filter":{"accountIds":[%q]},"confirm":true}`,
		account.ID.EncodedString(),
	)
	assertError(ctx, "bulk_delete_transactions", badBulkDelete, "transactionIds contains a malformed id")
	if tx := test.MustTransactionBySourceExternalID(
		t,
		store.Transactions,
		transactions.TransactionSourcePlaid,
		"sdk-tx-1",
		"TransactionByExternalID() error = %v",
	); tx == nil {
		t.Fatal("malformed bulk delete removed a filtered transaction")
	}

	must.NoErr(t, store.Close())
	result = call(t, ctx, "list_accounts", `{}`)
	text, ok := mcp.AsTextContent(result.Content[0])
	if !result.IsError || !ok || text.Text != "internal error" {
		t.Fatalf("closed-store result = %#v", result)
	}
}

func TestNetWorthToolScopesHoldingsThroughSDKPath(t *testing.T) {
	ctx := context.Background()
	store, srv := openMCPTestServer(t)
	account := test.SeedPlaidAccount(t, store.Accounts, store.AdminDB, "wealth-acc", "alex")
	asset, err := store.WealthDB.UpsertAsset(ctx, wealth.AssetUpsert{
		AssetType:  model.AssetTypeSecurity,
		Identifier: "MCP-HOLDING",
		Classifier: model.AssetClassifierPublic,
	})
	must.NoErr(t, err)
	quantity := 2.0
	must.NoErr(t, store.WealthDB.ReplaceAccountBalanceSnapshot(ctx, wealth.AccountBalanceSnapshot{
		AccountID: account.ID.Int64(), Source: "plaid", Date: "2026-06-01", SyncedAt: "2026-06-01T12:00:00Z",
		BalanceUSD: money.FromDollars(100),
		Holdings:   []wealth.AssetDailyHolding{{AssetID: asset.ID.Int64(), Quantity: &quantity, ValueUSD: 100, CountsTowardValue: true}},
	}))

	mcpSrv := mcpsdk.NewMCPServer("test", "0.0.0", mcpsdk.WithInputSchemaValidation())
	srv.registerTools(mcpSrv)
	call := func(ctx context.Context) *leanNetWorthReport {
		message := []byte(`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"net_worth","arguments":{}}}`)
		response, ok := mcpSrv.HandleMessage(ctx, message).(mcp.JSONRPCResponse)
		if !ok {
			t.Fatalf("HandleMessage returned %T", response)
		}
		result, ok := response.Result.(*mcp.CallToolResult)
		if !ok || result.IsError {
			t.Fatalf("net_worth result = %#v", response.Result)
		}
		report, ok := result.StructuredContent.(*leanNetWorthReport)
		if !ok {
			t.Fatalf("StructuredContent = %T", result.StructuredContent)
		}
		return report
	}

	withoutHoldings := call(auth.ContextWithScopes(ctx, []string{auth.ScopeReadWealth}))
	if withoutHoldings.ClassifierBreakdown[0].Holdings[0].Holdings != nil {
		t.Fatalf("net_worth without holdings scope = %#v, want holdings omitted", withoutHoldings)
	}
	withHoldings := call(auth.ContextWithScopes(ctx, []string{auth.ScopeReadWealth, auth.ScopeReadHoldings}))
	holdings := withHoldings.ClassifierBreakdown[0].Holdings[0].Holdings
	if len(holdings) != 1 || holdings[0].AssetID != asset.ID.EncodedString() || holdings[0].AccountID != account.ID.EncodedString() || holdings[0].Quantity == nil || *holdings[0].Quantity != 2 || holdings[0].Manual {
		t.Fatalf("net_worth with holdings scope = %#v", withHoldings)
	}
}

func TestToolResultReturnsStructuredContentWithTextFallback(t *testing.T) {
	value := map[string]string{"ok": "true"}
	result := toolResult(value, "summary")
	if result.StructuredContent == nil {
		t.Fatalf("result should populate StructuredContent")
	}
	if len(result.Content) != 1 {
		t.Fatalf("result.Content = %#v, want exactly one block", result.Content)
	}
	text, ok := mcp.AsTextContent(result.Content[0])
	if !ok {
		t.Fatalf("result.Content[0] = %#v, want TextContent", result.Content[0])
	}
	if !strings.HasPrefix(text.Text, "summary\n") {
		t.Fatalf("text = %q, want it to start with the summary", text.Text)
	}
	if !strings.Contains(text.Text, `"ok":"true"`) {
		t.Fatalf("text = %q, want it to contain the JSON payload", text.Text)
	}
}

func TestListTransactionsToolRejectsInvalidPageArgs(t *testing.T) {
	ctx := auth.ContextWithScopes(context.Background(), auth.AllScopes)
	store, srv := openMCPTestServer(t)
	test.SeedPlaidAccount(t, store.Accounts, store.AdminDB, "acc", "alex")

	cases := []struct {
		name  string
		input model.TransactionsInput
	}{
		{name: "first and last together", input: model.TransactionsInput{First: new(int32(1)), Last: new(int32(1))}},
		{name: "non-positive first", input: model.TransactionsInput{First: new(int32(0))}},
		{name: "malformed cursor", input: model.TransactionsInput{First: new(int32(1)), After: new("not-valid-base64!!")}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := srv.listTransactions(ctx, tc.input); err == nil {
				t.Fatal("expected error")
			}
		})
	}
}

func TestCreateManualAccountToolValidatesAccountType(t *testing.T) {
	_, srv := openMCPTestServer(t)
	_, _, err := srv.createManualAccount(context.Background(), model.CreateManualAccountInput{Name: "Cash", OwnerID: model.New(model.GlobalIDOwner, 1), Type: "BAD"})
	if err == nil {
		t.Fatalf("expected invalid account type error")
	}
}

func TestCreateManualAccountToolRejectsUnknownReferences(t *testing.T) {
	ctx := context.Background()
	store, srv := openMCPTestServer(t)
	owner := test.MustCreateOwner(t, store.Accounts, model.CreateOwnerInput{Name: "manual-owner"})
	unknownConnectionID := model.New(model.GlobalIDConnection, 999999)
	zeroConnectionID := model.New(model.GlobalIDConnection, 0)

	cases := map[string]model.CreateManualAccountInput{
		"unknown owner": {
			Name:    "Cash",
			OwnerID: model.New(model.GlobalIDOwner, 999999),
			Type:    model.AccountTypeDepository,
		},
		"unknown connection": {
			Name:         "Cash",
			OwnerID:      owner.ID,
			Type:         model.AccountTypeDepository,
			ConnectionID: &unknownConnectionID,
		},
		"zero connection": {
			Name:         "Cash",
			OwnerID:      owner.ID,
			Type:         model.AccountTypeDepository,
			ConnectionID: &zeroConnectionID,
		},
	}
	for name, input := range cases {
		t.Run(name, func(t *testing.T) {
			if _, _, err := srv.createManualAccount(ctx, input); err == nil {
				t.Fatal("expected createManualAccount error")
			}
			accounts, err := store.Accounts.Accounts(ctx)
			must.NoErr(t, err)
			if len(accounts) != 0 {
				t.Fatalf("accounts created after failed tool call: %#v", accounts)
			}
		})
	}
}
