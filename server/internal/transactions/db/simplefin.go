package transactionsdb

import (
	"context"

	"tallyo/internal/database/dbgen"
)

// LogSimpleFinSyncBatch and PendingSimpleFinTransactionIDs are the only
// SimpleFIN operations transactions/db owns. Token and connection lifecycle
// live in accounts/db (see accounts.SimpleFinStore).

func (s *Store) LogSimpleFinSyncBatch(ctx context.Context, params dbgen.LogSimpleFinSyncBatchParams) error {
	return s.q.LogSimpleFinSyncBatch(ctx, params)
}

func (s *Store) PendingSimpleFinTransactionIDs(ctx context.Context, tokenID int64) ([]string, error) {
	return s.q.PendingSimpleFinTransactionIDs(ctx, dbgen.PendingSimpleFinTransactionIDsParams{AccessTokenID: tokenID})
}
