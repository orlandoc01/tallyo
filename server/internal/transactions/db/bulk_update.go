package transactionsdb

import (
	"context"
	"database/sql"
	"fmt"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/graph/model"
)

func (s *Store) BulkUpdateTransactions(ctx context.Context, input model.BulkUpdateTransactionsInput) ([]*model.Transaction, error) {
	if input.Updates == nil {
		return nil, fmt.Errorf("updates is required")
	}
	ids, err := s.resolveBulkTargetIDs(ctx, input.TransactionIds, input.Filter)
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return []*model.Transaction{}, nil
	}

	params, changed := transactionUpdateParams(*input.Updates)
	if changed || input.Updates.TagIds != nil {
		err := s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
			if changed {
				params.Ids = ids
				if _, err := q.UpdateTransactionFieldsByIDs(ctx, params); err != nil {
					return err
				}
			}
			if input.Updates.TagIds == nil {
				return nil
			}
			return replaceTransactionTags(ctx, q, ids, model.LocalInt64IDsPtr(input.Updates.TagIds))
		})
		if err != nil {
			return nil, err
		}
	}

	return s.transactionsByID(ctx, ids)
}
