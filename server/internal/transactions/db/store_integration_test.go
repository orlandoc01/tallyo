package transactionsdb_test

import (
	"context"
	"slices"
	"strconv"
	"testing"
	"time"

	"github.com/samber/lo"

	accountsdb "tallyo/internal/accounts/db"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/transactions"
	transactionsdb "tallyo/internal/transactions/db"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
)

func openTestStore(tb testing.TB) (*accountsdb.Store, *transactionsdb.Store) {
	tb.Helper()
	_, accountsStore, transactionsStore := openTestStoreWithSQL(tb)
	return accountsStore, transactionsStore
}

func openSeededTestStore(tb testing.TB) (*accountsdb.Store, *transactionsdb.Store) {
	tb.Helper()
	accountsStore, transactionsStore := openTestStore(tb)
	mustSeedTestAccount(tb, context.Background(), accountsStore)
	return accountsStore, transactionsStore
}

func ruleCategoryChanges(categoryID model.GlobalID) *model.TransactionUpdates {
	return &model.TransactionUpdates{CategoryID: &categoryID}
}

func ruleTagChanges(tagIDs ...model.GlobalID) *model.TransactionUpdates {
	ids := make([]*model.GlobalID, 0, len(tagIDs))
	for _, tagID := range tagIDs {
		id := tagID
		ids = append(ids, &id)
	}
	return &model.TransactionUpdates{TagIds: ids}
}

func ruleHiddenChanges() *model.TransactionUpdates {
	hidden := true
	return &model.TransactionUpdates{IsHidden: &hidden}
}

func openTestStoreWithSQL(tb testing.TB) (*test.Store, *accountsdb.Store, *transactionsdb.Store) {
	tb.Helper()
	store := test.OpenStoreAt(tb, ":memory:", "Open: %v")
	return store, accountsdb.New(store.Database()), transactionsdb.New(store.Database())
}

func testTime() time.Time { return time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC) }

func spendingReportFixture(t *testing.T, txn transactions.SyncedTransaction) (*transactionsdb.Store, model.SpendingFilter) {
	t.Helper()
	_, tx := openSeededTestStore(t)
	mustUpsertSynced(t, tx, txn)
	from := testTime()
	to := testTime().AddDate(0, 1, 0)
	return tx, model.SpendingFilter{DatetimeRange: &model.DateTimeRange{From: &from, To: &to}}
}

func mustUpsertSynced(t *testing.T, store *transactionsdb.Store, txn transactions.SyncedTransaction) {
	t.Helper()
	_, err := store.UpsertSyncedTransaction(context.Background(), txn)
	must.NoErr(t, err)
}

func mustCreateRule(tb testing.TB, store *transactionsdb.Store, input model.CreateRuleInput) (*model.Rule, int32) {
	tb.Helper()
	rule, count, err := store.CreateRule(context.Background(), input)
	must.NoErr(tb, err)
	return rule, count
}

func mustCreateTransaction(tb testing.TB, store *transactionsdb.Store, input model.CreateTransactionInput) *model.Transaction {
	tb.Helper()
	transaction, err := store.CreateTransaction(context.Background(), input)
	must.NoErr(tb, err)
	return transaction
}

func mustCreateTag(tb testing.TB, store *transactionsdb.Store, input model.CreateTagInput) *model.Tag {
	tb.Helper()
	tag, err := store.CreateTag(context.Background(), input)
	must.NoErr(tb, err)
	return tag
}

func mustTagByID(tb testing.TB, store *transactionsdb.Store, id int64) *model.Tag {
	tb.Helper()
	tag, err := store.TagByID(context.Background(), id)
	must.NoErr(tb, err)
	return tag
}

func mustTransactions(tb testing.TB, store *transactionsdb.Store, query transactions.TransactionQuery) *model.TransactionConnection {
	tb.Helper()
	connection, err := store.Transactions(context.Background(), query)
	must.NoErr(tb, err)
	return connection
}

func mustTransactionsSummary(tb testing.TB, store *transactionsdb.Store, filter *model.TransactionsFilter) *model.TransactionsSummary {
	tb.Helper()
	summary, err := store.TransactionsSummary(context.Background(), filter)
	must.NoErr(tb, err)
	return summary
}

func syncedTxn(extID string, amount float64, datetime string, merchant string) transactions.SyncedTransaction {
	dateTime := test.DateTime(datetime)
	return transactions.SyncedTransaction{
		ExternalID: extID, AccountID: "test-acc", Amount: amount,
		Datetime: dateTime, PostedDatetime: dateTime, MerchantName: lo.EmptyableToPtr(merchant),
	}
}

func TestCategoryGroupAndCategoryCRUD(t *testing.T) {
	ctx := context.Background()
	_, tx := openTestStore(t)

	groups, err := tx.CategoryGroups(ctx)
	must.NoErr(t, err)
	if len(groups) == 0 {
		t.Fatal("expected seeded category groups")
	}

	cats, err := tx.Categories(ctx)
	must.NoErr(t, err)
	if len(cats) < 2 {
		t.Fatalf("expected seeded categories, got %d", len(cats))
	}

	grp, err := tx.CreateCategoryGroup(ctx, model.CreateCategoryGroupInput{Name: "Test Group", Emoji: "🧪", Kind: model.CategoryKindExpense})
	must.NoErr(t, err)
	if grp.Name != "Test Group" || grp.Emoji != "🧪" {
		t.Fatalf("CreateCategoryGroup() = %#v", grp)
	}

	updated, err := tx.UpdateCategoryGroup(ctx, model.UpdateCategoryGroupInput{ID: grp.ID, Name: "Updated Group", Emoji: "🔬"})
	must.NoErr(t, err)
	if updated.Name != "Updated Group" {
		t.Fatalf("UpdateCategoryGroup() name = %q", updated.Name)
	}
	missingGroup := model.New(model.GlobalIDCategoryGroup, 999999)
	if _, err := tx.UpdateCategoryGroup(ctx, model.UpdateCategoryGroupInput{ID: missingGroup, Name: "Missing", Emoji: ""}); err == nil || err.Error() != "category group 999999 not found" {
		t.Fatalf("UpdateCategoryGroup() error = %v, want missing group error", err)
	}
	deletedMissing, err := tx.DeleteCategoryGroup(ctx, 999999)
	if err != nil || deletedMissing {
		t.Fatalf("DeleteCategoryGroup(missing) = %v, %v", deletedMissing, err)
	}

	cat, err := tx.CreateCategory(ctx, model.CreateCategoryInput{Name: "Test Cat", Emoji: "🐈", GroupID: grp.ID})
	must.NoErr(t, err)
	if cat.Name != "Test Cat" {
		t.Fatalf("CreateCategory() = %#v", cat)
	}
	catIntID := cat.ID.Int64()

	updCat, err := tx.UpdateCategory(ctx, model.UpdateCategoryInput{ID: cat.ID, Name: "Updated Cat", Emoji: "🐈", GroupID: grp.ID})
	must.NoErr(t, err)
	if updCat.Name != "Updated Cat" {
		t.Fatalf("UpdateCategory() name = %q", updCat.Name)
	}

	deleted, err := tx.DeleteCategory(ctx, catIntID)
	if err != nil || !deleted {
		t.Fatalf("DeleteCategory(): %v %v", deleted, err)
	}

	grpIntID := grp.ID.Int64()
	deletedGroup, err := tx.DeleteCategoryGroup(ctx, grpIntID)
	if err != nil || !deletedGroup {
		t.Fatalf("DeleteCategoryGroup(): %v %v", deletedGroup, err)
	}
}

