package transactionsdb

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"tallyo/internal/apierror"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/transactions"

	"github.com/samber/lo"
)

func (s *Store) Transaction(ctx context.Context, id int64) (*model.Transaction, error) {
	values, err := s.transactionFilterValues(nil, []int64{id})
	if err != nil {
		return nil, err
	}
	params := values.recordsParams()
	params.RowLimit = 1
	// TransactionRecords' ORDER BY is entirely optional, but its LIMIT clause
	// is not: leaving every order toggle false collapses to "ORDER BY\nLIMIT
	// ...", which SQLite rejects. A single row doesn't need real ordering, so
	// any stable toggle works.
	newTransactionSortToggles(nil, false).apply(&params)
	rows, err := s.q.TransactionRecords(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("query transactions: %w", err)
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return transactionFromRow(rows[0]), nil
}

func (s *Store) Transactions(ctx context.Context, query transactions.TransactionQuery) (*model.TransactionConnection, error) {
	limit := transactions.TransactionLimit(query)
	reverse := query.Last != nil && *query.Last > 0
	values, err := s.transactionFilterValues(query.Filter, nil)
	if err != nil {
		return nil, err
	}
	var cursor *transactions.Cursor
	cursorAfter := true
	if query.After != nil || query.Before != nil {
		cursorValue := query.After
		if cursorValue == nil {
			cursorValue = query.Before
			cursorAfter = false
		}
		decoded, err := DecodeCursor(*cursorValue)
		if err != nil {
			return nil, err
		}
		cursor = &decoded
	}
	count, err := s.q.CountTransactionRecords(ctx, values.countParams())
	if err != nil {
		return nil, fmt.Errorf("count transactions: %w", err)
	}
	params := values.recordsParams()
	params.RowLimit = int64(limit + 1)
	newTransactionSortToggles(query.Sort, reverse).apply(&params)
	cursorFields, err := newTransactionCursorFields(cursor, cursorAfter, query.Sort)
	if err != nil {
		return nil, err
	}
	cursorFields.apply(&params)
	rows, err := s.q.TransactionRecords(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("query transactions: %w", err)
	}
	txns := transactionRowsToModels(rows)
	hasMore := int32(len(txns)) > limit
	if hasMore {
		txns = txns[:limit]
	}
	if query.Last != nil {
		slices.Reverse(txns)
	}
	return transactionConnection(txns, int32(count), hasMore, query), nil
}

func (s *Store) TransactionsSummary(ctx context.Context, filter *model.TransactionsFilter) (*model.TransactionsSummary, error) {
	values, err := s.transactionFilterValues(filter, nil)
	if err != nil {
		return nil, err
	}
	summary, err := s.q.TransactionRecordsSummary(ctx, values.summaryParams())
	if err != nil {
		return nil, fmt.Errorf("summarize transactions: %w", err)
	}
	if summary.TotalCount == 0 {
		return &model.TransactionsSummary{}, nil
	}
	first := model.Date(summary.FirstDate)
	last := model.Date(summary.LastDate)
	return &model.TransactionsSummary{
		TotalCount:    int32(summary.TotalCount),
		TotalAmount:   money.Cents(summary.TotalAmountCents),
		AverageAmount: money.FromDollars(lo.FromPtr(summary.AverageAmount) / 100),
		LargestAmount: money.Cents(summary.LargestAmountCents),
		FirstDate:     &first,
		LastDate:      &last,
	}, nil
}

func (s *Store) UpdateTransaction(ctx context.Context, id int64, input model.TransactionUpdates) (*model.Transaction, error) {
	params, changed := transactionUpdateParams(input)
	if !changed && input.TagIds == nil {
		return s.Transaction(ctx, id)
	}
	ids := []int64{id}
	err := s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		params.Ids = ids
		rows, err := q.UpdateTransactionFieldsByIDs(ctx, params)
		if err != nil {
			return err
		}
		if rows == 0 {
			return sql.ErrNoRows
		}
		if input.TagIds == nil {
			return nil
		}
		return replaceTransactionTags(ctx, q, ids, model.LocalInt64IDsPtr(input.TagIds))
	})
	if err != nil {
		return nil, err
	}
	return s.Transaction(ctx, id)
}

func replaceTransactionTags(ctx context.Context, q *dbgen.Queries, transactionIDs []int64, tagIDs []int64) error {
	if err := q.DeleteTransactionTagsByTransactionIDs(ctx, dbgen.DeleteTransactionTagsByTransactionIDsParams{
		TransactionIds: transactionIDs,
	}); err != nil {
		return err
	}
	if len(tagIDs) == 0 {
		return nil
	}
	return q.AddTransactionTagsByTransactionIDs(ctx, dbgen.AddTransactionTagsByTransactionIDsParams{
		TransactionIds: transactionIDs,
		TagIds:         tagIDs,
	})
}

