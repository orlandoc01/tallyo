package transactionsdb_test

import (
	"context"
	"slices"
	"strconv"
	"testing"
	"time"

	"tallyo/internal/database/dbtest"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/transactions"
	"tallyo/internal/transactions/categorizer"
	transactionsdb "tallyo/internal/transactions/db"
	u "tallyo/internal/utils"
	testutil "tallyo/internal/utils/test"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
	"tallyo/internal/utils/must"
)

func TestTransactionsWithFilters(t *testing.T) {
	ctx := context.Background()
	_, tx := openSeededTestStore(t)

	txns := []transactions.SyncedTransaction{
		syncedTxn("f-1", 5, "2026-05-10T12:00:00Z", "Alpha Store"),
		syncedTxn("f-2", 15, "2026-05-11T12:00:00Z", "Beta Corp"),
		syncedTxn("f-3", 25, "2026-05-12T12:00:00Z", "Gamma Inc"),
	}
	for _, txn := range txns {
		mustUpsertSynced(t, tx, txn)
	}

	first := int32(2)
	conn, err := tx.Transactions(ctx, transactions.TransactionQuery{First: &first})
	if err != nil || len(conn.Edges) != 2 {
		t.Fatalf("Transactions(first=2) = %d edges, %v", len(conn.Edges), err)
	}

	search := "Alpha"
	conn2, err := tx.Transactions(ctx, transactions.TransactionQuery{Filter: &model.TransactionsFilter{MerchantPrefix: &search}})
	if err != nil || len(conn2.Edges) != 1 {
		t.Fatalf("Transactions(search=Alpha) = %d edges, %v", len(conn2.Edges), err)
	}

	minAmt := money.FromDollars(10.0)
	conn3, err := tx.Transactions(ctx, transactions.TransactionQuery{Filter: &model.TransactionsFilter{AmountMin: &minAmt}})
	if err != nil || len(conn3.Edges) != 2 {
		t.Fatalf("Transactions(amountMin=10) = %d edges, %v", len(conn3.Edges), err)
	}

	isReviewed := false
	conn4, err := tx.Transactions(ctx, transactions.TransactionQuery{Filter: &model.TransactionsFilter{IsReviewed: &isReviewed}})
	must.NoErr(t, err)
	if conn4.TotalCount == 0 {
		t.Fatal("expected non-reviewed transactions")
	}

	isPending := false
	conn5, err := tx.Transactions(ctx, transactions.TransactionQuery{Filter: &model.TransactionsFilter{IsPending: &isPending}})
	must.NoErr(t, err)
	_ = conn5
}

func TestAggregateTransactionQueryPlans(t *testing.T) {
	_, tx := openTestStore(t)
	unfiltered := `EXPLAIN QUERY PLAN
SELECT COUNT(t.id)
FROM transactions t
WHERE t.staged_for_llm = 0`
	dbtest.AssertQueryPlanOmits(t, tx.SQL(), unfiltered, "SEARCH a", "SEARCH c", "SEARCH cg")

	ownerFiltered := `EXPLAIN QUERY PLAN
SELECT COUNT(t.id)
FROM transactions t
JOIN accounts a ON a.id = t.account_id
WHERE t.staged_for_llm = 0
  AND a.owner_id IN (1)`
	dbtest.AssertQueryPlanUses(t, tx.SQL(), ownerFiltered, "idx_accounts_owner")

	kindFiltered := `EXPLAIN QUERY PLAN
SELECT COUNT(t.id)
FROM transactions t
JOIN category_rows cr ON cr.cat_id = t.category_id
WHERE t.staged_for_llm = 0
  AND cr.group_kind NOT IN ('INCOME')`
	dbtest.AssertQueryPlanUses(t, tx.SQL(), kindFiltered, "SEARCH c", "SEARCH cg")
}

func TestBulkDeleteTransactions(t *testing.T) {
	ctx := context.Background()
	_, tx := openSeededTestStore(t)
	for _, id := range []string{"del-1", "del-2", "del-3"} {
		mustUpsertSynced(t, tx, syncedTxn(id, 1, "2026-05-10T12:00:00Z", ""))
	}

	del1ID := mustTransactionGlobalID(t, tx, "del-1")
	del2ID := mustTransactionGlobalID(t, tx, "del-2")
	count, err := tx.BulkDeleteTransactions(ctx, model.BulkDeleteTransactionsInput{TransactionIds: []*model.GlobalID{&del1ID, &del2ID}})
	must.NoErr(t, err)
	if count != 2 {
		t.Fatalf("BulkDeleteTransactions() = %d, want 2", count)
	}
	if _, err := tx.BulkDeleteTransactions(ctx, model.BulkDeleteTransactionsInput{}); err == nil {
		t.Fatalf("BulkDeleteTransactions(neither) expected error")
	}
	prefix := "del"
	if _, err := tx.BulkDeleteTransactions(ctx, model.BulkDeleteTransactionsInput{TransactionIds: []*model.GlobalID{&del1ID}, Filter: &model.TransactionsFilter{MerchantPrefix: &prefix}}); err == nil {
		t.Fatalf("BulkDeleteTransactions(both) expected error")
	}
}

func TestBulkUpdateTransactions(t *testing.T) {
	ctx := context.Background()
	_, tx := openSeededTestStore(t)
	for _, id := range []string{"buc-1", "buc-2", "buc-3"} {
		merchant := "Bulk Grocery"
		if id == "buc-3" {
			merchant = "Other"
		}
		mustUpsertSynced(t, tx, syncedTxn(id, 1, "2026-05-10T12:00:00Z", merchant))
	}
	cats, _ := tx.Categories(ctx)
	catID := cats[0].ID
	for _, cat := range cats {
		if cat.ID.Int64() != 0 {
			catID = cat.ID
			break
		}
	}
	notes := "bulk memo"
	merchantName := "Household Grocery"
	isHidden := true
	prefix := "Bulk"

	result, err := tx.BulkUpdateTransactions(ctx, model.BulkUpdateTransactionsInput{Filter: &model.TransactionsFilter{MerchantPrefix: &prefix}, Updates: &model.TransactionUpdates{CategoryID: &catID, MerchantName: &merchantName, Notes: &notes, IsHidden: &isHidden}})
	must.NoErr(t, err)
	if len(result) != 2 {
		t.Fatalf("BulkUpdateTransactions(filter) = %d txns, want 2", len(result))
	}
	for _, updated := range result {
		if updated.Category.ID != catID || updated.MerchantName == nil || *updated.MerchantName != merchantName || updated.Notes == nil || *updated.Notes != notes || !updated.IsHidden {
			t.Fatalf("BulkUpdateTransactions(filter) transaction = %#v", updated)
		}
	}
	unmatched, err := testutil.TransactionBySourceExternalID(ctx, tx, transactions.TransactionSourcePlaid, "buc-3")
	if err != nil || unmatched.Category.ID == catID || unmatched.Notes != nil || unmatched.IsHidden {
		t.Fatalf("unmatched transaction = %#v, %v", unmatched, err)
	}

	tag := mustCreateTag(t, tx, model.CreateTagInput{Name: "Bulk", Color: "#3B82F6"})
	buc1ID := mustTransactionGlobalID(t, tx, "buc-1")
	if _, err := tx.BulkUpdateTransactions(ctx, model.BulkUpdateTransactionsInput{TransactionIds: []*model.GlobalID{&buc1ID}, Updates: &model.TransactionUpdates{TagIds: []*model.GlobalID{&tag.ID}}}); err != nil {
		t.Fatalf("BulkUpdateTransactions(tags): %v", err)
	}
	buc1LocalID := mustTransactionByExternalID(t, tx, "buc-1").ID.Int64()
	tagsByTxnID, err := tx.TagsByTransactionIDs(ctx, []int64{buc1LocalID})
	tags := tagsByTxnID[buc1LocalID]
	if err != nil || len(tags) != 1 || tags[0].ID != tag.ID {
		t.Fatalf("TagsByTransactionIDs() = %#v, %v", tagsByTxnID, err)
	}
	if _, err := tx.BulkUpdateTransactions(ctx, model.BulkUpdateTransactionsInput{Updates: &model.TransactionUpdates{}}); err == nil {
		t.Fatalf("BulkUpdateTransactions(neither) expected error")
	}
	if _, err := tx.BulkUpdateTransactions(ctx, model.BulkUpdateTransactionsInput{TransactionIds: []*model.GlobalID{&buc1ID}, Filter: &model.TransactionsFilter{MerchantPrefix: &prefix}, Updates: &model.TransactionUpdates{}}); err == nil {
		t.Fatalf("BulkUpdateTransactions(both) expected error")
	}
}