func TestRuleCRUD(t *testing.T) {
	ctx := context.Background()
	_, tx := openTestStore(t)

	cats, err := tx.Categories(ctx)
	if err != nil || len(cats) == 0 {
		t.Fatalf("Categories(): %v (len=%d)", err, len(cats))
	}
	catID := cats[0].ID

	merchantPattern := "Amazon"
	rule, _ := mustCreateRule(t, tx, model.CreateRuleInput{MerchantPattern: &merchantPattern, Changes: ruleCategoryChanges(catID)})
	if rule.MerchantPattern == nil || *rule.MerchantPattern != merchantPattern {
		t.Fatalf("CreateRule() = %#v", rule)
	}

	rules, err := tx.Rules(ctx, nil)
	if err != nil || len(rules) == 0 {
		t.Fatalf("Rules(): %v (len=%d)", err, len(rules))
	}

	ruleIntID := rule.ID.Int64()
	newPattern := "amazon"
	updated, _, err := tx.UpdateRule(ctx, model.UpdateRuleInput{ID: rule.ID, MerchantPattern: &newPattern, Changes: ruleCategoryChanges(catID)})
	must.NoErr(t, err)
	if updated.MerchantPattern == nil || *updated.MerchantPattern != newPattern {
		t.Fatalf("UpdateRule() = %#v", updated)
	}

	del, err := tx.DeleteRule(ctx, ruleIntID)
	if err != nil || !del {
		t.Fatalf("DeleteRule(): %v %v", del, err)
	}
}

func TestRulesFiltering(t *testing.T) {
	ctx := context.Background()
	_, tx := openSeededTestStore(t)

	cats, err := tx.Categories(ctx)
	if err != nil || len(cats) == 0 {
		t.Fatalf("Categories(): %v (len=%d)", err, len(cats))
	}
	catID := cats[0].ID
	accountID := mustTestAccountID(t, tx)
	merchantTarget := "My Target"
	merchantAmazon := "Amazon"
	merchantEverything := "Everything"
	originalTarget := "STORE TARGET #1"
	minTarget := money.FromDollars(10.0)
	maxTarget := money.FromDollars(50.0)
	minAmazon := money.FromDollars(1.0)
	maxAmazon := money.FromDollars(5.0)
	targetRule, _ := mustCreateRule(t, tx, model.CreateRuleInput{
		MerchantPattern: &merchantTarget,
		OriginalPattern: &originalTarget,
		Changes:         ruleCategoryChanges(catID),
		AccountIds:      []*model.GlobalID{&accountID},
		AmountMin:       &minTarget,
		AmountMax:       &maxTarget,
	})
	mustCreateRule(t, tx, model.CreateRuleInput{
		MerchantPattern: &merchantAmazon,
		Changes:         ruleCategoryChanges(catID),
		AmountMin:       &minAmazon,
		AmountMax:       &maxAmazon,
	})
	mustCreateRule(t, tx, model.CreateRuleInput{
		MerchantPattern: &merchantEverything,
		Changes:         ruleCategoryChanges(catID),
	})

	merchantFilter := "target"
	assertRulePatterns(t, tx, &model.RulesInput{MerchantPattern: &merchantFilter}, []string{"My Target"})
	originalFilter := "target #"
	assertRulePatterns(t, tx, &model.RulesInput{OriginalPattern: &originalFilter}, []string{"My Target"})
	assertRulePatterns(t, tx, &model.RulesInput{AccountIds: []*model.GlobalID{&accountID}}, []string{"My Target"})
	amountMin := money.FromDollars(20.0)
	amountMax := money.FromDollars(30.0)
	assertRulePatterns(t, tx, &model.RulesInput{AmountMin: &amountMin, AmountMax: &amountMax}, []string{"Everything", "My Target"})
	assertRulePatterns(t, tx, &model.RulesInput{MerchantPattern: &merchantFilter, AccountIds: []*model.GlobalID{&accountID}, AmountMin: &amountMin, AmountMax: &amountMax}, []string{"My Target"})

	literalPattern := "Cafe 100%_MATCH"
	decoyPattern := "Cafe 100xxMATCH"
	mustCreateRule(t, tx, model.CreateRuleInput{MerchantPattern: &literalPattern, Changes: ruleCategoryChanges(catID)})
	mustCreateRule(t, tx, model.CreateRuleInput{MerchantPattern: &decoyPattern, Changes: ruleCategoryChanges(catID)})
	literalFilter := "100%_match"
	assertRulePatterns(t, tx, &model.RulesInput{MerchantPattern: &literalFilter}, []string{"Cafe 100%_MATCH"})

	missing, err := tx.RuleByID(ctx, targetRule.ID.Int64()+999)
	if err != nil || missing != nil {
		t.Fatalf("RuleByID(missing) = %#v, %v", missing, err)
	}
}

