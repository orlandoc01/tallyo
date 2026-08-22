package txnplaid

import (
	"context"
	"encoding/json"
	"fmt"

	"tallyo/internal/accounts"
	"tallyo/internal/clients"
	"tallyo/internal/transactions"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
	"github.com/samber/lo"
)

const maxSyncPaginationRestarts = 3

type transactionSyncBatch struct {
	added      []plaidapi.Transaction
	modified   []plaidapi.Transaction
	removed    []plaidapi.RemovedTransaction
	nextCursor string
}

func (a *Adapter) fetchTransactionSyncBatch(
	ctx context.Context,
	client clients.PlaidClient,
	item accounts.PlaidItemSecret,
	initialCursor string,
) (transactionSyncBatch, error) {
	for restarts := 0; ; restarts++ {
		batch, err := fetchTransactionSyncPages(ctx, client, item.AccessToken, initialCursor)
		if err == nil {
			return batch, nil
		}
		if !isTransactionsSyncMutationDuringPagination(err) {
			return transactionSyncBatch{}, err
		}
		a.Log.Warn("plaid transactions sync pagination mutated; restarting", "item_id", item.ID, "restart", restarts+1)
		if restarts+1 >= maxSyncPaginationRestarts {
			return transactionSyncBatch{}, fmt.Errorf(
				"transactions sync pagination mutated after %d restarts: %w",
				maxSyncPaginationRestarts,
				err,
			)
		}
	}
}

func filterOutInvestmentAccounts(
	txns []plaidapi.Transaction,
	investmentAccountIDs map[string]struct{},
) []plaidapi.Transaction {
	if len(investmentAccountIDs) == 0 {
		return txns
	}
	isTransactionAccount := func(tx plaidapi.Transaction, _ int) bool {
		_, investmentAccount := investmentAccountIDs[tx.GetAccountId()]
		return !investmentAccount
	}
	return lo.Filter(txns, isTransactionAccount)
}

func fetchTransactionSyncPages(
	ctx context.Context,
	client clients.PlaidClient,
	accessToken, initialCursor string,
) (transactionSyncBatch, error) {
	cursor := initialCursor
	batch := transactionSyncBatch{}
	for {
		resp, err := client.Sync(ctx, accessToken, cursor)
		if err != nil {
			return transactionSyncBatch{}, err
		}
		batch.added = append(batch.added, resp.GetAdded()...)
		batch.modified = append(batch.modified, resp.GetModified()...)
		batch.removed = append(batch.removed, resp.GetRemoved()...)
		cursor = resp.GetNextCursor()
		if !resp.GetHasMore() {
			break
		}
	}
	batch.nextCursor = cursor
	return batch, nil
}

func (a *Adapter) logSyncBatch(ctx context.Context, itemID int64, batch transactionSyncBatch) error {
	added, err := marshalJSONArray(batch.added)
	if err != nil {
		return fmt.Errorf("marshal added: %w", err)
	}
	modified, err := marshalJSONArray(batch.modified)
	if err != nil {
		return fmt.Errorf("marshal modified: %w", err)
	}
	removed, err := marshalJSONArray(batch.removed)
	if err != nil {
		return fmt.Errorf("marshal removed: %w", err)
	}
	return a.plaid.LogSyncBatch(ctx, transactions.SyncBatchLog{
		ItemID:   itemID,
		API:      transactions.SyncBatchAPITransactions,
		Added:    added,
		Modified: modified,
		Removed:  removed,
	})
}

func (a *Adapter) logInvestmentSyncBatch(
	ctx context.Context,
	itemID int64,
	investmentTransactions []plaidapi.InvestmentTransaction,
) error {
	added, err := marshalJSONArray(investmentTransactions)
	if err != nil {
		return fmt.Errorf("marshal added: %w", err)
	}
	return a.plaid.LogSyncBatch(ctx, transactions.SyncBatchLog{
		ItemID:   itemID,
		API:      transactions.SyncBatchAPIInvestments,
		Added:    added,
		Modified: "[]",
		Removed:  "[]",
	})
}

func marshalJSONArray[T any](items []T) (string, error) {
	if len(items) == 0 {
		return "[]", nil
	}
	b, err := json.Marshal(items)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func isTransactionsSyncMutationDuringPagination(err error) bool {
	plaidErr, parseErr := plaidapi.ToPlaidError(err)
	return parseErr == nil && plaidErr.GetErrorCode() == "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"
}
