package graph

import (
	"context"
	"errors"
	"testing"

	"tallyo/internal/apierror"
	"tallyo/internal/graph/model"
)

func TestResolverFilterIDsRejectWrongTypes(t *testing.T) {
	ctx := allScopesCtx()
	resolver := &Resolver{}
	query := resolver.Query().(*queryResolver)
	mutation := resolver.Mutation().(*mutationResolver)
	account := model.New(model.GlobalIDAccount, 1)
	owner := model.New(model.GlobalIDOwner, 1)
	tests := map[string]error{
		"transactions account":  resultErr(query.Transactions(ctx, &model.TransactionsInput{Filter: &model.TransactionsFilter{AccountIds: globalIDs(owner)}})),
		"transactions owner":    resultErr(query.Transactions(ctx, &model.TransactionsInput{Filter: &model.TransactionsFilter{OwnerIds: globalIDs(account)}})),
		"transactions category": resultErr(query.Transactions(ctx, &model.TransactionsInput{Filter: &model.TransactionsFilter{CategoryIds: globalIDs(account)}})),
		"summary category":      resultErr(query.TransactionsSummary(ctx, &model.TransactionsFilter{CategoryIds: globalIDs(account)})),
		"bulk delete account":   resultErr(mutation.BulkDeleteTransactions(ctx, model.BulkDeleteTransactionsInput{Filter: &model.TransactionsFilter{AccountIds: globalIDs(owner)}})),
		"spending category":     resultErr(query.SpendingByCategory(ctx, model.SpendingFilter{CategoryIds: globalIDs(account)})),
		"cash flow owner":       resultErr(query.CashFlow(ctx, model.SpendingFilter{OwnerIds: globalIDs(account)})),
		"net worth owner":       resultErr(query.NetWorth(ctx, model.NetWorthInput{OwnerIds: globalIDs(account)})),
		"net worth account":     resultErr(query.NetWorth(ctx, model.NetWorthInput{AccountIds: globalIDs(owner)})),
		"historical owner": resultErr(query.HistoricalNetWorth(ctx, model.HistoricalNetWorthInput{
			Range: model.NetWorthRangeOneMonth, Filters: &model.NetWorthInput{OwnerIds: globalIDs(account)},
		})),
	}
	assertResolverErrors(t, tests)
}