func TestBulkMutationsRejectNormalizedEmptyFilters(t *testing.T) {
	isHidden := true
	whitespace := " \t"
	falseValue := false
	emptyIDs := []*model.GlobalID{nil}
	wrongTypeID := model.New(model.GlobalIDCategory, 1)
	cases := []struct {
		name                       string
		filter                     model.TransactionsFilter
		expectsExplicitTargetError bool
	}{
		{name: "whitespace merchant", filter: model.TransactionsFilter{MerchantPrefix: &whitespace}},
		{name: "whitespace original", filter: model.TransactionsFilter{OriginalPrefix: &whitespace}},
		{name: "whitespace search", filter: model.TransactionsFilter{Search: &whitespace}},
		{name: "empty date range", filter: model.TransactionsFilter{DatetimeRange: &model.DateTimeRange{}}},
		{name: "nil IDs", filter: model.TransactionsFilter{CategoryIds: emptyIDs, AccountIds: emptyIDs, OwnerIds: emptyIDs, TagIds: emptyIDs}},
		{name: "false toggles", filter: model.TransactionsFilter{ExcludeTransfers: &falseValue, ExcludeIncome: &falseValue, Untagged: &falseValue}},
		{name: "wrong type ID", filter: model.TransactionsFilter{AccountIds: []*model.GlobalID{&wrongTypeID}}, expectsExplicitTargetError: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			_, tx := openSeededTestStore(t)
			for _, externalID := range []string{"empty-filter-update", "empty-filter-delete", "empty-filter-keep"} {
				mustUpsertSynced(t, tx, syncedTxn(externalID, 1, "2026-05-10T12:00:00Z", "Bulk target"))
			}
			updateID := mustTransactionGlobalID(t, tx, "empty-filter-update")
			if tc.expectsExplicitTargetError {
				if _, err := tx.BulkDeleteTransactions(ctx, model.BulkDeleteTransactionsInput{TransactionIds: []*model.GlobalID{&updateID}, Filter: &tc.filter}); err == nil || err.Error() != "exactly one of transactionIds or filter is required" {
					t.Fatalf("BulkDeleteTransactions() error = %v", err)
				}
				return
			}
			deleteID := mustTransactionGlobalID(t, tx, "empty-filter-delete")

			if _, err := tx.BulkDeleteTransactions(ctx, model.BulkDeleteTransactionsInput{Filter: &tc.filter}); err == nil || err.Error() != "exactly one of transactionIds or filter is required" {
				t.Fatalf("BulkDeleteTransactions() error = %v", err)
			}
			if _, err := tx.BulkUpdateTransactions(ctx, model.BulkUpdateTransactionsInput{Filter: &tc.filter, Updates: &model.TransactionUpdates{IsHidden: &isHidden}}); err == nil || err.Error() != "exactly one of transactionIds or filter is required" {
				t.Fatalf("BulkUpdateTransactions() error = %v", err)
			}
			for _, externalID := range []string{"empty-filter-update", "empty-filter-delete", "empty-filter-keep"} {
				if transaction := mustTransactionByExternalID(t, tx, externalID); transaction.IsHidden {
					t.Fatalf("%s was updated", externalID)
				}
			}

			updated, err := tx.BulkUpdateTransactions(ctx, model.BulkUpdateTransactionsInput{TransactionIds: []*model.GlobalID{&updateID}, Filter: &tc.filter, Updates: &model.TransactionUpdates{IsHidden: &isHidden}})
			if err != nil || len(updated) != 1 || updated[0].ID != updateID || !updated[0].IsHidden {
				t.Fatalf("BulkUpdateTransactions() = %#v, %v", updated, err)
			}
			if mustTransactionByExternalID(t, tx, "empty-filter-delete").IsHidden || mustTransactionByExternalID(t, tx, "empty-filter-keep").IsHidden {
				t.Fatal("explicit update changed an unrequested transaction")
			}

			deleted, err := tx.BulkDeleteTransactions(ctx, model.BulkDeleteTransactionsInput{TransactionIds: []*model.GlobalID{&deleteID}, Filter: &tc.filter})
			if err != nil || deleted != 1 {
				t.Fatalf("BulkDeleteTransactions() = %d, %v", deleted, err)
			}
			deletedTransaction, err := testutil.TransactionBySourceExternalID(ctx, tx, transactions.TransactionSourcePlaid, "empty-filter-delete")
			if err != nil || deletedTransaction != nil {
				t.Fatalf("deleted transaction = %#v, %v", deletedTransaction, err)
			}
			if mustTransactionByExternalID(t, tx, "empty-filter-update") == nil || mustTransactionByExternalID(t, tx, "empty-filter-keep") == nil {
				t.Fatal("explicit delete changed an unrequested transaction")
			}
		})
	}
}

func TestBulkMutationsRejectWrongTypedFilterOnly(t *testing.T) {
	ctx := context.Background()
	_, tx := openSeededTestStore(t)
	mustUpsertSynced(t, tx, syncedTxn("wrong-typed-filter-keep", 1, "2026-05-10T12:00:00Z", "Bulk target"))
	wrongTypeID := model.New(model.GlobalIDCategory, 1)
	filter := model.TransactionsFilter{AccountIds: []*model.GlobalID{&wrongTypeID}}
	isHidden := true
	if _, err := tx.BulkDeleteTransactions(ctx, model.BulkDeleteTransactionsInput{Filter: &filter}); err == nil {
		t.Fatal("BulkDeleteTransactions(wrong-typed filter only) error = nil, want ID type error")
	}
	if _, err := tx.BulkUpdateTransactions(ctx, model.BulkUpdateTransactionsInput{Filter: &filter, Updates: &model.TransactionUpdates{IsHidden: &isHidden}}); err == nil {
		t.Fatal("BulkUpdateTransactions(wrong-typed filter only) error = nil, want ID type error")
	}
	if transaction := mustTransactionByExternalID(t, tx, "wrong-typed-filter-keep"); transaction == nil || transaction.IsHidden {
		t.Fatalf("transaction after rejected bulk mutations = %#v", transaction)
	}
}

func TestBulkMutationsFilterBySearch(t *testing.T) {
	ctx := context.Background()
	_, tx := openSeededTestStore(t)
	mustUpsertSynced(t, tx, syncedTxn("search-update", 10, "2026-05-10T12:00:00Z", "Searchable update"))
	mustUpsertSynced(t, tx, syncedTxn("search-delete", 20, "2026-05-11T12:00:00Z", "Searchable delete"))
	mustUpsertSynced(t, tx, syncedTxn("search-keep", 30, "2026-05-12T12:00:00Z", "Unrelated"))

	updateSearch := "Searchable update"
	isHidden := true
	updated, err := tx.BulkUpdateTransactions(ctx, model.BulkUpdateTransactionsInput{
		Filter:  &model.TransactionsFilter{Search: &updateSearch},
		Updates: &model.TransactionUpdates{IsHidden: &isHidden},
	})
	must.NoErr(t, err)
	if len(updated) != 1 || updated[0].ID != mustTransactionGlobalID(t, tx, "search-update") || !updated[0].IsHidden {
		t.Fatalf("BulkUpdateTransactions(search) = %#v", updated)
	}
	if mustTransactionByExternalID(t, tx, "search-keep").IsHidden {
		t.Fatal("unmatched transaction was updated")
	}

	deleteSearch := "Searchable delete"
	deleted, err := tx.BulkDeleteTransactions(ctx, model.BulkDeleteTransactionsInput{Filter: &model.TransactionsFilter{Search: &deleteSearch}})
	must.NoErr(t, err)
	if deleted != 1 {
		t.Fatalf("BulkDeleteTransactions(search) = %d, want 1", deleted)
	}
	if got := mustTransactionByExternalID(t, tx, "search-keep"); got == nil {
		t.Fatal("unmatched transaction was deleted")
	}
}

