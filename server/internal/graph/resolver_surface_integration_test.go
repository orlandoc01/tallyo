package graph

import (
	"context"
	"testing"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/transactions"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
)

func TestResolverSurface(t *testing.T) {
	ctx := allScopesCtx()
	resolver, store := testResolver(t)
	resolver.Wealth = testWealthService(store.WealthDB)
	ctx = NewLoadersContext(ctx, resolver.NewLoaders())
	account := test.SeedPlaidAccount(t, store.Accounts, store.AdminDB, "acc", "alex")
	tx1 := seedResolverTransaction(t, store, "tx-1", "2026-05-20", 10)
	tx2 := seedResolverTransaction(t, store, "tx-2", "2026-05-21", 20)
	shopping := model.New(model.GlobalIDCategory, test.CategoryIDByName(t, store.Transactions, "Shopping"))
	mutation := resolver.Mutation().(*mutationResolver)
	query := resolver.Query().(*queryResolver)

	merchant := "Manual Store"
	created, err := mutation.CreateTransaction(ctx, model.CreateTransactionInput{
		AccountID: account.ID, Date: model.Date("2026-05-22"), Amount: money.FromDollars(12.34), MerchantName: &merchant, CategoryID: &shopping,
	})
	if err != nil || created.Transaction.Account.ID != account.ID {
		t.Fatalf("CreateTransaction() = %#v, %v", created, err)
	}
	notes := "memo"
	merchantName := "Updated Store"
	updated, err := mutation.UpdateTransaction(ctx, model.UpdateTransactionInput{ID: tx1, Updates: &model.TransactionUpdates{CategoryID: &shopping, MerchantName: &merchantName, Notes: &notes}})
	if err != nil || updated.Transaction.Notes == nil || updated.Transaction.MerchantName == nil || *updated.Transaction.MerchantName != merchantName {
		t.Fatalf("UpdateTransaction() = %#v, %v", updated, err)
	}
	tag, err := mutation.CreateTag(ctx, model.CreateTagInput{Name: "Work", Color: "#3B82F6"})
	must.NoErr(t, err)
	tagID := tag.Tag.ID
	must.NoErr(t, resultErr(mutation.UpdateTag(ctx, model.UpdateTagInput{ID: tagID, Name: "Travel", Color: "#22C55E"})))
	must.NoErr(t, resultErr(mutation.UpdateTransaction(ctx, model.UpdateTransactionInput{ID: tx1, Updates: &model.TransactionUpdates{TagIds: globalIDs(tagID)}})))
	if tags, err := resolver.Transaction().(*transactionResolver).Tags(ctx, &model.Transaction{ID: tx1}); err != nil || len(tags) != 1 {
		t.Fatalf("Transaction.Tags() = %#v, %v", tags, err)
	}
	if tags, err := query.Tags(ctx); err != nil || len(tags.Items) != 1 {
		t.Fatalf("Tags() = %#v, %v", tags, err)
	}
	if payload, err := mutation.BulkUpdateTransactions(ctx, model.BulkUpdateTransactionsInput{TransactionIds: globalIDs(tx1, tx2), Updates: &model.TransactionUpdates{CategoryID: &shopping}}); err != nil || payload.UpdatedCount != 2 {
		t.Fatalf("BulkUpdateTransactions() = %#v, %v", payload, err)
	}

	merchantPattern := "store"
	rule, err := mutation.CreateRule(ctx, model.CreateRuleInput{
		MerchantPattern: &merchantPattern, Changes: &model.TransactionUpdates{CategoryID: &shopping, TagIds: globalIDs(tagID)}, AccountIds: globalIDs(account.ID),
	})
	if err != nil || len(rule.Rule.Tags) != 1 || len(rule.Rule.Accounts) != 1 {
		t.Fatalf("CreateRule() = %#v, %v", rule, err)
	}
	must.NoErr(t, resultErr(mutation.UpdateRule(ctx, model.UpdateRuleInput{ID: rule.Rule.ID, MerchantPattern: &merchantPattern, Changes: &model.TransactionUpdates{CategoryID: &shopping}})))
	if rules, err := query.Rules(ctx, nil); err != nil || len(rules.Items) != 1 {
		t.Fatalf("Rules() = %#v, %v", rules, err)
	}
	assertReferenceQueries(t, ctx, query, account.ID)

	group, err := mutation.CreateCategoryGroup(ctx, model.CreateCategoryGroupInput{Name: "Transport", Emoji: "car", Kind: model.CategoryKindExpense})
	must.NoErr(t, err)
	groupID := group.Group.ID
	must.NoErr(t, resultErr(mutation.UpdateCategoryGroup(ctx, model.UpdateCategoryGroupInput{ID: groupID, Name: "Travel", Emoji: "plane"})))
	category, err := mutation.CreateCategory(ctx, model.CreateCategoryInput{Name: "Train", Emoji: "train", GroupID: groupID})
	must.NoErr(t, err)
	categoryID := category.Category.ID
	must.NoErr(t, resultErr(mutation.UpdateCategory(ctx, model.UpdateCategoryInput{ID: categoryID, Name: "Metro", Emoji: "metro", GroupID: groupID})))
	must.NoErr(t, resultErr(mutation.ReorderCategories(ctx, model.ReorderCategoriesInput{GroupID: groupID, CategoryIds: globalIDs(categoryID)})))
	owner, err := mutation.CreateOwner(ctx, model.CreateOwnerInput{Name: "temporary"})
	must.NoErr(t, err)
	must.NoErr(t, resultErr(mutation.DeleteOwner(ctx, owner.ID)))
	user, err := mutation.AddUser(ctx, model.AddUserInput{Email: "friend@example.com"})
	must.NoErr(t, err)
	must.NoErr(t, resultErr(mutation.UpdateUser(ctx, model.UpdateUserInput{ID: user.User.ID, Role: model.RoleReadonly})))
	if _, err := mutation.CreateInviteLink(ctx, model.CreateInviteLinkInput{UserID: user.User.ID}); err == nil {
		t.Fatal("expected disabled invitation error")
	}
	must.NoErr(t, resultErr(mutation.RemoveUser(ctx, model.RemoveUserInput{ID: user.User.ID})))
	name := "Updated"
	must.NoErr(t, resultErr(mutation.UpdateAccount(ctx, model.UpdateAccountInput{ID: account.ID, Name: &name})))
	manual, err := mutation.CreateManualAccount(ctx, model.CreateManualAccountInput{Name: "Cash", OwnerID: account.Owner.ID, Type: model.AccountTypeDepository})
	must.NoErr(t, err)
	must.NoErr(t, resultErr(mutation.RemoveManualAccount(ctx, model.RemoveManualAccountInput{ID: manual.Account.ID})))
	must.NoErr(t, resultErr(mutation.DeleteRule(ctx, rule.Rule.ID)))
	must.NoErr(t, resultErr(mutation.DeleteCategory(ctx, categoryID)))
	must.NoErr(t, resultErr(mutation.DeleteCategoryGroup(ctx, groupID)))
	must.NoErr(t, resultErr(mutation.DeleteTag(ctx, tagID)))
	must.NoErr(t, resultErr(mutation.DeleteTransaction(ctx, created.Transaction.ID)))
	must.NoErr(t, resultErr(mutation.BulkDeleteTransactions(ctx, model.BulkDeleteTransactionsInput{TransactionIds: globalIDs(tx2)})))
}

