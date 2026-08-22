package txnplaid

import (
	"context"

	"tallyo/internal/graph/model"
	"tallyo/internal/transactions"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
	"github.com/samber/lo"
)

func (a *Adapter) recordItemSyncError(ctx context.Context, itemID int64, err error) {
	plaidErr, parseErr := plaidapi.ToPlaidError(err)
	if parseErr != nil {
		return
	}
	state := model.PlaidItemHealthStateSyncError
	if plaidErr.GetErrorCode() == "ITEM_LOGIN_REQUIRED" {
		state = model.PlaidItemHealthStateLinkUpdateRequired
	}
	code := lo.EmptyableToPtr(plaidErr.GetErrorCode())
	message := lo.EmptyableToPtr(plaidErr.GetErrorMessage())
	if healthErr := a.plaid.SetPlaidItemHealth(ctx, itemID, state, code, message); healthErr != nil {
		a.Log.Error("failed to update plaid item health", "item_id", itemID, "error", healthErr)
	}
}

func (a *Adapter) generalErrorReport(err error) transactions.SyncReport {
	a.Log.Error("plaid sync failed")
	return transactions.SyncReport{
		Items: []transactions.ItemReport{{Err: err}},
	}
}
