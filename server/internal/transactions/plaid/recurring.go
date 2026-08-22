package txnplaid

import (
	"context"
	"strings"

	"tallyo/internal/accounts"
	"tallyo/internal/transactions"
	u "tallyo/internal/utils"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
	"github.com/samber/lo"
)

func (a *Adapter) SyncRecurringDue(ctx context.Context, sink transactions.PersistSink) transactions.SyncReport {
	items, err := a.plaid.PlaidItemsDueForRecurringSync(ctx, a.utcNow())
	if err != nil {
		a.Log.Error("failed to fetch active plaid items for recurring sync", "error", err)
		return a.generalErrorReport(err)
	}
	syncItem := func(item accounts.PlaidItemSecret) transactions.ItemReport {
		return a.syncRecurringItem(ctx, item, sink)
	}
	return transactions.SyncReport{Items: u.Map(items, syncItem)}
}

func (a *Adapter) syncRecurringItem(
	ctx context.Context,
	item accounts.PlaidItemSecret,
	sink transactions.PersistSink,
) transactions.ItemReport {
	accountIDs, err := a.Reads.SyncableAccountExternalIDsByItem(ctx, item.ID)
	if err != nil {
		a.Log.Warn("sync recurring streams: failed to fetch accounts", "item_id", item.ID, "error", err)
		return transactions.ItemReport{Err: err}
	}
	if len(accountIDs) == 0 {
		return a.advanceRecurringSync(ctx, item, transactions.ItemCounts{})
	}
	client, err := a.clients.ClientForCredential(ctx, item.CredentialID)
	if err != nil {
		a.Log.Warn("sync recurring streams: failed to create client", "item_id", item.ID, "error", err)
		return transactions.ItemReport{Err: err}
	}
	resp, err := client.TransactionsRecurringGet(ctx, item.AccessToken, accountIDs)
	if err != nil {
		a.logRecurringPlaidError(item.ID, err)
		return a.advanceRecurringSync(ctx, item, transactions.ItemCounts{})
	}

	streams := append(resp.GetInflowStreams(), resp.GetOutflowStreams()...)
	persist := transactions.WithPersist(ctx, sink, func(events chan<- transactions.PersistEvent) error {
		for _, stream := range streams {
			draft := recurringChargeDraft(stream)
			events <- transactions.PersistEvent{Recurring: &draft}
		}
		events <- transactions.PersistEvent{MarkRecurring: &transactions.MarkRecurringStep{SourceID: item.ID}}
		return nil
	})
	if persist.Err != nil {
		a.logPersistError(item.ID, persist.Err)
		return transactions.ItemReport(persist)
	}
	a.Log.Info("sync recurring streams complete", "item_id", item.ID, "streams", len(streams))
	return a.advanceRecurringSync(ctx, item, persist.Counts)
}

func (a *Adapter) advanceRecurringSync(
	ctx context.Context,
	item accounts.PlaidItemSecret,
	counts transactions.ItemCounts,
) transactions.ItemReport {
	nextRecurringSyncAt, err := u.NextAfter(item.RecurringSyncCron, a.utcNow())
	if err != nil {
		return transactions.ItemReport{Counts: counts, Err: err}
	}
	if err := a.plaid.SetItemRecurringSynced(ctx, item.ID, nextRecurringSyncAt); err != nil {
		return transactions.ItemReport{Counts: counts, Err: err}
	}
	return transactions.ItemReport{Counts: counts}
}

func recurringChargeDraft(stream plaidapi.TransactionStream) transactions.RecurringChargeDraft {
	avgAmount := stream.GetAverageAmount()
	lastAmount := stream.GetLastAmount()
	merchantName := strings.TrimSpace(stream.GetMerchantName())
	return transactions.RecurringChargeDraft{
		ExternalID:     stream.GetStreamId(),
		AccountID:      stream.GetAccountId(),
		Description:    stream.GetDescription(),
		MerchantName:   lo.EmptyableToPtr(merchantName),
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

func (a *Adapter) logRecurringPlaidError(itemID int64, err error) {
	plaidErr, parseErr := plaidapi.ToPlaidError(err)
	if parseErr == nil {
		a.Log.Warn(
			"sync recurring streams: plaid api error, skipping",
			"item_id",
			itemID,
			"error_code",
			plaidErr.GetErrorCode(),
			"error_message",
			plaidErr.GetErrorMessage(),
		)
		return
	}
	a.Log.Warn("sync recurring streams: request failed, skipping", "item_id", itemID, "error", err)
}