func assertRulePatterns(tb testing.TB, tx *transactionsdb.Store, input *model.RulesInput, want []string) {
	tb.Helper()
	rules, err := tx.Rules(context.Background(), input)
	must.NoErr(tb, err)
	got := make([]string, 0, len(rules))
	for _, rule := range rules {
		if rule.MerchantPattern == nil {
			got = append(got, "")
			continue
		}
		got = append(got, *rule.MerchantPattern)
	}
	if !slices.Equal(got, want) {
		tb.Fatalf("Rules(%#v) merchant patterns = %#v, want %#v", input, got, want)
	}
}

func TestTagCRUDFilteringAndRuleAssignment(t *testing.T) {
	ctx := context.Background()
	_, tx := openSeededTestStore(t)

	tag := mustCreateTag(t, tx, model.CreateTagInput{Name: "Travel", Color: "#3B82F6"})
	updated, err := tx.UpdateTag(ctx, model.UpdateTagInput{ID: tag.ID, Name: "Trips", Color: "#22C55E"})
	must.NoErr(t, err)
	if _, err := tx.CreateTag(ctx, model.CreateTagInput{Name: "Bad", Color: "green"}); err == nil {
		t.Fatalf("CreateTag(invalid color) expected error")
	}
	if _, err := tx.UpdateTag(ctx, model.UpdateTagInput{ID: tag.ID, Name: "Bad", Color: "green"}); err == nil {
		t.Fatalf("UpdateTag(invalid color) expected error")
	}
	if updated.Name != "Trips" || updated.Color != "#22C55E" {
		t.Fatalf("UpdateTag() = %#v", updated)
	}
	secondTag := mustCreateTag(t, tx, model.CreateTagInput{Name: "Business", Color: "#EF4444"})
	tagIntID := updated.ID.Int64()
	listed, err := tx.Tags(ctx)
	must.NoErr(t, err)
	if len(listed) != 2 {
		t.Fatalf("Tags() = %#v", listed)
	}
	byID, err := tx.TagByID(ctx, tagIntID)
	if err != nil || byID == nil || byID.ID != updated.ID {
		t.Fatalf("TagByID() = %#v, %v", byID, err)
	}

	merchantPattern := "Hotel"
	apply := true
	tagID := updated.ID
	secondTagID := secondTag.ID
	rule, _ := mustCreateRule(t, tx, model.CreateRuleInput{MerchantPattern: &merchantPattern, Changes: ruleTagChanges(tagID, secondTagID), ApplyRetroactively: &apply})
	tagsByRuleID, err := tx.TagsByRuleIDs(ctx, []int64{rule.ID.Int64()})
	must.NoErr(t, err)
	if len(tagsByRuleID[rule.ID.Int64()]) != 2 {
		t.Fatalf("rule tags = %#v", tagsByRuleID[rule.ID.Int64()])
	}
	mustUpsertSynced(t, tx, syncedTxn("tagged-tx", 10, "2026-05-10T12:00:00Z", "Hotel Example"))

	taggedTxnID := mustTransactionByExternalID(t, tx, "tagged-tx").ID.Int64()
	tagsByTxnID, err := tx.TagsByTransactionIDs(ctx, []int64{taggedTxnID})
	must.NoErr(t, err)
	tags := tagsByTxnID[taggedTxnID]
	if len(tags) != 2 || tags[0].ID != secondTag.ID || tags[1].ID != updated.ID {
		t.Fatalf("tags = %#v", tags)
	}
	byID = mustTagByID(t, tx, tagIntID)
	if byID.TransactionCount != 1 {
		t.Fatalf("TagByID(count).TransactionCount = %d", byID.TransactionCount)
	}
	if _, err := tx.UpdateTransaction(ctx, taggedTxnID, model.TransactionUpdates{TagIds: []*model.GlobalID{&updated.ID}}); err != nil {
		t.Fatalf("UpdateTransaction(tags): %v", err)
	}
	byID = mustTagByID(t, tx, tagIntID)
	if byID.TransactionCount != 1 {
		t.Fatalf("TagByID(replaced count).TransactionCount = %d", byID.TransactionCount)
	}

	conn := mustTransactions(t, tx, transactions.TransactionQuery{Filter: &model.TransactionsFilter{TagIds: []*model.GlobalID{&updated.ID}}})
	if conn.TotalCount != 1 {
		t.Fatalf("tag filter total = %d", conn.TotalCount)
	}
	if len(conn.Edges) != 1 || conn.Edges[0].Node.Tags != nil {
		t.Fatalf("transaction tags should be demand-loaded = %#v", conn.Edges)
	}
	single, err := tx.Transaction(ctx, taggedTxnID)
	must.NoErr(t, err)
	if single.Tags != nil {
		t.Fatalf("single transaction tags should be demand-loaded = %#v", single.Tags)
	}

	if _, err := tx.UpdateTransaction(ctx, taggedTxnID, model.TransactionUpdates{TagIds: []*model.GlobalID{}}); err != nil {
		t.Fatalf("UpdateTransaction(clear tags): %v", err)
	}
	tagsByTxnID, err = tx.TagsByTransactionIDs(ctx, []int64{taggedTxnID})
	must.NoErr(t, err)
	tags = tagsByTxnID[taggedTxnID]
	if len(tags) != 0 {
		t.Fatalf("cleared tags = %#v", tags)
	}
	byID = mustTagByID(t, tx, tagIntID)
	if byID.TransactionCount != 0 {
		t.Fatalf("TagByID(cleared count).TransactionCount = %d", byID.TransactionCount)
	}
	untagged := true
	conn = mustTransactions(t, tx, transactions.TransactionQuery{Filter: &model.TransactionsFilter{Untagged: &untagged}})
	if conn.TotalCount != 1 {
		t.Fatalf("untagged total = %d", conn.TotalCount)
	}
	if _, err := tx.UpdateTransaction(ctx, taggedTxnID, model.TransactionUpdates{TagIds: []*model.GlobalID{&updated.ID}}); err != nil {
		t.Fatalf("UpdateTransaction(cascade tags): %v", err)
	}
	deletedTxn, err := tx.DeleteTransaction(ctx, taggedTxnID)
	if err != nil || !deletedTxn {
		t.Fatalf("DeleteTransaction(tagged): %v %v", deletedTxn, err)
	}
	byID = mustTagByID(t, tx, tagIntID)
	if byID.TransactionCount != 0 {
		t.Fatalf("TagByID(cascade count).TransactionCount = %d", byID.TransactionCount)
	}
	deleted, err := tx.DeleteTag(ctx, 999999)
	if err != nil || deleted {
		t.Fatalf("DeleteTag(missing): %v %v", deleted, err)
	}
	deleted, err = tx.DeleteTag(ctx, tagIntID)
	if err != nil || !deleted {
		t.Fatalf("DeleteTag(): %v %v", deleted, err)
	}
	byID, err = tx.TagByID(ctx, tagIntID)
	if err != nil || byID != nil {
		t.Fatalf("TagByID(deleted) = %#v, %v", byID, err)
	}
}