func TestCashFlow(t *testing.T) {
	tx, filter := spendingReportFixture(t, syncedTxn("cf-tx", 50, "2026-05-15T12:00:00Z", ""))
	monthly := model.GranularityMonthly
	filter.Granularity = &monthly
	periods, err := tx.CashFlow(context.Background(), filter)
	must.NoErr(t, err)
	if len(periods) != 1 || periods[0].PeriodLabel != "2026-05" {
		t.Fatalf("CashFlow() periods = %#v, want one May period", periods)
	}
	if periods[0].Summary.Expenses != money.FromDollars(50) || periods[0].Summary.Savings != -money.FromDollars(50) {
		t.Fatalf("CashFlow() summary = %#v", periods[0].Summary)
	}
}

func TestLLMCategorizationHelpers(t *testing.T) {
	ctx := context.Background()
	_, tx := openSeededTestStore(t)
	llmTxn := syncedTxn("llm-tx", 8, "2026-05-10T12:00:00Z", "")
	llmTxn.StageForLLM = true
	mustUpsertSynced(t, tx, llmTxn)

	staged := mustUncategorizedForLLM(t, tx, 10)
	if len(staged) == 0 {
		t.Fatal("expected staged transactions for LLM")
	}
	llmCategories, err := tx.CategoriesForLLM(ctx)
	must.NoErr(t, err)
	if len(llmCategories) == 0 {
		t.Fatal("expected LLM categories")
	}
	must.NoErr(t, tx.ClearStagedForLLMByIDs(ctx, nil))
	must.NoErr(t, tx.ClearStagedForLLMByIDs(ctx, []string{staged[0].ID}))
	clearedByID := mustUncategorizedForLLM(t, tx, 10)
	if len(clearedByID) != 0 {
		t.Fatalf("expected 0 staged after clear by ids, got %d", len(clearedByID))
	}

	examples, err := tx.TopMerchantExamples(ctx, 5)
	must.NoErr(t, err)
	_ = examples
	categoryID := model.New(model.GlobalIDCategory, testutil.CategoryIDByName(t, tx, "Coffee Shops"))
	accountID := mustTestAccountID(t, tx)
	createExample := func(merchant string, date model.Date, amount float64) {
		t.Helper()
		created := mustCreateTransaction(t, tx, model.CreateTransactionInput{
			AccountID:    accountID,
			Date:         date,
			Amount:       money.FromDollars(amount),
			MerchantName: &merchant,
			CategoryID:   &categoryID,
		})
		if created.Amount != money.FromDollars(amount) || created.MerchantName == nil || *created.MerchantName != merchant || created.Category.ID != categoryID {
			t.Fatalf("CreateTransaction() = %#v", created)
		}
	}
	createExample("TeSt", model.Date("2026-05-10"), 12)
	createExample("test", model.Date("2026-05-11"), 13)
	createExample("TEST", model.Date("2026-05-12"), 14)
	createExample("Other", model.Date("2026-05-09"), 21)
	createExample("other", model.Date("2026-05-13"), 22)
	createExample("OTHER", model.Date("2026-05-14"), 23)

	batched, err := tx.SimilarCategorizedByMerchants(ctx, []string{"TEST", "OTHER", "missing"}, 2)
	must.NoErr(t, err)
	if !slices.Equal(exampleAmounts(batched["test"]), []float64{14, 13}) || !slices.Equal(exampleAmounts(batched["other"]), []float64{23, 22}) || len(batched["missing"]) != 0 {
		t.Fatalf("SimilarCategorizedByMerchants() = %#v", batched)
	}
	similarPlan := `EXPLAIN QUERY PLAN
SELECT merchant_key, merchant_name, amount_cents, category_id, category_name
FROM (
  SELECT
    CAST(LOWER(t.merchant_name) AS TEXT) AS merchant_key,
    t.merchant_name,
    t.amount_cents,
    cr.cat_id AS category_id,
    cr.cat_name AS category_name,
    t.datetime,
    t.id,
    CAST(ROW_NUMBER() OVER (
      PARTITION BY LOWER(t.merchant_name)
      ORDER BY t.datetime DESC, t.id DESC
    ) AS INTEGER) AS merchant_rank
  FROM transactions t
  JOIN category_rows cr ON cr.cat_id = t.category_id
  WHERE t.merchant_name IS NOT NULL
    AND t.is_reviewed = 1
    AND LOWER(t.merchant_name) IN ('test')
    AND cr.group_kind = 'EXPENSE'
    AND t.datetime < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-7 days')
) ranked
WHERE merchant_rank <= 2
ORDER BY datetime DESC, id DESC`
	dbtest.AssertQueryPlanUses(t, tx.SQL(), similarPlan, "idx_transactions_reviewed_merchant_category_datetime")
	dbtest.AssertQueryPlanOmits(t, tx.SQL(), similarPlan, "CORRELATED")

	must.NoErr(t, tx.ClearStagedForLLM(ctx))

	staged2 := mustUncategorizedForLLM(t, tx, 10)
	if len(staged2) != 0 {
		t.Fatalf("expected 0 staged after clear, got %d", len(staged2))
	}
}

func exampleAmounts(examples []categorizer.ExampleTransaction) []float64 {
	toAmount := func(example categorizer.ExampleTransaction) float64 { return example.Amount }
	return u.Map(examples, toAmount)
}

func mustUncategorizedForLLM(tb testing.TB, store *transactionsdb.Store, limit int) []categorizer.TransactionInput {
	tb.Helper()
	staged, err := store.UncategorizedForLLM(context.Background(), limit)
	must.NoErr(tb, err)
	return staged
}

func TestImportTransactions(t *testing.T) {
	ctx := context.Background()
	_, tx := openSeededTestStore(t)

	rows := []transactions.ImportRow{
		{AccountID: "test-acc", Datetime: testutil.DateTime("2026-05-10T12:00:00Z"), Amount: 10.0, MerchantName: "Import Test"},
	}
	result, err := tx.ImportTransactions(ctx, rows)
	must.NoErr(t, err)
	if result.Processed != 1 {
		t.Fatalf("ImportTransactions() processed = %d, want 1", result.Processed)
	}
}

func TestImportTransactionsUpdatesDuplicateExternalID(t *testing.T) {
	ctx := context.Background()
	_, tx := openSeededTestStore(t)

	firstRows := []transactions.ImportRow{
		{
			ExternalID:   "csv-tx-1",
			AccountID:    "test-acc",
			Datetime:     testutil.DateTime("2026-05-10T12:00:00Z"),
			Amount:       money.FromDollars(10.0),
			MerchantName: "Import Test",
		},
	}
	secondRows := []transactions.ImportRow{
		{
			ExternalID:   "csv-tx-1",
			AccountID:    "test-acc",
			Datetime:     testutil.DateTime("2026-05-11T12:00:00Z"),
			Amount:       money.FromDollars(12.34),
			MerchantName: "Updated Import",
			Notes:        "changed",
		},
	}

	first, err := tx.ImportTransactions(ctx, firstRows)
	must.NoErr(t, err)
	second, err := tx.ImportTransactions(ctx, secondRows)
	must.NoErr(t, err)

	if first.Processed != 1 || first.Skipped != 0 {
		t.Fatalf("first ImportTransactions() = processed %d skipped %d, want 1/0", first.Processed, first.Skipped)
	}
	if second.Processed != 1 || second.Skipped != 0 || len(second.Errors) != 0 {
		t.Fatalf(
			"second ImportTransactions() = processed %d skipped %d errors %v, want 1/0/[]",
			second.Processed,
			second.Skipped,
			second.Errors,
		)
	}

	var amount int64
	var merchantName string
	var notes string
	must.NoErr(t, tx.SQL().QueryRowContext(
		ctx,
		`SELECT amount_cents, merchant_name, notes
		 FROM transactions
		 WHERE source = 'manual' AND external_id = ?`,
		"csv-tx-1",
	).Scan(&amount, &merchantName, &notes))
	if amount != int64(money.FromDollars(12.34)) || merchantName != "Updated Import" || notes != "changed" {
		t.Fatalf("imported transaction = amount %d merchant %q notes %q, want updated row", amount, merchantName, notes)
	}
}

