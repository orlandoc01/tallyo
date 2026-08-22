package txnsimplefin

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/samber/lo"
	"tallyo/internal/clients"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/transactions"
)

func (a *Adapter) setConnectionHealth(
	ctx context.Context,
	accountSet clients.SimpleFinAccountSet,
	connections map[string]linkedSimpleFinConnection,
	tokenID int64,
) {
	now := a.utcNow()
	setHealth := func(connID int64, state string, message *string) {
		if err := a.accounts.SetSimpleFinConnectionHealth(ctx, connID, state, message, now); err != nil {
			a.log.Warn("set simplefin connection health", "token_id", tokenID, "conn_id", connID, "error", err)
		}
	}
	for _, conn := range accountSet.Connections {
		linked, ok := connections[conn.ConnID]
		if !ok {
			continue
		}
		setHealth(linked.SimpleFinConnID, string(model.PlaidItemHealthStateHealthy), nil)
	}
	missingErrorConnID := func(item clients.SimpleFinError, _ int) (string, bool) {
		_, ok := connections[item.ConnID]
		return item.ConnID, !ok
	}
	missingConnIDs := lo.Uniq(lo.FilterMap(accountSet.Errors, missingErrorConnID))
	idsByExternalID := map[string]int64{}
	if len(missingConnIDs) > 0 {
		var err error
		idsByExternalID, err = a.accounts.SimpleFinConnectionIDsByExternalID(ctx, tokenID, missingConnIDs)
		if err != nil {
			a.log.Warn("resolve simplefin error connections", "token_id", tokenID, "error", err)
			idsByExternalID = map[string]int64{}
		}
	}
	for _, item := range accountSet.Errors {
		connID, ok := idsByExternalID[item.ConnID]
		if linked, found := connections[item.ConnID]; found {
			connID = linked.SimpleFinConnID
			ok = true
		}
		if !ok {
			continue
		}
		message := item.Message
		setHealth(connID, string(model.PlaidItemHealthStateSyncError), &message)
	}
}

func (a *Adapter) logSync(
	ctx context.Context,
	tokenID int64,
	startDate *time.Time,
	fetchedIDs []string,
	removedIDs []string,
	syncErr error,
) {
	modified, _ := json.Marshal(fetchedIDs)
	removed, _ := json.Marshal(removedIDs)
	var startDateStr *string
	if startDate != nil {
		formatted := strconv.FormatInt(startDate.Unix(), 10)
		startDateStr = &formatted
	}
	var errStr *string
	if syncErr != nil {
		msg := syncErr.Error()
		errStr = &msg
	}
	if err := a.store.LogSimpleFinSyncBatch(ctx, dbgen.LogSimpleFinSyncBatchParams{
		AccessTokenID:  tokenID,
		StartDate:      startDateStr,
		Added:          "[]",
		Modified:       string(modified),
		PendingRemoved: string(removed),
		Error:          errStr,
	}); err != nil {
		a.log.Warn("log simplefin sync", "token_id", tokenID, "error", err)
	}
}

// simpleFinInitialLookbackDays is kept just under SimpleFIN's 90-day
// guaranteed lookback window so the request never lands on the boundary.
const simpleFinInitialLookbackDays = 89

func simpleFinStartDate(lastSyncedAt *time.Time, now time.Time) *time.Time {
	if lastSyncedAt == nil {
		start := now.AddDate(0, 0, -simpleFinInitialLookbackDays).UTC()
		return &start
	}
	start := lastSyncedAt.AddDate(0, 0, -14).UTC()
	return &start
}

func transactionFromSimpleFin(
	accountID string,
	txn clients.SimpleFinTransaction,
	hidden bool,
) (transactions.SyncedTransaction, error) {
	amount, err := money.ParseDecimal(strings.TrimSpace(txn.Amount))
	if err != nil {
		return transactions.SyncedTransaction{}, fmt.Errorf("parse simplefin amount %q: %w", txn.Amount, err)
	}
	transactedAt := time.Unix(txn.TransactedAt, 0).UTC()
	posted := txn.Posted
	if posted == 0 {
		posted = txn.TransactedAt
	}
	postedAt := time.Unix(posted, 0).UTC()
	merchant := strings.TrimSpace(txn.Payee)
	if merchant == "" {
		merchant = strings.TrimSpace(txn.Description)
	}
	original := strings.TrimSpace(txn.Description)
	raw, err := json.Marshal(txn)
	if err != nil {
		return transactions.SyncedTransaction{}, fmt.Errorf("marshal simplefin transaction %s: %w", txn.ID, err)
	}
	rawStr := string(raw)
	return transactions.SyncedTransaction{
		ExternalID:      txn.ID,
		AccountID:       accountID,
		Amount:          (-amount).Dollars(),
		Datetime:        transactedAt.UTC(),
		PostedDatetime:  postedAt.UTC(),
		MerchantName:    lo.EmptyableToPtr(merchant),
		OriginalName:    lo.EmptyableToPtr(original),
		RawProviderJSON: &rawStr,
		Source:          "simplefin",
		Pending:         txn.Pending || txn.Posted == 0,
		HiddenByAccount: hidden,
	}, nil
}