func TestTransactionCRUD(t *testing.T) {
	ctx := context.Background()
	_, tx := openSeededTestStore(t)

	syncedTransaction := syncedTxn("test-tx-1", 12.50, "2026-05-20T12:00:00Z", "Coffee Shop")
	originalName := "COFFEE SHOP #123"
	syncedTransaction.OriginalName = &originalName
	synced, err := tx.UpsertSyncedTransaction(ctx, syncedTransaction)
	must.NoErr(t, err)
	if !synced {
		t.Fatal("expected UpsertSyncedTransaction to return true (inserted)")
	}

	txn := mustTransactionByExternalID(t, tx, "test-tx-1")
	txnID := txn.ID.Int64()
	if txn.Amount != money.FromDollars(12.50) {
		t.Fatalf("Transaction().Amount = %v", txn.Amount)
	}

	cats, err := tx.Categories(ctx)
	if err != nil || len(cats) == 0 {
		t.Fatalf("Categories(): %v", err)
	}
	catID := cats[0].ID
	updated, err := tx.UpdateTransaction(ctx, txnID, model.TransactionUpdates{CategoryID: &catID})
	must.NoErr(t, err)
	if updated.Category == nil || updated.Category.ID != catID {
		t.Fatalf("UpdateTransaction() category = %#v", updated.Category)
	}
	merchantName := "  Neighborhood Coffee  "
	updated, err = tx.UpdateTransaction(ctx, txnID, model.TransactionUpdates{MerchantName: &merchantName})
	must.NoErr(t, err)
	if updated.MerchantName == nil || *updated.MerchantName != "Neighborhood Coffee" || updated.OriginalName == nil || *updated.OriginalName != originalName {
		t.Fatalf("UpdateTransaction() merchant names = %#v, %#v", updated.MerchantName, updated.OriginalName)
	}

	summary := mustTransactionsSummary(t, tx, nil)
	if summary.TotalCount != 1 {
		t.Fatalf("TransactionsSummary().TotalCount = %d", summary.TotalCount)
	}

	deleted, err := tx.DeleteTransaction(ctx, txnID)
	if err != nil || !deleted {
		t.Fatalf("DeleteTransaction(): %v %v", deleted, err)
	}
	mustUpsertSynced(t, tx, syncedTxn("test-tx-delete-sync", 4.25, "2026-05-21T12:00:00Z", ""))
	deleted, err = tx.DeleteSyncedTransaction(ctx, transactions.TransactionSourcePlaid, "test-tx-delete-sync")
	if err != nil || !deleted {
		t.Fatalf("DeleteSyncedTransaction(): %v %v", deleted, err)
	}
}

func TestTransactionsSearchMatchesMerchantOriginalAndNotes(t *testing.T) {
	_, tx := openSeededTestStore(t)

	mustUpsertSynced(t, tx, syncedTxn("search-merchant", 12.50, "2026-05-20T12:00:00Z", "Blue Bottle Espresso"))
	original := syncedTxn("search-original", 84.25, "2026-05-19T12:00:00Z", "Payroll Deposit")
	original.OriginalName = new("ACME PAYROLL LLC")
	mustUpsertSynced(t, tx, original)
	notesTxn := mustCreateTransaction(t, tx, model.CreateTransactionInput{
		AccountID:    mustTestAccountID(t, tx),
		Date:         model.Date("2026-05-18"),
		Amount:       42,
		MerchantName: new("Neighborhood Theater"),
		Notes:        new("Concert tickets for June"),
	})

	assertSearchExternalIDs(t, tx, "Espresso", []string{"search-merchant"})
	assertSearchExternalIDs(t, tx, "Bottle Blue", []string{"search-merchant"})
	assertSearchExternalIDs(t, tx, "PAYROLL", []string{"search-original"})
	assertSearchIDs(t, tx, "tickets", []string{strconv.FormatInt(notesTxn.ID.Int64(), 10)})
	// Row-level matching: terms may land in different columns (merchant + notes).
	assertSearchIDs(t, tx, "Theater tickets", []string{strconv.FormatInt(notesTxn.ID.Int64(), 10)})
}

func TestTransactionsSearchUpdatesFTSOnIndexedColumnChange(t *testing.T) {
	_, tx := openSeededTestStore(t)

	mustUpsertSynced(t, tx, syncedTxn("search-update", 4.75, "2026-05-20T12:00:00Z", "Starbucks Coffee"))

	assertSearchExternalIDs(t, tx, "Starbucks", []string{"search-update"})
	assertSearchExternalIDs(t, tx, "Peets", []string{})

	merchantName := "Peets Coffee"
	transaction := mustTransactionByExternalID(t, tx, "search-update")
	_, err := tx.UpdateTransaction(context.Background(), transaction.ID.Int64(), model.TransactionUpdates{MerchantName: &merchantName})
	must.NoErr(t, err)

	assertSearchExternalIDs(t, tx, "Starbucks", []string{})
	assertSearchExternalIDs(t, tx, "Peets", []string{"search-update"})
}

// With the unicode61 tokenizer there is no minimum term length, so short terms
// query FTS directly (no literal substring fallback). Matching is order-insensitive across
// terms and supports prefix (search-as-you-type) tokens.
func TestTransactionsSearchShortAndPrefixTerms(t *testing.T) {
	_, tx := openSeededTestStore(t)

	mustUpsertSynced(t, tx, syncedTxn("short-us", 5, "2026-05-20T12:00:00Z", "US Gas"))
	mustUpsertSynced(t, tx, syncedTxn("short-other", 7, "2026-05-19T12:00:00Z", "Target"))

	// Short (sub-trigram) term matches via FTS — no length floor.
	assertSearchExternalIDs(t, tx, "US", []string{"short-us"})
	// Order-insensitive even with a short term; the old contiguous substring fallback
	// (%gas us%) would not have matched "US Gas".
	assertSearchExternalIDs(t, tx, "gas us", []string{"short-us"})
	// Prefix / search-as-you-type.
	assertSearchExternalIDs(t, tx, "Tar", []string{"short-other"})
}