func TestImportTransactionsUpdatesSyncedExternalID(t *testing.T) {
	ctx := context.Background()
	_, tx := openSeededTestStore(t)

	rawProviderJSON := `{"provider":"plaid"}`
	providerTxn := syncedTxn("provider-tx-1", 10, "2026-05-10T12:00:00Z", "Original Import")
	providerTxn.Source = transactions.TransactionSourcePlaid
	providerTxn.RawProviderJSON = &rawProviderJSON
	mustUpsertSynced(t, tx, providerTxn)

	result, err := tx.ImportTransactions(ctx, []transactions.ImportRow{
		{
			ExternalID:   "provider-tx-1",
			Source:       transactions.TransactionSourcePlaid,
			AccountID:    "test-acc",
			Datetime:     testutil.DateTime("2026-05-11T12:00:00Z"),
			Amount:       money.FromDollars(12.34),
			MerchantName: "Updated Import",
			Notes:        "changed",
		},
	})
	must.NoErr(t, err)
	if result.Processed != 1 || result.Skipped != 0 || len(result.Errors) != 0 {
		t.Fatalf("ImportTransactions() = processed %d skipped %d errors %v, want 1/0/[]", result.Processed, result.Skipped, result.Errors)
	}

	var source string
	var amount int64
	var merchant string
	var notes string
	var rawProviderJSONAfter string
	must.NoErr(t, tx.SQL().QueryRowContext(
		ctx,
		`SELECT source, amount_cents, merchant_name, notes, raw_provider_json
		 FROM transactions
		 WHERE source = ? AND external_id = ?`,
		transactions.TransactionSourcePlaid,
		"provider-tx-1",
	).Scan(&source, &amount, &merchant, &notes, &rawProviderJSONAfter))
	if source != transactions.TransactionSourcePlaid || amount != int64(money.FromDollars(12.34)) || merchant != "Updated Import" || notes != "changed" || rawProviderJSONAfter != rawProviderJSON {
		t.Fatalf("imported transaction = source %q amount %d merchant %q notes %q raw %q, want updated provider row", source, amount, merchant, notes, rawProviderJSONAfter)
	}
}

func TestImportTransactionsAcceptsGraphQLAccountID(t *testing.T) {
	ctx := context.Background()
	_, tx := openSeededTestStore(t)

	accountID := mustTestAccountID(t, tx)
	rows := []transactions.ImportRow{
		{AccountID: accountID.EncodedString(), Datetime: testutil.DateTime("2026-05-10T12:00:00Z"), Amount: 10.0, MerchantName: "Import Test"},
		{AccountID: model.New(model.GlobalIDAccount, 999_999).EncodedString(), Datetime: testutil.DateTime("2026-05-11T12:00:00Z"), Amount: 11.0, MerchantName: "Missing Account"},
	}
	result, err := tx.ImportTransactions(ctx, rows)
	must.NoErr(t, err)
	if result.Processed != 1 || result.Skipped != 1 {
		t.Fatalf("ImportTransactions() = processed %d skipped %d, want 1/1", result.Processed, result.Skipped)
	}
	if len(result.Errors) != 1 || result.Errors[0].Row != 2 {
		t.Fatalf("ImportTransactions() errors = %#v, want row 2", result.Errors)
	}
}

func TestCategoryWithPlaidMappings(t *testing.T) {
	ctx := context.Background()
	_, tx := openTestStore(t)

	// Find a seeded category with PFC2 codes and clear them (exercises replaceCategoryPlaidMappings)
	groups, err := tx.CategoryGroups(ctx)
	must.NoErr(t, err)
	var targetCat *model.Category
	var targetGroupID model.GlobalID
	for _, g := range groups {
		for _, c := range g.Categories {
			if len(c.PlaidPFC2Codes) > 0 {
				targetCat = c
				targetGroupID = g.ID
				break
			}
		}
		if targetCat != nil {
			break
		}
	}
	if targetCat == nil {
		t.Skip("no seeded category with PlaidPFC2Codes")
	}

	empty := []string{}
	updated, err := tx.UpdateCategory(ctx, model.UpdateCategoryInput{
		ID:             targetCat.ID,
		Name:           targetCat.Name,
		Emoji:          targetCat.Emoji,
		GroupID:        targetGroupID,
		PlaidPFC2Codes: empty,
	})
	must.NoErr(t, err)
	if len(updated.PlaidPFC2Codes) != 0 {
		t.Fatalf("expected empty PlaidPFC2Codes after clear, got %v", updated.PlaidPFC2Codes)
	}
}

func TestRuleWithRetroactiveApply(t *testing.T) {
	ctx := context.Background()
	_, tx := openSeededTestStore(t)
	// Seed a matching transaction before creating the rule
	mustUpsertSynced(t, tx, syncedTxn("retro-tx", 5, "2026-05-10T12:00:00Z", "RetroMerchant"))

	cats, _ := tx.Categories(ctx)
	catID := cats[0].ID
	merchantPattern := "RetroMerchant"
	applyRetro := true
	rule, count := mustCreateRule(t, tx, model.CreateRuleInput{
		MerchantPattern:    &merchantPattern,
		Changes:            ruleCategoryChanges(catID),
		ApplyRetroactively: &applyRetro,
	})
	if count == 0 {
		t.Fatal("expected retroactive apply to update at least one transaction")
	}
	_ = rule
}

func TestOriginalPatternRuleAppliesRetroactively(t *testing.T) {
	cases := []struct {
		name     string
		isUpdate bool
	}{
		{name: "create"},
		{name: "update", isUpdate: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			_, tx := openSeededTestStore(t)
			originalPattern := "Original Match"
			matchingID := "original-" + tc.name + "-match"
			nonMatchingID := "original-" + tc.name + "-non-match"
			matching := syncedTxn(matchingID, 5, "2026-05-10T12:00:00Z", "merchant non-match")
			matching.OriginalName = &originalPattern
			mustUpsertSynced(t, tx, matching)
			nonMatching := syncedTxn(nonMatchingID, 7, "2026-05-11T12:00:00Z", originalPattern)
			nonMatchingOriginalName := "other original"
			nonMatching.OriginalName = &nonMatchingOriginalName
			mustUpsertSynced(t, tx, nonMatching)

			categories, err := tx.Categories(ctx)
			must.NoErr(t, err)
			categoryID := categories[1].ID
			applyRetroactively := true
			if tc.isUpdate {
				initialPattern := "no match"
				rule, _ := mustCreateRule(t, tx, model.CreateRuleInput{OriginalPattern: &initialPattern, Changes: ruleCategoryChanges(categoryID)})
				_, count, err := tx.UpdateRule(ctx, model.UpdateRuleInput{
					ID:                 rule.ID,
					OriginalPattern:    &originalPattern,
					Changes:            ruleCategoryChanges(categoryID),
					ApplyRetroactively: &applyRetroactively,
				})
				must.NoErr(t, err)
				if count != 1 {
					t.Fatalf("UpdateRule() retroactively updated %d transactions, want 1", count)
				}
			} else {
				_, count := mustCreateRule(t, tx, model.CreateRuleInput{
					OriginalPattern:    &originalPattern,
					Changes:            ruleCategoryChanges(categoryID),
					ApplyRetroactively: &applyRetroactively,
				})
				if count != 1 {
					t.Fatalf("CreateRule() retroactively updated %d transactions, want 1", count)
				}
			}
			if got := mustTransactionByExternalID(t, tx, matchingID); got.Category.ID != categoryID {
				t.Fatalf("matching transaction category = %v, want %v", got.Category.ID, categoryID)
			}
			if got := mustTransactionByExternalID(t, tx, nonMatchingID); got.Category.ID == categoryID {
				t.Fatal("merchant-only non-match was updated")
			}
		})
	}
}