func TestResolverScalarIDsRejectWrongTypes(t *testing.T) {
	ctx := context.Background()
	resolver := &Resolver{}
	mutation := resolver.Mutation().(*mutationResolver)
	wrong := model.New(model.GlobalIDOwner, 1)
	account := model.New(model.GlobalIDAccount, 1)
	group := model.New(model.GlobalIDCategoryGroup, 1)
	snapshot := model.New(model.GlobalIDSnapshot, 1)
	tests := map[string]error{
		"transaction":                 resultErr(resolver.GetTransaction(ctx, wrong)),
		"update transaction":          resultErr(resolver.UpdateTransaction(ctx, model.UpdateTransactionInput{ID: wrong, Updates: &model.TransactionUpdates{}})),
		"delete transaction":          resultErr(resolver.DeleteTransaction(ctx, wrong)),
		"create transaction account":  resultErr(resolver.CreateTransaction(ctx, model.CreateTransactionInput{AccountID: wrong})),
		"update category group":       resultErr(resolver.UpdateCategoryGroup(ctx, model.UpdateCategoryGroupInput{ID: wrong})),
		"delete category group":       resultErr(resolver.DeleteCategoryGroup(ctx, wrong)),
		"create category group":       resultErr(resolver.CreateCategory(ctx, model.CreateCategoryInput{GroupID: wrong})),
		"update category":             resultErr(resolver.UpdateCategory(ctx, model.UpdateCategoryInput{ID: wrong, GroupID: group})),
		"delete category":             resultErr(resolver.DeleteCategory(ctx, wrong)),
		"reorder categories":          resultErr(resolver.ReorderCategories(ctx, model.ReorderCategoriesInput{GroupID: wrong})),
		"update tag":                  resultErr(resolver.UpdateTag(ctx, model.UpdateTagInput{ID: wrong})),
		"delete tag":                  resultErr(resolver.DeleteTag(ctx, wrong)),
		"update rule":                 resultErr(resolver.UpdateRule(ctx, model.UpdateRuleInput{ID: wrong})),
		"delete rule":                 resultErr(resolver.DeleteRule(ctx, wrong)),
		"update asset":                resultErr(resolver.UpdateAsset(ctx, model.UpdateAssetInput{ID: wrong})),
		"merge asset":                 resultErr(mutation.MergeAsset(ctx, model.MergeAssetInput{AssetID: wrong})),
		"resolve review":              resultErr(mutation.ResolveBalanceReview(ctx, model.ResolveBalanceReviewInput{ID: wrong})),
		"update connection":           resultErr(resolver.UpdateConnection(ctx, model.UpdateConnectionInput{ConnectionID: wrong})),
		"delete connection":           resultErr(mutation.DeleteConnection(ctx, model.DeleteConnectionInput{ConnectionID: wrong})),
		"plaid link owner":            resultErr(resolver.CreateLinkToken(ctx, model.CreateLinkTokenInput{OwnerID: account})),
		"plaid exchange owner":        resultErr(resolver.ExchangePublicToken(ctx, model.ExchangePublicTokenInput{OwnerID: account})),
		"plaid update":                resultErr(resolver.CreateUpdateLinkToken(ctx, wrong)),
		"plaid complete":              resultErr(resolver.CompleteLinkUpdate(ctx, wrong)),
		"create simplefin owner":      resultErr(mutation.CreateSimpleFinAccessToken(ctx, model.CreateSimpleFinAccessTokenInput{OwnerID: account})),
		"link EVM owner":              resultErr(mutation.LinkEVMWallet(ctx, model.LinkEVMWalletInput{OwnerID: account})),
		"unlink EVM":                  resultErr(mutation.UnlinkEVMWallet(ctx, wrong)),
		"link real estate owner":      resultErr(resolver.LinkRealEstate(ctx, model.LinkRealEstateInput{OwnerID: account, ManualValuationUsd: 1})),
		"update real estate":          resultErr(resolver.UpdateRealEstate(ctx, model.UpdateRealEstateInput{ConnectionID: wrong})),
		"unlink real estate":          resultErr(resolver.UnlinkRealEstate(ctx, wrong)),
		"delete owner":                resultErr(resolver.DeleteOwner(ctx, account)),
		"create manual account owner": resultErr(resolver.CreateManualAccount(ctx, model.CreateManualAccountInput{OwnerID: account})),
		"update account":              resultErr(resolver.UpdateAccount(ctx, model.UpdateAccountInput{ID: wrong})),
		"remove manual account":       resultErr(resolver.RemoveManualAccount(ctx, model.RemoveManualAccountInput{ID: wrong})),
		"account query":               resultErr(resolver.QueryAccount(ctx, wrong)),
		"account snapshots":           resultErr(resolver.AccountSnapshots(ctx, model.AccountSnapshotsInput{AccountID: wrong})),
		"account snapshot":            resultErr(resolver.AccountSnapshot(ctx, model.AccountSnapshotInput{AccountID: &wrong})),
		"change snapshot":             resultErr(mutation.ChangeAccountSnapshot(ctx, model.ChangeAccountSnapshotInput{SnapshotID: wrong})),
		"change snapshot asset": resultErr(mutation.ChangeAccountSnapshot(ctx, model.ChangeAccountSnapshotInput{
			SnapshotID: snapshot, Holdings: []*model.SnapshotHoldingInput{{AssetID: wrong}},
		})),
		"set budget":    resultErr(resolver.SetBudget(ctx, model.SetBudgetInput{CategoryID: wrong})),
		"delete budget": resultErr(resolver.DeleteBudget(ctx, model.DeleteBudgetInput{ID: wrong})),
		"invite user":   resultErr(mutation.CreateInviteLink(ctx, model.CreateInviteLinkInput{UserID: wrong})),
		"remove user":   resultErr(mutation.RemoveUser(ctx, model.RemoveUserInput{ID: wrong})),
		"update user":   resultErr(mutation.UpdateUser(ctx, model.UpdateUserInput{ID: wrong})),
		"empty user":    resultErr(mutation.AddUser(ctx, model.AddUserInput{})),
	}
	assertResolverErrors(t, tests)
}

func globalIDs(ids ...model.GlobalID) []*model.GlobalID {
	globalIDs := make([]*model.GlobalID, 0, len(ids))
	for i := range ids {
		globalIDs = append(globalIDs, &ids[i])
	}
	return globalIDs
}

func resultErr(_ any, err error) error { return err }

func assertResolverErrors(t *testing.T, tests map[string]error) {
	t.Helper()
	for name, err := range tests {
		if _, ok := errors.AsType[*apierror.Error](err); !ok {
			t.Errorf("%s: error = %v, want public boundary error", name, err)
		}
	}
}