func TestTransactionTextFiltersMatchLiteralWildcards(t *testing.T) {
	_, tx := openSeededTestStore(t)

	mustUpsertSynced(t, tx, syncedTxn("filter-percent", 9, "2026-05-20T12:00:00Z", "A% Coffee"))
	underscore := syncedTxn("filter-underscore", 11, "2026-05-19T12:00:00Z", "ACH Deposit")
	underscore.OriginalName = new("ACH_123")
	mustUpsertSynced(t, tx, underscore)
	other := syncedTxn("filter-other", 13, "2026-05-18T12:00:00Z", "Target")
	other.OriginalName = new("TARGET STORE")
	mustUpsertSynced(t, tx, other)

	merchantPrefix := "%"
	conn := mustTransactions(t, tx, transactions.TransactionQuery{
		Filter: &model.TransactionsFilter{MerchantPrefix: &merchantPrefix},
	})
	if got := transactionExternalIDs(t, tx, conn); !slices.Equal(got, []string{"filter-percent"}) {
		t.Fatalf("merchant prefix IDs = %#v, want %#v", got, []string{"filter-percent"})
	}

	originalPrefix := "_"
	conn = mustTransactions(t, tx, transactions.TransactionQuery{
		Filter: &model.TransactionsFilter{OriginalPrefix: &originalPrefix},
	})
	if got := transactionExternalIDs(t, tx, conn); !slices.Equal(got, []string{"filter-underscore"}) {
		t.Fatalf("original prefix IDs = %#v, want %#v", got, []string{"filter-underscore"})
	}
}

func TestTransactionsSearchComposesWithFilterAndSummaryUsesSearch(t *testing.T) {
	ctx := context.Background()
	_, tx := openSeededTestStore(t)
	cats, err := tx.Categories(ctx)
	if err != nil || len(cats) == 0 {
		t.Fatalf("Categories(): %v (len=%d)", err, len(cats))
	}
	catID := cats[0].ID

	reviewed := mustCreateTransaction(t, tx, model.CreateTransactionInput{
		AccountID:    mustTestAccountID(t, tx),
		Date:         model.Date("2026-05-20"),
		Amount:       11,
		MerchantName: new("Acme Reviewed"),
		CategoryID:   &catID,
	})
	mustCreateTransaction(t, tx, model.CreateTransactionInput{
		AccountID:    mustTestAccountID(t, tx),
		Date:         model.Date("2026-05-19"),
		Amount:       13,
		MerchantName: new("Acme Unreviewed"),
	})

	search := "Acme"
	isReviewed := true
	conn, err := tx.Transactions(ctx, transactions.TransactionQuery{
		Filter: &model.TransactionsFilter{IsReviewed: &isReviewed, Search: &search},
	})
	must.NoErr(t, err)
	wantIDs := []string{strconv.FormatInt(reviewed.ID.Int64(), 10)}
	if got := transactionLocalIDs(conn); !slices.Equal(got, wantIDs) {
		t.Fatalf("filtered search IDs = %#v, want %#v", got, wantIDs)
	}

	summary := mustTransactionsSummary(t, tx, &model.TransactionsFilter{Search: &search})
	if summary.TotalCount != 2 {
		t.Fatalf("summary total = %d, want 2", summary.TotalCount)
	}

	reviewedSearch := "Reviewed"
	summary = mustTransactionsSummary(t, tx, &model.TransactionsFilter{Search: &reviewedSearch})
	if summary.TotalCount != 1 || summary.TotalAmount != reviewed.Amount {
		t.Fatalf("filtered summary = count %d amount %d, want count 1 amount %d", summary.TotalCount, summary.TotalAmount, reviewed.Amount)
	}
}

func TestCursorAndLimitHelpers(t *testing.T) {
	if _, err := transactionsdb.DecodeCursor("not-base64"); err == nil {
		t.Fatal("expected invalid cursor error")
	}
	if transactions.TransactionLimit(transactions.TransactionQuery{}) != 50 {
		t.Fatal("default TransactionLimit mismatch")
	}
}

func TestCategoryDeletionErrorStrings(t *testing.T) {
	ctx := context.Background()
	accountsStore, tx := openTestStore(t)
	if _, err := tx.DeleteCategory(ctx, 999); err == nil || err.Error() != "category 999 not found" {
		t.Fatalf("DeleteCategory() error = %v, want category not found", err)
	}

	oneGroup, err := tx.CreateCategoryGroup(ctx, model.CreateCategoryGroupInput{
		Name:  "Delete Errors One",
		Emoji: "X",
		Kind:  model.CategoryKindExpense,
	})
	must.NoErr(t, err)
	oneCategory, err := tx.CreateCategory(ctx, model.CreateCategoryInput{
		Name:    "Delete Errors One",
		Emoji:   "X",
		GroupID: oneGroup.ID,
	})
	must.NoErr(t, err)
	wantGroupErr := "cannot delete group with 1 category; delete all categories first"
	if _, err := tx.DeleteCategoryGroup(ctx, oneGroup.ID.Int64()); err == nil || err.Error() != wantGroupErr {
		t.Fatalf("DeleteCategoryGroup() error = %v, want %q", err, wantGroupErr)
	}

	mustSeedTestAccount(t, ctx, accountsStore)
	accountID := mustTestAccountID(t, tx)
	unknownCategoryID := model.New(model.GlobalIDCategory, 999)
	merchant := "Unknown Category"
	if _, err := tx.CreateTransaction(ctx, model.CreateTransactionInput{AccountID: accountID, Date: model.Date("2026-05-19"), Amount: 10, MerchantName: &merchant, CategoryID: &unknownCategoryID}); err == nil || err.Error() != "category 999 not found" {
		t.Fatalf("CreateTransaction() error = %v, want category not found", err)
	}
	oneCategoryID := oneCategory.ID
	oneMerchant := "Delete Errors A"
	mustCreateTransaction(t, tx, model.CreateTransactionInput{
		AccountID:    accountID,
		Date:         model.Date("2026-05-20"),
		Amount:       10,
		MerchantName: &oneMerchant,
		CategoryID:   &oneCategoryID,
	})
	twoMerchant := "Delete Errors B"
	mustCreateTransaction(t, tx, model.CreateTransactionInput{
		AccountID:    accountID,
		Date:         model.Date("2026-05-21"),
		Amount:       10,
		MerchantName: &twoMerchant,
		CategoryID:   &oneCategoryID,
	})
	wantCategoryErr := "cannot delete category with 2 transactions; reassign them first"
	if _, err := tx.DeleteCategory(ctx, oneCategory.ID.Int64()); err == nil || err.Error() != wantCategoryErr {
		t.Fatalf("DeleteCategory() error = %v, want %q", err, wantCategoryErr)
	}
}