func TestRetroactiveRuleDynamicFilters(t *testing.T) {
	minAmount := money.FromDollars(15)
	maxAmount := money.FromDollars(25)
	cases := []struct {
		name  string
		setup func(model.GlobalID) ([]transactions.SyncedTransaction, model.CreateRuleInput)
		want  []string
	}{
		{
			name: "merchant only",
			setup: func(_ model.GlobalID) ([]transactions.SyncedTransaction, model.CreateRuleInput) {
				merchantPattern := "merchant match"
				applyRetroactively := true
				return []transactions.SyncedTransaction{
					syncedTxn("merchant-match", 10, "2026-05-10T12:00:00Z", "Merchant Match"),
					syncedTxn("merchant-miss", 10, "2026-05-11T12:00:00Z", "Other"),
				}, model.CreateRuleInput{MerchantPattern: &merchantPattern, Changes: ruleHiddenChanges(), ApplyRetroactively: &applyRetroactively}
			},
			want: []string{"merchant-match"},
		},
		{
			name: "original only",
			setup: func(_ model.GlobalID) ([]transactions.SyncedTransaction, model.CreateRuleInput) {
				originalPattern := "original match"
				applyRetroactively := true
				matching := syncedTxn("original-match", 10, "2026-05-10T12:00:00Z", "Other")
				matching.OriginalName = new("Original Match")
				return []transactions.SyncedTransaction{
					matching,
					syncedTxn("original-miss", 10, "2026-05-11T12:00:00Z", "Other"),
				}, model.CreateRuleInput{OriginalPattern: &originalPattern, Changes: ruleHiddenChanges(), ApplyRetroactively: &applyRetroactively}
			},
			want: []string{"original-match"},
		},
		{
			name: "merchant or original",
			setup: func(_ model.GlobalID) ([]transactions.SyncedTransaction, model.CreateRuleInput) {
				merchantPattern := "merchant match"
				originalPattern := "original match"
				applyRetroactively := true
				originalMatch := syncedTxn("original-match", 10, "2026-05-10T12:00:00Z", "Other")
				originalMatch.OriginalName = new("Original Match")
				bothMatch := syncedTxn("both-match", 10, "2026-05-11T12:00:00Z", "Merchant Match")
				bothMatch.OriginalName = new("Original Match")
				return []transactions.SyncedTransaction{
					syncedTxn("merchant-match", 10, "2026-05-09T12:00:00Z", "Merchant Match"),
					originalMatch,
					bothMatch,
					syncedTxn("both-miss", 10, "2026-05-12T12:00:00Z", "Other"),
				}, model.CreateRuleInput{MerchantPattern: &merchantPattern, OriginalPattern: &originalPattern, Changes: ruleHiddenChanges(), ApplyRetroactively: &applyRetroactively}
			},
			want: []string{"merchant-match", "original-match", "both-match"},
		},
		{
			name: "amount bounds",
			setup: func(_ model.GlobalID) ([]transactions.SyncedTransaction, model.CreateRuleInput) {
				merchantPattern := "amount"
				applyRetroactively := true
				return []transactions.SyncedTransaction{
					syncedTxn("below-min", 10, "2026-05-10T12:00:00Z", "Amount"),
					syncedTxn("within-bounds", 20, "2026-05-11T12:00:00Z", "Amount"),
					syncedTxn("above-max", 30, "2026-05-12T12:00:00Z", "Amount"),
				}, model.CreateRuleInput{MerchantPattern: &merchantPattern, AmountMin: &minAmount, AmountMax: &maxAmount, Changes: ruleHiddenChanges(), ApplyRetroactively: &applyRetroactively}
			},
			want: []string{"within-bounds"},
		},
		{
			name: "account scope",
			setup: func(secondAccountID model.GlobalID) ([]transactions.SyncedTransaction, model.CreateRuleInput) {
				merchantPattern := "scoped"
				applyRetroactively := true
				second := syncedTxn("second-account", 10, "2026-05-11T12:00:00Z", "Scoped")
				second.AccountID = "second-acc"
				return []transactions.SyncedTransaction{
					syncedTxn("first-account", 10, "2026-05-10T12:00:00Z", "Scoped"),
					second,
				}, model.CreateRuleInput{MerchantPattern: &merchantPattern, AccountIds: []*model.GlobalID{&secondAccountID}, Changes: ruleHiddenChanges(), ApplyRetroactively: &applyRetroactively}
			},
			want: []string{"second-account"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			store, tx := openSeededTestStore(t)
			seedOwnerFilterAccount(ctx, t, store, 2, "second", "second-acc")
			secondID, err := testutil.AccountIDByExternalID(ctx, tx.SQL(), "second-acc")
			must.NoErr(t, err)
			transactions, input := tc.setup(model.New(model.GlobalIDAccount, secondID))
			for _, transaction := range transactions {
				mustUpsertSynced(t, tx, transaction)
			}

			_, count := mustCreateRule(t, tx, input)
			if count != int32(len(tc.want)) {
				t.Fatalf("CreateRule() updated %d transactions, want %d", count, len(tc.want))
			}
			for _, transaction := range transactions {
				got := mustTransactionByExternalID(t, tx, transaction.ExternalID)
				if wantHidden := slices.Contains(tc.want, transaction.ExternalID); got.IsHidden != wantHidden {
					t.Fatalf("transaction %q hidden = %t, want %t", transaction.ExternalID, got.IsHidden, wantHidden)
				}
			}
		})
	}
}

func TestDateRangeNormalizesOffsetsToUTC(t *testing.T) {
	ctx := context.Background()
	_, tx := openSeededTestStore(t)
	mustUpsertSynced(t, tx, syncedTxn("before-offset-range", 10, "2026-05-01T02:00:00Z", "Before"))
	mustUpsertSynced(t, tx, syncedTxn("inside-offset-range", 20, "2026-05-01T05:00:00Z", "Inside"))

	from, err := time.Parse(time.RFC3339, "2026-05-01T00:00:00-04:00")
	must.NoErr(t, err)
	to, err := time.Parse(time.RFC3339, "2026-05-01T02:00:00-04:00")
	must.NoErr(t, err)
	dateRange := &model.DateTimeRange{From: &from, To: &to}
	filter := &model.TransactionsFilter{DatetimeRange: dateRange}

	connection := mustTransactions(t, tx, transactions.TransactionQuery{Filter: filter})
	if connection.TotalCount != 1 || !slices.Equal(transactionExternalIDs(t, tx, connection), []string{"inside-offset-range"}) {
		t.Fatalf("Transactions(offset range) = %#v", connection)
	}
	summary := mustTransactionsSummary(t, tx, filter)
	if summary.TotalCount != 1 || summary.TotalAmount != money.FromDollars(20) {
		t.Fatalf("TransactionsSummary(offset range) = %#v", summary)
	}
	report, err := tx.SpendingByCategory(ctx, model.SpendingFilter{DatetimeRange: dateRange})
	must.NoErr(t, err)
	if report.TransactionCount != 1 || report.TotalAmount != money.FromDollars(20) {
		t.Fatalf("SpendingByCategory(offset range) = %#v", report)
	}
}

func TestRulePatternsMatchLiteralWildcards(t *testing.T) {
	_, tx := openSeededTestStore(t)

	mustUpsertSynced(t, tx, syncedTxn("rule-wildcard-existing-literal", 5, "2026-05-10T12:00:00Z", "Literal% Merchant"))
	mustUpsertSynced(t, tx, syncedTxn("rule-wildcard-existing-other", 7, "2026-05-11T12:00:00Z", "Plain Merchant"))

	merchantPattern := "%"
	applyRetro := true
	_, count := mustCreateRule(t, tx, model.CreateRuleInput{
		MerchantPattern:    &merchantPattern,
		Changes:            ruleHiddenChanges(),
		ApplyRetroactively: &applyRetro,
	})
	if count != 1 {
		t.Fatalf("retroactively updated count = %d, want 1", count)
	}

	literalTxn := mustTransactionByExternalID(t, tx, "rule-wildcard-existing-literal")
	if !literalTxn.IsHidden {
		t.Fatal("expected existing literal wildcard transaction to be hidden")
	}
	otherTxn := mustTransactionByExternalID(t, tx, "rule-wildcard-existing-other")
	if otherTxn.IsHidden {
		t.Fatal("expected existing plain transaction to remain visible")
	}

	mustUpsertSynced(t, tx, syncedTxn("rule-wildcard-new-other", 9, "2026-05-12T12:00:00Z", "New Plain Merchant"))
	mustUpsertSynced(t, tx, syncedTxn("rule-wildcard-new-literal", 11, "2026-05-13T12:00:00Z", "New 100% Merchant"))

	newOther := mustTransactionByExternalID(t, tx, "rule-wildcard-new-other")
	if newOther.IsHidden {
		t.Fatal("expected new plain transaction to remain visible")
	}
	newLiteral := mustTransactionByExternalID(t, tx, "rule-wildcard-new-literal")
	if !newLiteral.IsHidden {
		t.Fatal("expected new literal wildcard transaction to be hidden")
	}
}

