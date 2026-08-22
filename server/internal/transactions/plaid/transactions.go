package txnplaid

import (
	"context"
	"fmt"
	"slices"

	"tallyo/internal/accounts"
	"tallyo/internal/graph/model"
	"tallyo/internal/transactions"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
	"github.com/samber/lo"
)

func (s *itemSync) syncPlainItem() transactions.ItemReport {
	a := s.adapter
	item := s.item
	events, result := s.sink.Open(s.ctx)
	s.streamAccountDrafts(events)
	nextCursor, err := s.streamTransactions(nil, events)
	close(events)
	persist := <-result
	if err != nil {
		a.recordItemSyncError(s.ctx, item.ID, err)
		return transactions.ItemReport{
			Counts: persist.Counts,
			Err:    fmt.Errorf("sync transactions %d: %w", item.ID, err),
		}
	}
	return s.finalizeCursorSync(persist, nextCursor)
}

func (s *itemSync) streamAccountDrafts(events chan<- transactions.PersistEvent) {
	for _, draft := range s.drafts {
		events <- transactions.PersistEvent{AccountUpsert: &draft}
	}
}

func (s *itemSync) streamTransactions(
	investmentAccountIDs []string,
	events chan<- transactions.PersistEvent,
) (string, error) {
	nextCursor, persistEvents, err := s.transactionEvents(investmentAccountIDs)
	if err != nil {
		return "", err
	}
	for _, event := range persistEvents {
		events <- event
	}
	return nextCursor, nil
}

func (s *itemSync) transactionEvents(
	investmentAccountIDs []string,
) (string, []transactions.PersistEvent, error) {
	a := s.adapter
	item := s.item
	cursor, err := a.plaid.SyncCursor(s.ctx, item.ID)
	if err != nil {
		return "", nil, err
	}
	hiddenAccounts, err := s.hiddenAccounts()
	if err != nil {
		return "", nil, err
	}
	batch, err := a.fetchTransactionSyncBatch(s.ctx, s.client, item, cursor)
	if err != nil {
		return "", nil, err
	}
	investmentAccountIDSet := accountIDSet(investmentAccountIDs)
	batch.added = filterOutInvestmentAccounts(batch.added, investmentAccountIDSet)
	batch.modified = filterOutInvestmentAccounts(batch.modified, investmentAccountIDSet)
	if err := a.logSyncBatch(s.ctx, item.ID, batch); err != nil {
		a.Log.Error("failed to write sync log", "item_id", item.ID, "error", err)
	}
	persistEvents := make([]transactions.PersistEvent, 0, len(batch.removed)+len(batch.added)+len(batch.modified))
	for _, removed := range batch.removed {
		persistEvents = append(persistEvents, transactions.PersistEvent{
			Removal: &transactions.RemovedTransaction{ID: removed.GetTransactionId(), Source: transactions.TransactionSourcePlaid},
		})
	}
	for _, tx := range append(batch.added, batch.modified...) {
		event, err := transactionDraftEvent(s.ctx, tx, hiddenAccounts)
		if err != nil {
			return "", nil, err
		}
		persistEvents = append(persistEvents, event)
	}
	return batch.nextCursor, persistEvents, nil
}

func transactionDraftEvent(
	ctx context.Context,
	tx plaidapi.Transaction,
	hiddenAccounts map[string]bool,
) (transactions.PersistEvent, error) {
	synced, err := convertTransaction(ctx, tx)
	if err != nil {
		return transactions.PersistEvent{}, err
	}
	synced.HiddenByAccount = hiddenAccounts[synced.AccountID]
	return transactions.PersistEvent{Upsert: &synced}, nil
}

func investmentAccountIDsForSync(item accounts.PlaidItemSecret, drafts []transactions.AccountDraft) []string {
	if !item.InvestmentsEnabled {
		return []string{}
	}
	toInvestmentAccountID := func(draft transactions.AccountDraft, _ int) (string, bool) {
		return draft.ID, draft.Type == model.AccountTypeInvestment
	}
	return lo.FilterMap(drafts, toInvestmentAccountID)
}

func hasTransactionSyncableAccount(drafts []transactions.AccountDraft) bool {
	isSyncable := func(draft transactions.AccountDraft) bool {
		return draft.Type == model.AccountTypeDepository || draft.Type == model.AccountTypeCredit
	}
	return slices.ContainsFunc(drafts, isSyncable)
}

func accountIDSet(accountIDs []string) map[string]struct{} {
	return lo.Keyify(accountIDs)
}