func (s *Store) CreateTransaction(ctx context.Context, input model.CreateTransactionInput) (*model.Transaction, error) {
	merchantName := trimmed(input.MerchantName)
	originalName := trimmed(input.OriginalName)
	if merchantName == "" && originalName == "" {
		return nil, apierror.Publicf("merchantName or originalName is required")
	}

	accountID := input.AccountID.Int64()
	accountRow, err := dbutil.FirstRow(s.q.AccountRecords(ctx, dbgen.AccountRecordsParams{ID: &accountID}))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, apierror.Publicf("account %d not found", accountID)
		}
		return nil, err
	}
	categoryID := UncategorizedCategoryID
	if input.CategoryID != nil {
		categoryID = input.CategoryID.Int64()
		if _, err := s.q.CategoryInfo(ctx, dbgen.CategoryInfoParams{ID: categoryID}); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, apierror.Publicf("category %d not found", categoryID)
			}
			return nil, err
		}
	}

	isHidden := accountRow.Account.IsHidden
	if input.IsHidden != nil {
		isHidden = *input.IsHidden
	}
	isRecurring := input.IsRecurring != nil && *input.IsRecurring
	date, err := time.Parse(time.DateOnly, string(input.Date))
	if err != nil {
		return nil, fmt.Errorf("parse transaction date %q: %w", input.Date, err)
	}
	datetime := time.Date(date.Year(), date.Month(), date.Day(), 12, 0, 0, 0, time.UTC)
	merchantNamePtr := lo.EmptyableToPtr(merchantName)
	originalNamePtr := lo.EmptyableToPtr(originalName)
	notesPtr := lo.EmptyableToPtr(trimmed(input.Notes))

	for range 3 {
		id, err := manualTransactionID()
		if err != nil {
			return nil, err
		}
		transactionID, err := s.q.InsertTransaction(ctx, dbgen.InsertTransactionParams{
			Source:         transactions.TransactionSourceManual,
			ExternalID:     id,
			AccountID:      accountID,
			AmountCents:    input.Amount,
			Datetime:       datetime,
			PostedDatetime: datetime,
			MerchantName:   merchantNamePtr,
			OriginalName:   originalNamePtr,
			CategoryID:     categoryID,
			IsReviewed:     input.CategoryID != nil,
			IsRecurring:    isRecurring,
			IsHidden:       isHidden,
			Notes:          notesPtr,
		})
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		return s.Transaction(ctx, transactionID)
	}
	return nil, fmt.Errorf("generate unique manual transaction id")
}

func (s *Store) transactionsByID(ctx context.Context, ids []int64) ([]*model.Transaction, error) {
	values, err := s.transactionFilterValues(nil, ids)
	if err != nil {
		return nil, err
	}
	params := values.recordsParams()
	params.RowLimit = -1
	newTransactionSortToggles(nil, false).apply(&params)
	rows, err := s.q.TransactionRecords(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("query transactions: %w", err)
	}
	return transactionRowsToModels(rows), nil
}

func transactionUpdateParams(input model.TransactionUpdates) (dbgen.UpdateTransactionFieldsByIDsParams, bool) {
	params := dbgen.UpdateTransactionFieldsByIDsParams{}
	var changed bool
	if input.MerchantName != nil {
		params.SetMerchantName = true
		params.MerchantName = lo.EmptyableToPtr(trimmed(input.MerchantName))
		changed = true
	}
	if input.Notes != nil {
		params.SetNotes = true
		notes := strings.TrimSpace(*input.Notes)
		if notes == "" {
			params.Notes = nil
		} else {
			params.Notes = &notes
		}
		changed = true
	}
	if input.IsRecurring != nil {
		params.SetRecurring = true
		params.IsRecurring = *input.IsRecurring
		changed = true
	}
	if input.IsHidden != nil {
		params.SetHidden = true
		params.IsHidden = *input.IsHidden
		changed = true
	}
	if input.CategoryID != nil {
		params.SetCategory = true
		params.CategoryID = input.CategoryID.Int64()
		changed = true
	}
	return params, changed
}

func manualTransactionID() (string, error) {
	var b [6]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("generate manual transaction id: %w", err)
	}
	return "manual-" + hex.EncodeToString(b[:]), nil
}

func trimmed(value *string) string {
	return strings.TrimSpace(lo.FromPtr(value))
}