func TestHideOnlyRuleHidesNewAndRetroactiveTransactions(t *testing.T) {
	_, tx := openSeededTestStore(t)

	merchant := "HideMerchant"
	merchantName := "HideMerchant Store"
	mustCreateRule(t, tx, model.CreateRuleInput{MerchantPattern: &merchant, Changes: ruleHiddenChanges()})
	mustUpsertSynced(t, tx, syncedTxn("hide-rule-new", 12, "2026-05-10T12:00:00Z", merchantName))
	newTxn := mustTransactionByExternalID(t, tx, "hide-rule-new")
	if !newTxn.IsHidden {
		t.Fatalf("expected new matching transaction to be hidden")
	}

	retroMerchant := "RetroHideMerchant"
	retroMerchantName := "RetroHideMerchant Store"
	mustUpsertSynced(t, tx, syncedTxn("hide-rule-retro", 18, "2026-05-11T12:00:00Z", retroMerchantName))
	applyRetro := true
	updatedRule, count := mustCreateRule(t, tx, model.CreateRuleInput{MerchantPattern: &retroMerchant, Changes: ruleHiddenChanges(), ApplyRetroactively: &applyRetro})
	if updatedRule.ShouldHide == nil || !*updatedRule.ShouldHide {
		t.Fatalf("expected rule ShouldHide to be true")
	}
	if count != 1 {
		t.Fatalf("retroactively updated count = %d, want 1", count)
	}
	retroTxn := mustTransactionByExternalID(t, tx, "hide-rule-retro")
	if !retroTxn.IsHidden {
		t.Fatalf("expected retroactive matching transaction to be hidden")
	}
}

func TestMerchantNameRuleRenamesNewAndRetroactiveTransactions(t *testing.T) {
	ctx := context.Background()
	_, tx := openSeededTestStore(t)

	retroactivePattern := "Retro Merchant"
	retroactiveName := "Renamed Retro Merchant"
	mustUpsertSynced(t, tx, syncedTxn("rename-rule-retro", 12, "2026-05-10T12:00:00Z", "Retro Merchant Store"))
	applyRetroactively := true
	rule, updated := mustCreateRule(t, tx, model.CreateRuleInput{
		MerchantPattern:    &retroactivePattern,
		Changes:            &model.TransactionUpdates{MerchantName: &retroactiveName},
		ApplyRetroactively: &applyRetroactively,
	})
	if rule.MerchantName == nil || *rule.MerchantName != retroactiveName || updated != 1 {
		t.Fatalf("CreateRule() = %#v, %d", rule, updated)
	}
	if transaction := mustTransactionByExternalID(t, tx, "rename-rule-retro"); transaction.MerchantName == nil || *transaction.MerchantName != retroactiveName {
		t.Fatalf("retroactively renamed transaction = %#v", transaction.MerchantName)
	}

	categories, err := tx.Categories(ctx)
	must.NoErr(t, err)
	newPattern := "New Merchant"
	newName := "Renamed New Merchant"
	mustCreateRule(t, tx, model.CreateRuleInput{
		MerchantPattern: &newPattern,
		Changes:         &model.TransactionUpdates{CategoryID: &categories[0].ID, MerchantName: &newName},
	})
	mustUpsertSynced(t, tx, syncedTxn("rename-rule-new", 8, "2026-05-11T12:00:00Z", "New Merchant Store"))
	if transaction := mustTransactionByExternalID(t, tx, "rename-rule-new"); transaction.MerchantName == nil || *transaction.MerchantName != newName {
		t.Fatalf("new renamed transaction = %#v", transaction.MerchantName)
	}

	mustUpsertSynced(t, tx, syncedTxn("rename-rule-new", 8, "2026-05-11T12:00:00Z", "New Merchant Updated"))
	if transaction := mustTransactionByExternalID(t, tx, "rename-rule-new"); transaction.MerchantName == nil || *transaction.MerchantName != newName {
		t.Fatalf("resynced renamed transaction = %#v", transaction.MerchantName)
	}
}

func TestBackwardCursorPagination(t *testing.T) {
	ctx := context.Background()
	_, tx := openSeededTestStore(t)
	for i, id := range []string{"bpg-1", "bpg-2", "bpg-3", "bpg-4"} {
		dt := testTime().AddDate(0, 0, i)
		mustUpsertSynced(t, tx, transactions.SyncedTransaction{
			ExternalID: id, AccountID: "test-acc", Amount: float64(i + 1),
			Datetime: dt, PostedDatetime: dt,
		})
	}

	last := int32(2)
	lastPage, err := tx.Transactions(ctx, transactions.TransactionQuery{Last: &last})
	if err != nil || len(lastPage.Edges) != 2 {
		t.Fatalf("last=2 page: %d edges, %v", len(lastPage.Edges), err)
	}
	if lastPage.PageInfo.StartCursor == nil {
		t.Fatal("expected start cursor")
	}
	if lastPage.PageInfo.HasNextPage || !lastPage.PageInfo.HasPreviousPage {
		t.Fatalf("last page PageInfo = %+v, want hasNextPage=false hasPreviousPage=true", lastPage.PageInfo)
	}

	cursor := *lastPage.PageInfo.StartCursor
	prevPage := mustTransactions(t, tx, transactions.TransactionQuery{Last: &last, Before: &cursor})
	if len(prevPage.Edges) == 0 {
		t.Fatal("expected results before cursor")
	}
	if !prevPage.PageInfo.HasNextPage || prevPage.PageInfo.HasPreviousPage {
		t.Fatalf("prev page PageInfo = %+v, want hasNextPage=true hasPreviousPage=false", prevPage.PageInfo)
	}

	ascSort := &model.TransactionSort{Field: model.TransactionSortFieldDate, Direction: model.SortDirectionAsc}
	ascLastPage, err := tx.Transactions(ctx, transactions.TransactionQuery{Last: &last, Sort: ascSort})
	if err != nil || len(ascLastPage.Edges) != 2 {
		t.Fatalf("asc last=2 page: %d edges, %v", len(ascLastPage.Edges), err)
	}
	if ascLastPage.PageInfo.HasNextPage || !ascLastPage.PageInfo.HasPreviousPage {
		t.Fatalf("asc last page PageInfo = %+v, want hasNextPage=false hasPreviousPage=true", ascLastPage.PageInfo)
	}
}

func TestCursorPaginationWithEqualDatetimes(t *testing.T) {
	_, tx := openSeededTestStore(t)
	for _, id := range []string{"equal-1", "equal-2", "equal-3"} {
		mustUpsertSynced(t, tx, syncedTxn(id, 1, "2026-05-10T12:00:00Z", "Equal Datetime"))
	}

	pageSize := int32(2)
	firstPage := mustTransactions(t, tx, transactions.TransactionQuery{First: &pageSize})
	if got := transactionExternalIDs(t, tx, firstPage); !slices.Equal(got, []string{"equal-3", "equal-2"}) {
		t.Fatalf("first page IDs = %#v, want %#v", got, []string{"equal-3", "equal-2"})
	}
	secondPage := mustTransactions(t, tx, transactions.TransactionQuery{First: &pageSize, After: firstPage.PageInfo.EndCursor})
	if got := transactionExternalIDs(t, tx, secondPage); !slices.Equal(got, []string{"equal-1"}) {
		t.Fatalf("second page IDs = %#v, want %#v", got, []string{"equal-1"})
	}

	lastPage := mustTransactions(t, tx, transactions.TransactionQuery{Last: &pageSize})
	if got := transactionExternalIDs(t, tx, lastPage); !slices.Equal(got, []string{"equal-2", "equal-1"}) {
		t.Fatalf("last page IDs = %#v, want %#v", got, []string{"equal-2", "equal-1"})
	}
	previousPage := mustTransactions(t, tx, transactions.TransactionQuery{Last: &pageSize, Before: lastPage.PageInfo.StartCursor})
	if got := transactionExternalIDs(t, tx, previousPage); !slices.Equal(got, []string{"equal-3"}) {
		t.Fatalf("previous page IDs = %#v, want %#v", got, []string{"equal-3"})
	}
}