func TestPlaidDetailedCategory(t *testing.T) {
	if got := transactionsdb.PlaidDetailedCategory(new("FOOD_AND_DRINK:FOOD_AND_DRINK_COFFEE")); got != "FOOD_AND_DRINK_COFFEE" {
		t.Fatalf("PlaidDetailedCategory = %q", got)
	}
	if got := transactionsdb.PlaidDetailedCategory(nil); got != "" {
		t.Fatalf("PlaidDetailedCategory(nil) = %q", got)
	}
}

func TestRecurringHelpers(t *testing.T) {
	got := transactionsdb.PlaidFrequencyToInterval("MONTHLY")
	if got == nil || *got != model.RecurrenceIntervalMonthly {
		t.Fatalf("PlaidFrequencyToInterval(MONTHLY) = %v", got)
	}
	if transactionsdb.PlaidFrequencyToInterval("UNKNOWN") != nil {
		t.Fatal("expected nil for unknown frequency")
	}

	status := transactionsdb.PlaidStatusToModel("MATURE")
	if status != model.RecurringStreamStatusMature {
		t.Fatalf("PlaidStatusToModel(MATURE) = %v", status)
	}

	next := transactionsdb.NextExpectedDate(model.Date("2026-05-01"), new(model.RecurrenceIntervalMonthly))
	if next == nil || string(*next) != "2026-06-01" {
		t.Fatalf("NextExpectedDate = %v", next)
	}
	if transactionsdb.NextExpectedDate(model.Date("bad-date"), new(model.RecurrenceIntervalMonthly)) != nil {
		t.Fatal("expected nil for bad date")
	}
}

func TestSpendingByCategory(t *testing.T) {
	tx, filter := spendingReportFixture(t, syncedTxn("spend-tx", 25, "2026-05-15T12:00:00Z", ""))
	categories, err := tx.Categories(context.Background())
	if err != nil || len(categories) < 2 {
		t.Fatalf("Categories() = %d, %v", len(categories), err)
	}
	filter.CategoryIds = []*model.GlobalID{&categories[0].ID, &categories[1].ID}
	report, err := tx.SpendingByCategory(context.Background(), filter)
	must.NoErr(t, err)
	if report == nil {
		t.Fatal("expected non-nil report")
	}
}

func TestOwnerFiltersUseInt64GlobalIDs(t *testing.T) {
	ctx := context.Background()
	store, tx := openTestStore(t)
	alex := seedOwnerFilterAccount(ctx, t, store, 11, "alex", "alex-acc")
	casey := seedOwnerFilterAccount(ctx, t, store, 12, "casey", "casey-acc")
	alexTxn := syncedTxn("alex-tx", 25, "2026-05-15T12:00:00Z", "")
	alexTxn.AccountID = "alex-acc"
	mustUpsertSynced(t, tx, alexTxn)
	caseyTxn := syncedTxn("casey-tx", 40, "2026-05-16T12:00:00Z", "")
	caseyTxn.AccountID = "casey-acc"
	mustUpsertSynced(t, tx, caseyTxn)

	filter := &model.TransactionsFilter{OwnerIds: []*model.GlobalID{&alex.ID}}
	conn := mustTransactions(t, tx, transactions.TransactionQuery{Filter: filter})
	if got := transactionExternalIDs(t, tx, conn); !slices.Equal(got, []string{"alex-tx"}) {
		t.Fatalf("Transactions(owner) external IDs = %#v, want alex-tx", got)
	}

	from := testTime()
	to := testTime().AddDate(0, 1, 0)
	report, err := tx.SpendingByCategory(ctx, model.SpendingFilter{
		DatetimeRange: &model.DateTimeRange{From: &from, To: &to},
		OwnerIds:      []*model.GlobalID{&casey.ID},
	})
	must.NoErr(t, err)
	if report.TransactionCount != 1 || report.TotalAmount != money.FromDollars(40) {
		t.Fatalf("SpendingByCategory(owner) = count %d total %v, want 1/40", report.TransactionCount, report.TotalAmount)
	}
}

