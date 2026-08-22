package transactionsdb

import (
	"context"
	"fmt"

	"tallyo/internal/apierror"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
)

func (s *Store) DeleteTransaction(ctx context.Context, id int64) (bool, error) {
	rows, err := s.q.DeleteTransactionsByIDs(ctx, dbgen.DeleteTransactionsByIDsParams{Ids: []int64{id}})
	return dbutil.RowsAffected(rows, err)
}

func (s *Store) DeleteSyncedTransaction(ctx context.Context, source, externalID string) (bool, error) {
	rows, err := s.q.DeleteSyncedTransaction(ctx, dbgen.DeleteSyncedTransactionParams{Source: source, ExternalID: externalID})
	return dbutil.RowsAffected(rows, err)
}

func (s *Store) BulkDeleteTransactions(ctx context.Context, input model.BulkDeleteTransactionsInput) (int32, error) {
	ids, err := s.resolveBulkTargetIDs(ctx, input.TransactionIds, input.Filter)
	if err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		return 0, nil
	}
	rows, err := s.q.DeleteTransactionsByIDs(ctx, dbgen.DeleteTransactionsByIDsParams{Ids: ids})
	if err != nil {
		return 0, err
	}
	return int32(rows), nil
}

func (s *Store) resolveBulkTargetIDs(ctx context.Context, idsPtr []*model.GlobalID, filter *model.TransactionsFilter) ([]int64, error) {
	ids, err := model.LocalInt64IDsOfTypePtr(idsPtr, model.GlobalIDTransaction)
	if err != nil {
		return nil, err
	}
	hasIDs := len(ids) > 0
	values := normalizeTransactionFilterValues(filter, nil)
	hasFilter := values.hasCriteria()
	if hasIDs == hasFilter {
		return nil, apierror.Publicf("exactly one of transactionIds or filter is required")
	}
	if hasFilter {
		if err := model.ValidateTransactionsFilterIDTypes(filter); err != nil {
			return nil, err
		}
	} else {
		values.ids = ids
	}
	rows, err := s.q.TransactionIDsByFilter(ctx, values.idsParams())
	if err != nil {
		return nil, fmt.Errorf("select transaction ids: %w", err)
	}
	return rows, nil
}