func TestRecurringChargesCRUD(t *testing.T) {
	ctx := context.Background()
	testStore, store, tx := openTestStoreWithSQL(t)
	mustSeedTestAccount(t, ctx, store)
	otherOwner := testutil.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "other"})
	otherConnectionName := "Other Institution"
	otherConnection := testutil.MustCreateConnection(t, store, 2, &otherConnectionName, otherOwner.ID.Int64())
	testutil.MustUpsertAccount(t, store, "other-acc", &model.Account{
		Connection: otherConnection,
		Owner:      otherOwner,
		Name:       "Other Checking",
		Type:       model.AccountTypeDepository,
	})

	mustUpsertSynced(t, tx, syncedTxn("rc-tx-1", 15, "2026-05-01T12:00:00Z", "Netflix"))
	otherMerchant := "Spotify"
	otherDatetime := testutil.DateTime("2026-05-01T12:00:00Z")
	mustUpsertSynced(t, tx, transactions.SyncedTransaction{
		ExternalID:     "rc-other-item-tx",
		AccountID:      "other-acc",
		Amount:         20,
		Datetime:       otherDatetime,
		PostedDatetime: otherDatetime,
		MerchantName:   &otherMerchant,
	})
	var otherTxnID int64
	must.NoErr(t, testStore.SQL().QueryRowContext(
		ctx,
		`UPDATE transactions SET is_recurring = 1 WHERE external_id = ? RETURNING id`,
		"rc-other-item-tx",
	).Scan(&otherTxnID))
	recurringFlag := func(externalID string) bool {
		var isRecurring bool
		must.NoErr(t, testStore.SQL().QueryRowContext(
			ctx,
			`SELECT is_recurring FROM transactions WHERE external_id = ?`,
			externalID,
		).Scan(&isRecurring))
		return isRecurring
	}

	draft := makeRecurringChargeDraft("plaid-stream-1", "test-acc", "MONTHLY", "MATURE")
	chargeID, err := tx.UpsertRecurringCharge(ctx, draft)
	must.NoErr(t, err)

	charges, err := tx.GetRecurringCharges(ctx)
	must.NoErr(t, err)
	if len(charges) != 1 {
		t.Fatalf("expected 1 charge, got %d", len(charges))
	}

	charge := charges[0]
	byID, err := tx.RecurringChargeByID(ctx, charge.ID.Int64())
	if err != nil || byID == nil {
		t.Fatalf("RecurringChargeByID: %v %v", byID, err)
	}

	must.NoErr(t, tx.ReplaceChargeTxns(ctx, charge.ID.Int64(), []string{"rc-tx-1"}))
	must.NoErr(t, tx.MarkRecurringFromStreams(ctx, 1))
	if !recurringFlag("rc-tx-1") {
		t.Fatal("expected active stream association to mark transaction recurring")
	}
	if !recurringFlag("rc-other-item-tx") {
		t.Fatal("expected other Plaid item's transaction to stay untouched")
	}

	draft.IsUserModified = true
	updatedChargeID, err := tx.UpsertRecurringCharge(ctx, draft)
	must.NoErr(t, err)
	if updatedChargeID != chargeID {
		t.Fatalf("updated charge id = %d, want %d", updatedChargeID, chargeID)
	}
	var isUserModified bool
	must.NoErr(t, testStore.SQL().QueryRowContext(
		ctx,
		`SELECT is_user_modified FROM recurring_charges WHERE id = ?`,
		charge.ID.Int64(),
	).Scan(&isUserModified))
	if !isUserModified {
		t.Fatal("expected recurring charge update to refresh is_user_modified")
	}
	draft.IsActive = false
	inactiveChargeID, err := tx.UpsertRecurringCharge(ctx, draft)
	must.NoErr(t, err)
	if inactiveChargeID != chargeID {
		t.Fatalf("inactive charge id = %d, want %d", inactiveChargeID, chargeID)
	}
	must.NoErr(t, tx.MarkRecurringFromStreams(ctx, 1))
	if recurringFlag("rc-tx-1") {
		t.Fatal("expected inactive stream association to clear recurring flag")
	}
	if !recurringFlag("rc-other-item-tx") {
		t.Fatal("expected other Plaid item's transaction to stay recurring")
	}

	// Charges on hidden accounts (e.g. a household member's duplicate link
	// to a shared bank account) must not show up alongside the visible one.
	if _, err := testStore.SQL().ExecContext(
		ctx, `UPDATE accounts SET is_hidden = 1 WHERE external_id = ?`, "test-acc",
	); err != nil {
		t.Fatalf("hide account: %v", err)
	}
	if charges, err := tx.GetRecurringCharges(ctx); err != nil {
		t.Fatalf("GetRecurringCharges() after hiding account: %v", err)
	} else if len(charges) != 0 {
		t.Fatalf("expected 0 charges once the account is hidden, got %d", len(charges))
	}
}

func makePlaidStream(streamID, accountID, frequency, status string) plaidapi.TransactionStream {
	avgAmt := plaidapi.NewTransactionStreamAmount()
	avgAmt.SetAmount(15.0)
	lastAmt := plaidapi.NewTransactionStreamAmount()
	lastAmt.SetAmount(15.0)
	return *plaidapi.NewTransactionStream(
		accountID, streamID, []string{}, "",
		"Netflix", plaidapi.NullableString{},
		"2026-01-01", "2026-05-01",
		plaidapi.RecurringTransactionFrequency(frequency),
		[]string{}, *avgAmt, *lastAmt,
		true, plaidapi.TransactionStreamStatus(status), false,
	)
}

func makeRecurringChargeDraft(streamID, accountID, frequency, status string) transactions.RecurringChargeDraft {
	stream := makePlaidStream(streamID, accountID, frequency, status)
	avgAmount := stream.GetAverageAmount()
	lastAmount := stream.GetLastAmount()
	merchantName := "Netflix"
	return transactions.RecurringChargeDraft{
		ExternalID:     stream.GetStreamId(),
		AccountID:      stream.GetAccountId(),
		Description:    stream.GetDescription(),
		MerchantName:   &merchantName,
		Frequency:      string(stream.GetFrequency()),
		Status:         string(stream.GetStatus()),
		IsActive:       stream.GetIsActive(),
		AverageAmount:  avgAmount.GetAmount(),
		LastAmount:     lastAmount.GetAmount(),
		FirstDate:      stream.GetFirstDate(),
		LastDate:       stream.GetLastDate(),
		IsUserModified: stream.GetIsUserModified(),
		TransactionIDs: stream.GetTransactionIds(),
	}
}