func TestSpendingAndCashFlowCategoryKinds(t *testing.T) {
	ctx := context.Background()
	store, tx := openTestStore(t)
	owner := seedOwnerFilterAccount(ctx, t, store, 1, "alex", "spending-acc")
	accountID, err := test.AccountIDByExternalID(ctx, tx.SQL(), "spending-acc")
	must.NoErr(t, err)

	categories, err := tx.Categories(ctx)
	must.NoErr(t, err)
	categoryByKind := func(kind model.CategoryKind) model.GlobalID {
		for _, category := range categories {
			if category.Kind == kind {
				return category.ID
			}
		}
		t.Fatalf("missing %s category", kind)
		return model.GlobalID{}
	}
	expenseID := categoryByKind(model.CategoryKindExpense)
	incomeID := categoryByKind(model.CategoryKindIncome)
	transferID := categoryByKind(model.CategoryKindTransfer)
	date := model.Date("2026-05-15")
	accountGlobalID := model.New(model.GlobalIDAccount, accountID)
	expenseName := "Expense"
	incomeName := "Income"
	transferName := "Transfer"
	mustCreateTransaction(t, tx, model.CreateTransactionInput{AccountID: accountGlobalID, Date: date, Amount: money.FromDollars(50), MerchantName: &expenseName, CategoryID: &expenseID})
	mustCreateTransaction(t, tx, model.CreateTransactionInput{AccountID: accountGlobalID, Date: date, Amount: money.FromDollars(-100), MerchantName: &incomeName, CategoryID: &incomeID})
	mustCreateTransaction(t, tx, model.CreateTransactionInput{AccountID: accountGlobalID, Date: date, Amount: money.FromDollars(25), MerchantName: &transferName, CategoryID: &transferID})
	from := testTime()
	to := from.AddDate(0, 1, 0)
	filter := model.SpendingFilter{DatetimeRange: &model.DateTimeRange{From: &from, To: &to}}

	spending, err := tx.SpendingByCategory(ctx, filter)
	must.NoErr(t, err)
	if spending.TransactionCount != 1 || spending.TotalAmount != money.FromDollars(50) {
		t.Fatalf("SpendingByCategory() = count %d total %v, want 1/50", spending.TransactionCount, spending.TotalAmount)
	}
	filter.OwnerIds = []*model.GlobalID{&owner.ID}
	ownerSpending, err := tx.SpendingByCategory(ctx, filter)
	must.NoErr(t, err)
	if ownerSpending.TransactionCount != 1 || ownerSpending.TotalAmount != money.FromDollars(50) {
		t.Fatalf("SpendingByCategory(owner) = count %d total %v, want 1/50", ownerSpending.TransactionCount, ownerSpending.TotalAmount)
	}

	periods, err := tx.CashFlow(ctx, model.SpendingFilter{DatetimeRange: &model.DateTimeRange{From: &from, To: &to}})
	must.NoErr(t, err)
	if len(periods) != 1 || periods[0].Summary.Income != money.FromDollars(100) || periods[0].Summary.Expenses != money.FromDollars(50) {
		t.Fatalf("CashFlow() = %#v, want income 100 and expenses 50", periods)
	}
}

func TestExportTransactionPage(t *testing.T) {
	ctx := context.Background()
	_, tx := openSeededTestStore(t)
	mustUpsertSynced(t, tx, syncedTxn("exp-tx", 9.99, "2026-05-10T12:00:00Z", ""))
	rows, cursor, err := tx.ExportTransactionPage(ctx, nil, nil, 500)
	must.NoErr(t, err)
	if len(rows) != 1 {
		t.Fatalf("ExportTransactionPage() len = %d", len(rows))
	}
	if rows[0].Source != transactions.TransactionSourcePlaid {
		t.Fatalf("ExportTransactionPage()[0].Source = %q, want plaid", rows[0].Source)
	}
	if cursor != nil {
		t.Fatalf("ExportTransactionPage() cursor = %v, want nil (last page)", cursor)
	}
}

func TestExportTransactionPagePagesByCursor(t *testing.T) {
	ctx := context.Background()
	_, tx := openSeededTestStore(t)
	mustUpsertSynced(t, tx, syncedTxn("exp-tx-1", 9.99, "2026-05-10T12:00:00Z", ""))
	mustUpsertSynced(t, tx, syncedTxn("exp-tx-2", 19.99, "2026-05-11T12:00:00Z", ""))
	mustUpsertSynced(t, tx, syncedTxn("exp-tx-3", 29.99, "2026-05-12T12:00:00Z", ""))

	var externalIDs []string
	var cursor *transactions.Cursor
	for {
		page, next, err := tx.ExportTransactionPage(ctx, nil, cursor, 1)
		must.NoErr(t, err)
		if len(page) != 1 {
			t.Fatalf("ExportTransactionPage() len = %d, want 1", len(page))
		}
		externalIDs = append(externalIDs, page[0].ExternalID)
		if next == nil {
			break
		}
		cursor = next
	}
	// Ordered by date desc then id desc: the newest transaction first.
	if want := []string{"exp-tx-3", "exp-tx-2", "exp-tx-1"}; !slices.Equal(externalIDs, want) {
		t.Fatalf("paged external IDs = %#v, want %#v", externalIDs, want)
	}
}

func seedOwnerFilterAccount(
	_ context.Context,
	tb testing.TB,
	store *accountsdb.Store,
	sourceID int64,
	ownerName string,
	externalID string,
) *model.Owner {
	tb.Helper()
	owner := test.MustCreateOwner(tb, store, model.CreateOwnerInput{Name: ownerName})
	connectionName := ownerName + " Institution"
	conn := test.MustCreateConnection(tb, store, sourceID, &connectionName, owner.ID.Int64())
	test.MustUpsertAccount(tb, store, externalID, &model.Account{
		Connection: conn,
		Owner:      owner,
		Name:       ownerName + " Checking",
		Type:       model.AccountTypeDepository,
	})
	return owner
}

func TestUpsertSyncedAccount(t *testing.T) {
	ctx := context.Background()
	accountsStore, tx := openTestStore(t)
	owner := test.MustCreateOwner(t, accountsStore, model.CreateOwnerInput{Name: "tester"})
	connectionName := "Institution"
	conn := test.MustCreateConnection(t, accountsStore, 1, &connectionName, owner.ID.Int64())
	subtype := "checking"
	mask := "1234"

	must.NoErr(t, tx.UpsertSyncedAccount(ctx, transactions.AccountDraft{
		ID:           "synced-acc",
		ConnectionID: conn.ID.Int64(),
		OwnerID:      owner.ID.Int64(),
		Name:         "Synced Checking",
		Type:         model.AccountTypeDepository,
		Subtype:      &subtype,
		Mask:         &mask,
		NeedsReview:  true,
	}))

	accountID, err := test.AccountIDByExternalID(ctx, tx.SQL(), "synced-acc")
	must.NoErr(t, err)
	account, err := accountsStore.AccountByID(ctx, accountID)
	must.NoErr(t, err)
	if account.Name != "Synced Checking" || account.Connection.ID.Int64() != conn.ID.Int64() || account.Owner.ID.Int64() != owner.ID.Int64() || !account.NeedsReview {
		t.Fatalf("account = %#v", account)
	}
}

func TestReorderCategories(t *testing.T) {
	ctx := context.Background()
	_, tx := openTestStore(t)
	groups, err := tx.CategoryGroups(ctx)
	if err != nil || len(groups) == 0 {
		t.Fatalf("CategoryGroups(): %v", err)
	}
	grp := groups[0]
	if len(grp.Categories) < 2 {
		t.Skip("need at least 2 categories to reorder")
	}
	ids := []*model.GlobalID{&grp.Categories[1].ID, &grp.Categories[0].ID}
	if _, err := tx.ReorderCategories(ctx, model.ReorderCategoriesInput{GroupID: grp.ID, CategoryIds: ids}); err != nil {
		t.Fatalf("ReorderCategories(): %v", err)
	}
	missingGroup := model.New(model.GlobalIDCategoryGroup, 999999)
	if _, err := tx.ReorderCategories(ctx, model.ReorderCategoriesInput{GroupID: missingGroup}); err == nil || err.Error() != "category group 999999 not found" {
		t.Fatalf("ReorderCategories(missing) error = %v, want missing group error", err)
	}
}