func assertReferenceQueries(t *testing.T, ctx context.Context, query *queryResolver, accountID model.GlobalID) {
	t.Helper()
	calls := []func() error{
		func() error { _, err := query.Categories(ctx); return err },
		func() error { _, err := query.CategoryGroups(ctx); return err },
		func() error { _, err := query.Accounts(ctx); return err },
		func() error { _, err := query.Owners(ctx); return err },
		func() error { _, err := query.PlaidItems(ctx, nil); return err },
		func() error { _, err := query.PlaidCredentials(ctx); return err },
		func() error { _, err := query.PlaidPFC2Codes(ctx); return err },
		func() error { _, err := query.RecurringCharges(ctx); return err },
		func() error { _, err := query.Connections(ctx, nil); return err },
		func() error { _, err := query.EvmChains(ctx); return err },
		func() error { _, err := query.Users(ctx); return err },
		func() error { _, err := query.SimpleFinAccessTokens(ctx); return err },
		func() error { _, err := query.Assets(ctx, nil); return err },
		func() error { _, err := query.BalanceSnapshotReviews(ctx); return err },
		func() error {
			_, err := query.AccountSnapshots(ctx, model.AccountSnapshotsInput{AccountID: accountID})
			return err
		},
		func() error {
			_, err := query.AccountSnapshot(ctx, model.AccountSnapshotInput{AccountID: &accountID})
			return err
		},
		func() error { _, err := query.GeneralConfiguration(ctx); return err },
		func() error { _, err := query.InstanceTimezone(ctx); return err },
	}
	for _, call := range calls {
		must.NoErr(t, call())
	}
}

func seedResolverTransaction(t *testing.T, store *graphTestStore, id, date string, amount float64) model.GlobalID {
	t.Helper()
	datetime := test.DateTime(date + "T00:00:00Z")
	if _, err := store.Transactions.UpsertSyncedTransaction(context.Background(), transactions.SyncedTransaction{ExternalID: id, AccountID: "acc", Amount: amount, Datetime: datetime, PostedDatetime: datetime}); err != nil {
		t.Fatal(err)
	}
	return test.MustTransactionBySourceExternalID(t, store.Transactions, transactions.TransactionSourcePlaid, id, "TransactionByExternalID() error = %v").ID
}