func TestSpendingByCategoryWithGranularity(t *testing.T) {
	ctx := u.ContextWithTimezone(context.Background(), "UTC")
	_, tx := openSeededTestStore(t)
	// Find an EXPENSE category (SpendingByCategory excludes INCOME and TRANSFER)
	cats, _ := tx.Categories(ctx)
	var expCatID model.GlobalID
	for _, c := range cats {
		if c.ID.Int64() != 0 && c.Kind == model.CategoryKindExpense {
			expCatID = c.ID
			break
		}
	}
	if expCatID == (model.GlobalID{}) {
		t.Skip("no EXPENSE category seeded")
	}
	catIntID := expCatID.Int64()
	for _, d := range []struct{ id, dt string }{
		{"sg-1", "2026-05-10T12:00:00Z"},
		{"sg-2", "2026-05-20T12:00:00Z"},
		{"sg-3", "2026-06-05T12:00:00Z"},
	} {
		mustUpsertSynced(t, tx, syncedTxn(d.id, 10, d.dt, ""))
		must.NoErr(t, tx.ApplyLLMCategory(ctx, strconv.FormatInt(mustTransactionByExternalID(t, tx, d.id).ID.Int64(), 10), catIntID))
	}
	if got := mustTransactionByExternalID(t, tx, "sg-1"); got.Category.ID != expCatID {
		t.Fatalf("ApplyLLMCategory() category = %#v, want %s", got.Category, expCatID)
	}

	from := testTime()
	to := testTime().AddDate(0, 2, 0)
	monthly := model.GranularityMonthly
	filter := model.SpendingFilter{
		DatetimeRange: &model.DateTimeRange{From: &from, To: &to},
		Granularity:   &monthly,
	}
	report, err := tx.SpendingByCategory(ctx, filter)
	must.NoErr(t, err)
	if report.TotalAmount != money.FromDollars(30) || report.TransactionCount != 3 || len(report.Periods) != 2 {
		t.Fatalf("SpendingByCategory(monthly) = %#v", report)
	}
	if report.Periods[0].PeriodLabel != "2026-05" || report.Periods[0].TotalAmount != money.FromDollars(20) || report.Periods[1].PeriodLabel != "2026-06" {
		t.Fatalf("monthly periods = %#v", report.Periods)
	}

	// Test with category IDs filter to cover the filtered category query.
	filterWithCat := model.SpendingFilter{
		DatetimeRange: &model.DateTimeRange{From: &from, To: &to},
		CategoryIds:   []*model.GlobalID{&expCatID},
	}
	report2, err := tx.SpendingByCategory(ctx, filterWithCat)
	must.NoErr(t, err)
	if report2.TotalAmount != money.FromDollars(30) || report2.TransactionCount != 3 {
		t.Fatalf("SpendingByCategory(category filter) = %#v", report2)
	}

	for _, tc := range []struct {
		name        string
		granularity model.Granularity
		periodLabel string
	}{
		{name: "quarterly", granularity: model.GranularityQuarterly, periodLabel: "2026-Q2"},
		{name: "yearly", granularity: model.GranularityYearly, periodLabel: "2026"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			report, err := tx.SpendingByCategory(ctx, model.SpendingFilter{
				DatetimeRange: &model.DateTimeRange{From: &from, To: &to},
				Granularity:   &tc.granularity,
			})
			must.NoErr(t, err)
			if len(report.Periods) != 1 || report.Periods[0].PeriodLabel != tc.periodLabel {
				t.Fatalf("%s periods = %#v", tc.name, report.Periods)
			}
		})
	}
}

func TestCursorPagination(t *testing.T) {
	ctx := context.Background()
	_, tx := openSeededTestStore(t)
	for i, id := range []string{"pg-1", "pg-2", "pg-3", "pg-4", "pg-5"} {
		dt := testTime().AddDate(0, 0, i)
		mustUpsertSynced(t, tx, transactions.SyncedTransaction{
			ExternalID: id, AccountID: "test-acc", Amount: float64(i + 1),
			Datetime: dt, PostedDatetime: dt,
		})
	}

	first := int32(2)
	page1, err := tx.Transactions(ctx, transactions.TransactionQuery{First: &first})
	if err != nil || len(page1.Edges) != 2 {
		t.Fatalf("page1: %d edges, %v", len(page1.Edges), err)
	}
	if page1.PageInfo.EndCursor == nil {
		t.Fatal("expected end cursor on page 1")
	}
	if !page1.PageInfo.HasNextPage || page1.PageInfo.HasPreviousPage {
		t.Fatalf("page1 PageInfo = %+v, want hasNextPage=true hasPreviousPage=false", page1.PageInfo)
	}

	cursor := *page1.PageInfo.EndCursor
	page2 := mustTransactions(t, tx, transactions.TransactionQuery{First: &first, After: &cursor})
	if len(page2.Edges) == 0 {
		t.Fatal("expected page 2 results")
	}
	if !page2.PageInfo.HasNextPage || !page2.PageInfo.HasPreviousPage {
		t.Fatalf("page2 PageInfo = %+v, want hasNextPage=true hasPreviousPage=true", page2.PageInfo)
	}

	cursor2 := *page2.PageInfo.EndCursor
	page3 := mustTransactions(t, tx, transactions.TransactionQuery{First: &first, After: &cursor2})
	if len(page3.Edges) != 1 {
		t.Fatalf("page3: %d edges, want 1", len(page3.Edges))
	}
	if page3.PageInfo.HasNextPage || !page3.PageInfo.HasPreviousPage {
		t.Fatalf("page3 PageInfo = %+v, want hasNextPage=false hasPreviousPage=true", page3.PageInfo)
	}

	sort := &model.TransactionSort{Field: model.TransactionSortFieldAmount, Direction: model.SortDirectionAsc}
	amountPage1, err := tx.Transactions(ctx, transactions.TransactionQuery{First: &first, Sort: sort})
	if err != nil || len(amountPage1.Edges) != 2 {
		t.Fatalf("amount page1: %d edges, %v", len(amountPage1.Edges), err)
	}
	if amountPage1.PageInfo.EndCursor == nil {
		t.Fatal("expected amount end cursor on page 1")
	}
	if !amountPage1.PageInfo.HasNextPage || amountPage1.PageInfo.HasPreviousPage {
		t.Fatalf("amount page1 PageInfo = %+v, want hasNextPage=true hasPreviousPage=false", amountPage1.PageInfo)
	}
	amountCursor := *amountPage1.PageInfo.EndCursor
	amountPage2 := mustTransactions(t, tx, transactions.TransactionQuery{First: &first, After: &amountCursor, Sort: sort})
	if len(amountPage2.Edges) == 0 {
		t.Fatal("expected amount page 2 results")
	}
	if !amountPage2.PageInfo.HasNextPage || !amountPage2.PageInfo.HasPreviousPage {
		t.Fatalf("amount page2 PageInfo = %+v, want hasNextPage=true hasPreviousPage=true", amountPage2.PageInfo)
	}

	// Ensure no overlap
	for _, e1 := range page1.Edges {
		for _, e2 := range page2.Edges {
			if e1.Node.ID == e2.Node.ID {
				t.Fatalf("cursor pagination overlap: %s", e1.Node.ID)
			}
		}
	}
}

func TestFilterByAccountAndCategoryIDs(t *testing.T) {
	ctx := context.Background()
	_, tx := openSeededTestStore(t)
	cats, _ := tx.Categories(ctx)
	var catID model.GlobalID
	for _, c := range cats {
		if c.ID.Int64() != 0 {
			catID = c.ID
			break
		}
	}
	mustUpsertSynced(t, tx, syncedTxn("filter-1", 10, "2026-05-10T12:00:00Z", ""))
	filter1ID := mustTransactionGlobalID(t, tx, "filter-1")
	if _, err := tx.BulkUpdateTransactions(ctx, model.BulkUpdateTransactionsInput{TransactionIds: []*model.GlobalID{&filter1ID}, Updates: &model.TransactionUpdates{CategoryID: &catID}}); err != nil {
		t.Fatalf("BulkUpdateTransactions: %v", err)
	}

	// Filter by category IDs (hits integer ID expression handling).
	conn := mustTransactions(t, tx, transactions.TransactionQuery{Filter: &model.TransactionsFilter{CategoryIds: []*model.GlobalID{&catID}}})
	if len(conn.Edges) == 0 {
		t.Fatal("expected transactions with category filter")
	}

	// Filter by account IDs
	accID := mustTestAccountID(t, tx)
	conn2 := mustTransactions(t, tx, transactions.TransactionQuery{Filter: &model.TransactionsFilter{AccountIds: []*model.GlobalID{&accID}}})
	if len(conn2.Edges) == 0 {
		t.Fatal("expected transactions with account filter")
	}
}

func TestSpendingRows(t *testing.T) {
	tx, filter := spendingReportFixture(t, syncedTxn("sr-tx", 20, "2026-05-10T12:00:00Z", ""))
	rows, err := tx.SpendingRows(context.Background(), filter, true, true)
	must.NoErr(t, err)
	if len(rows) != 1 || rows[0].PeriodLabel != "2026-05" || rows[0].TotalCents != money.FromDollars(20) || rows[0].TransactionCount != 1 {
		t.Fatalf("SpendingRows() = %#v", rows)
	}
}