func TestDeleteCategoryRejectsSentinel(t *testing.T) {
	ctx := context.Background()
	_, tx := openTestStore(t)
	if _, err := tx.DeleteCategory(ctx, 0); err == nil {
		t.Fatal("expected error deleting sentinel category")
	}
}

func mustSeedTestAccount(tb testing.TB, _ context.Context, store *accountsdb.Store) {
	tb.Helper()
	owner := test.MustCreateOwner(tb, store, model.CreateOwnerInput{Name: "tester"})
	connectionName := "Institution"
	conn := test.MustCreateConnection(tb, store, 1, &connectionName, owner.ID.Int64())
	test.MustUpsertAccount(tb, store, "test-acc", &model.Account{
		Connection: conn,
		Owner:      owner,
		Name:       "Test Checking",
		Type:       model.AccountTypeDepository,
	})
}

func mustTestAccountID(tb testing.TB, tx *transactionsdb.Store) model.GlobalID {
	tb.Helper()
	id, err := test.AccountIDByExternalID(context.Background(), tx.SQL(), "test-acc")
	must.NoErr(tb, err)
	return model.New(model.GlobalIDAccount, id)
}

func assertSearchIDs(tb testing.TB, tx *transactionsdb.Store, search string, want []string) {
	tb.Helper()
	conn, err := tx.Transactions(context.Background(), transactions.TransactionQuery{Filter: &model.TransactionsFilter{Search: &search}})
	must.NoErr(tb, err)
	if got := transactionLocalIDs(conn); !slices.Equal(got, want) {
		tb.Fatalf("Transactions search %q IDs = %#v, want %#v", search, got, want)
	}
}

func assertSearchExternalIDs(tb testing.TB, tx *transactionsdb.Store, search string, want []string) {
	tb.Helper()
	conn, err := tx.Transactions(context.Background(), transactions.TransactionQuery{Filter: &model.TransactionsFilter{Search: &search}})
	must.NoErr(tb, err)
	if got := transactionExternalIDs(tb, tx, conn); !slices.Equal(got, want) {
		tb.Fatalf("Transactions search %q external IDs = %#v, want %#v", search, got, want)
	}
}

// TestTransactionsListHydratesJoinedRelations guards TransactionRecords' row
// mapping on the list path. A wrong field in transactionFromRow (e.g. reading
// the wrong embedded struct) would still compile, so every other test here
// asserts only on transaction columns and would still pass with the account,
// owner, and category joins silently empty.
func TestTransactionsListHydratesJoinedRelations(t *testing.T) {
	ctx := context.Background()
	_, tx := openSeededTestStore(t)
	cats, err := tx.Categories(ctx)
	must.NoErr(t, err)
	if len(cats) == 0 {
		t.Fatal("Categories() returned none")
	}
	catID := cats[0].ID
	mustCreateTransaction(t, tx, model.CreateTransactionInput{
		AccountID:    mustTestAccountID(t, tx),
		Date:         model.Date("2026-05-20"),
		Amount:       11,
		MerchantName: new("Joined Relations"),
		CategoryID:   &catID,
	})

	conn := mustTransactions(t, tx, transactions.TransactionQuery{})
	if len(conn.Edges) != 1 {
		t.Fatalf("edges = %d, want 1", len(conn.Edges))
	}
	got := conn.Edges[0].Node
	if got.Account == nil {
		t.Fatal("Account is nil, want the joined accounts row")
	}
	if got.Account.Name != "Test Checking" || got.Account.Type != model.AccountTypeDepository {
		t.Errorf("Account = %q/%s, want %q/%s", got.Account.Name, got.Account.Type, "Test Checking", model.AccountTypeDepository)
	}
	if got.Account.Owner == nil || got.Account.Owner.Name != "tester" {
		t.Errorf("Account.Owner = %#v, want name %q", got.Account.Owner, "tester")
	}
	if got.Account.Connection == nil {
		t.Error("Account.Connection is nil, want the connection_id column mapped")
	}
	if got.Category == nil || got.Category.Name != cats[0].Name {
		t.Errorf("Category = %#v, want name %q", got.Category, cats[0].Name)
	}
	if got.MerchantName == nil || *got.MerchantName != "Joined Relations" {
		t.Errorf("MerchantName = %v, want %q", got.MerchantName, "Joined Relations")
	}
}

func transactionLocalIDs(conn *model.TransactionConnection) []string {
	ids := make([]string, 0, len(conn.Edges))
	for _, edge := range conn.Edges {
		ids = append(ids, strconv.FormatInt(edge.Node.ID.Int64(), 10))
	}
	return ids
}

func transactionExternalIDs(tb testing.TB, tx *transactionsdb.Store, conn *model.TransactionConnection) []string {
	tb.Helper()
	ids := make([]string, 0, len(conn.Edges))
	for _, edge := range conn.Edges {
		transactionID := edge.Node.ID.Int64()
		var externalID string
		must.NoErr(tb, tx.SQL().QueryRowContext(context.Background(), `SELECT external_id FROM transactions WHERE id = ?`, transactionID).Scan(&externalID))
		ids = append(ids, externalID)
	}
	return ids
}

func mustTransactionByExternalID(tb testing.TB, tx *transactionsdb.Store, externalID string) *model.Transaction {
	tb.Helper()
	transaction, err := test.TransactionBySourceExternalID(context.Background(), tx, transactions.TransactionSourcePlaid, externalID)
	must.NoErr(tb, err)
	if transaction == nil {
		tb.Fatalf("TransactionByExternalID(%q) = nil", externalID)
	}
	return transaction
}

func mustTransactionGlobalID(tb testing.TB, tx *transactionsdb.Store, externalID string) model.GlobalID {
	tb.Helper()
	return mustTransactionByExternalID(tb, tx, externalID).ID
}
