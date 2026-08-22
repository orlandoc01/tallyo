package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"tallyo/internal/auth"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
)

func mustMarshalJSON(t *testing.T, value any) []byte {
	t.Helper()
	wire, err := json.Marshal(value)
	must.NoErr(t, err)
	return wire
}

func fixtureAccounts(n int) []*model.Account {
	accounts := make([]*model.Account, n)
	for i := range accounts {
		subtype := "checking"
		accounts[i] = &model.Account{
			ID:        model.New(model.GlobalIDAccount, int64(i)),
			Owner:     &model.Owner{ID: model.New(model.GlobalIDOwner, 1), Name: "Alex"},
			Name:      fmt.Sprintf("Account Number %d Checking", i),
			Type:      model.AccountTypeDepository,
			Subtype:   &subtype,
			Manual:    false,
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
	}
	return accounts
}

func fixtureCategories(n int) []*model.Category {
	categories := make([]*model.Category, n)
	for i := range categories {
		categories[i] = &model.Category{
			ID:             model.New(model.GlobalIDCategory, int64(i)),
			Name:           fmt.Sprintf("Category %d", i),
			Emoji:          "\U0001F4B0",
			GroupName:      "Everyday Spending",
			GroupEmoji:     "\U0001F4E6",
			Kind:           model.CategoryKindExpense,
			SortOrder:      int32(i),
			PlaidPFC2Codes: []string{"FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"},
		}
	}
	return categories
}

func fixtureTransactionConnection(n, numAccounts, numCategories int) *model.TransactionConnection {
	accounts := fixtureAccounts(numAccounts)
	categories := fixtureCategories(numCategories)
	edges := make([]*model.TransactionEdge, n)
	for i := range n {
		merchant := fmt.Sprintf("Merchant Number %d", i)
		original := fmt.Sprintf("ORIGINAL MERCHANT DESC %d", i)
		tx := &model.Transaction{
			ID:             model.New(model.GlobalIDTransaction, int64(i)),
			Account:        accounts[i%numAccounts],
			Amount:         money.FromDollars(12.34),
			Datetime:       test.DateTime("2026-05-01T12:00:00Z"),
			PostedDatetime: test.DateTime("2026-05-01T12:00:00Z"),
			MerchantName:   &merchant,
			OriginalName:   &original,
			Category:       categories[i%numCategories],
			IsRecurring:    false,
			IsReviewed:     i%2 == 0,
			Pending:        false,
			IsHidden:       false,
			CreatedAt:      time.Now(),
			UpdatedAt:      time.Now(),
		}
		edges[i] = &model.TransactionEdge{Node: tx, Cursor: fmt.Sprintf("cursor-%d", i)}
	}
	return &model.TransactionConnection{
		Edges:      edges,
		PageInfo:   &model.PageInfo{HasNextPage: true, StartCursor: &edges[0].Cursor, EndCursor: &edges[len(edges)-1].Cursor},
		TotalCount: int32(n * 4),
	}
}

func fixtureNetWorthReport(numHoldings, numAccounts int) *model.NetWorthReport {
	accounts := fixtureAccounts(numAccounts)
	holdings := make([]*model.HoldingRollup, numHoldings)
	for i := range holdings {
		name := fmt.Sprintf("Fund %d", i)
		quantity := 10.0
		asset := &model.Asset{
			ID:         model.New(model.GlobalIDAsset, int64(i+1)),
			AssetType:  model.AssetTypeSecurity,
			Identifier: fmt.Sprintf("TICK%d", i),
			Name:       &name,
			Classifier: model.AssetClassifierPublic,
		}
		account := accounts[i%numAccounts]
		holdings[i] = &model.HoldingRollup{
			Asset:               asset,
			TotalQuantity:       &quantity,
			ValueUsd:            1000,
			PercentOfClassifier: 100.0 / float64(numHoldings),
			Holdings:            []*model.Holding{{AssetID: asset.ID, Asset: asset, AccountID: account.ID, Account: account, Quantity: &quantity, ValueUsd: 1000}},
		}
	}
	return &model.NetWorthReport{
		CurrentNetWorthUsd:    100000,
		CurrentAssetsUsd:      120000,
		CurrentLiabilitiesUsd: 20000,
		ClassifierBreakdown: []*model.ClassifierBreakdown{
			{Classifier: model.AssetClassifierPublic, Label: "Public Assets", ValueUsd: 120000, PercentOfAssets: 100, AssetCount: int32(numHoldings), Holdings: holdings},
		},
		LiabilityBreakdown: []*model.LiabilityBreakdown{
			{Category: model.LiabilityCategoryCard, Label: "Cards", ValueUsd: 20000, PercentOfLiabilities: 100, AccountCount: int32(numAccounts), Accounts: accounts},
		},
	}
}

func TestMapHoldingRollupsPreservesUnknownQuantity(t *testing.T) {
	ctx := auth.ContextWithScopes(context.Background(), auth.AllScopes)
	got := mapHoldingRollups(ctx, []*model.HoldingRollup{{Asset: &model.Asset{}}})
	if len(got) != 1 || got[0].TotalQuantity != nil {
		t.Fatalf("rollups = %#v, want unknown quantity", got)
	}
}

func TestMapHoldingRollupsOmitsHoldingsWithoutScope(t *testing.T) {
	holding := &model.Holding{AssetID: model.New(model.GlobalIDAsset, 1), AccountID: model.New(model.GlobalIDAccount, 1)}
	rollups := []*model.HoldingRollup{{Asset: &model.Asset{}, Holdings: []*model.Holding{holding}}}

	withoutScope := mapHoldingRollups(context.Background(), rollups)
	if withoutScope[0].Holdings != nil {
		t.Fatalf("holdings = %#v, want omitted without read:holdings", withoutScope[0].Holdings)
	}

	withScope := mapHoldingRollups(auth.ContextWithScopes(context.Background(), []string{auth.ScopeReadHoldings}), rollups)
	if len(withScope[0].Holdings) != 1 || withScope[0].Holdings[0].AssetID != holding.AssetID.EncodedString() {
		t.Fatalf("holdings = %#v, want one lean holding", withScope[0].Holdings)
	}
	text := string(mustMarshalJSON(t, withScope))
	if !strings.Contains(text, `"quantity":null`) || !strings.Contains(text, `"manual":false`) {
		t.Fatalf("holdings should preserve canonical fields: %s", text)
	}
}

func TestListTransactionsPayloadStaysLean(t *testing.T) {
	conn := fixtureTransactionConnection(50, 15, 10)
	dto := mapTransactionConnection(conn)
	summary := fmt.Sprintf("Fetched %d transactions (%d total).", len(conn.Edges), conn.TotalCount)
	result := toolResult(dto, summary)

	wire := mustMarshalJSON(t, result)
	t.Logf("list_transactions (50 rows / 15 accounts / 10 categories) wire bytes: %d", len(wire))
	if len(wire) > 45000 {
		t.Fatalf("payload = %d bytes, want < 45000 (baseline before this fix was 99124)", len(wire))
	}
	if result.StructuredContent == nil {
		t.Fatalf("result should populate StructuredContent")
	}

	dtoJSON := mustMarshalJSON(t, dto)
	text := string(dtoJSON)
	for _, field := range []string{`"accountId"`, `"accountName"`, `"categoryId"`, `"categoryName"`, `"endCursor"`, `"totalCount"`} {
		if !strings.Contains(text, field) {
			t.Fatalf("payload missing expected field %s: %s", field, text)
		}
	}
	if !strings.Contains(text, `"isReviewed":false`) {
		t.Fatalf("payload should preserve false isReviewed: %s", text)
	}
	if strings.Contains(text, `"cursor"`) {
		t.Fatalf("payload should drop per-edge cursors: %s", text)
	}
}

func TestNetWorthPayloadStaysLean(t *testing.T) {
	nw := fixtureNetWorthReport(20, 15)
	dto := mapNetWorthReport(auth.ContextWithScopes(context.Background(), auth.AllScopes), nw)
	summary := fmt.Sprintf("Current net worth: $%.2f.", nw.CurrentNetWorthUsd.Dollars())
	result := toolResult(dto, summary)

	wire := mustMarshalJSON(t, result)
	t.Logf("net_worth (20 holdings / 15 accounts) wire bytes: %d", len(wire))
	if len(wire) > 30000 {
		t.Fatalf("payload = %d bytes, want < 30000 (baseline before this fix was 35202)", len(wire))
	}
	if result.StructuredContent == nil {
		t.Fatalf("result should populate StructuredContent")
	}

	dtoJSON := mustMarshalJSON(t, dto)
	text := string(dtoJSON)
	for _, field := range []string{`"ownerName"`, `"identifier"`, `"currentNetWorthUSD"`} {
		if !strings.Contains(text, field) {
			t.Fatalf("payload missing expected field %s: %s", field, text)
		}
	}
	if strings.Contains(text, `"connection":`) || strings.Contains(text, `"mask"`) {
		t.Fatalf("payload should not repeat the full nested Connection/mask fields: %s", text)
	}
}

func TestNetWorthPayloadOmitsHoldingsWithoutScope(t *testing.T) {
	nw := fixtureNetWorthReport(3, 2)
	dto := mapNetWorthReport(context.Background(), nw)
	for _, classifier := range dto.ClassifierBreakdown {
		for _, rollup := range classifier.Holdings {
			if rollup.Holdings != nil {
				t.Fatalf("holdings = %#v, want omitted without read:holdings", rollup.Holdings)
			}
		}
	}

	// classifierBreakdown[].holdings (the rollup list itself) is unprotected and
	// always present; only the per-account rows nested inside each rollup
	// (marked by their assetId/accountId fields) are scope-gated.
	dtoJSON := mustMarshalJSON(t, dto)
	if strings.Contains(string(dtoJSON), `"assetId"`) || strings.Contains(string(dtoJSON), `"accountId"`) {
		t.Fatalf("payload should omit per-account holding rows without read:holdings: %s", dtoJSON)
	}
}
