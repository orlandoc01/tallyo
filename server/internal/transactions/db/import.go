package transactionsdb

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"maps"
	"strings"
	"time"

	"github.com/samber/lo"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
	"tallyo/internal/transactions"
	u "tallyo/internal/utils"
)

// ImportTransactions upserts rows from a CSV import. Rows with an unknown
// account_id are skipped without aborting the rest.
func (s *Store) ImportTransactions(ctx context.Context, rows []transactions.ImportRow) (transactions.ImportResult, error) {
	result := transactions.ImportResult{Errors: []transactions.ImportRowError{}}

	accountIDsByInputID, err := s.resolveImportAccounts(ctx, rows)
	if err != nil {
		return result, fmt.Errorf("resolve accounts: %w", err)
	}
	categoryMap, err := s.categoryNameMap(ctx)
	if err != nil {
		return result, fmt.Errorf("load categories: %w", err)
	}

	if err := s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		for i, row := range rows {
			rowLabel := row.RowNum
			if rowLabel == 0 {
				rowLabel = i + 1
			}

			accountID, ok := accountIDsByInputID[row.AccountID]
			if !ok {
				result.Skipped++
				result.Errors = append(result.Errors, transactions.ImportRowError{
					Row:     rowLabel,
					Message: fmt.Sprintf("account_id %q not found", row.AccountID),
				})
				continue
			}

			id, err := importExternalID(row)
			if err != nil {
				return fmt.Errorf("generate id row %d: %w", rowLabel, err)
			}

			categorization, err := s.resolveImportCategorization(ctx, q, row, accountID, categoryMap)
			if err != nil {
				return fmt.Errorf("categorize row %d: %w", rowLabel, err)
			}

			isHidden := row.IsHidden
			if categorization.shouldHide != nil {
				isHidden = isHidden || *categorization.shouldHide
			}
			isRecurring := row.IsRecurring
			if categorization.shouldBeRecurring != nil {
				isRecurring = *categorization.shouldBeRecurring
			}
			merchantName := lo.EmptyableToPtr(row.MerchantName)
			originalName := lo.EmptyableToPtr(row.OriginalName)
			notes := lo.EmptyableToPtr(row.Notes)

			transactionID, err := q.InsertTransaction(ctx, dbgen.InsertTransactionParams{
				Source:         importSource(row),
				ExternalID:     id,
				AccountID:      accountID,
				AmountCents:    row.Amount,
				Datetime:       row.Datetime,
				PostedDatetime: row.PostedDatetime,
				MerchantName:   merchantName,
				OriginalName:   originalName,
				CategoryID:     int64(categorization.categoryID),
				IsReviewed:     categorization.isReviewed,
				IsRecurring:    isRecurring,
				IsHidden:       isHidden,
				Notes:          notes,
			})
			if errors.Is(err, sql.ErrNoRows) {
				transactionID, err = q.UpdateTransactionBySourceExternalID(ctx, dbgen.UpdateTransactionBySourceExternalIDParams{
					Source:         importSource(row),
					ExternalID:     id,
					AccountID:      accountID,
					AmountCents:    row.Amount,
					Datetime:       row.Datetime,
					PostedDatetime: row.PostedDatetime,
					MerchantName:   merchantName,
					OriginalName:   originalName,
					CategoryID:     int64(categorization.categoryID),
					IsReviewed:     categorization.isReviewed,
					IsRecurring:    isRecurring,
					IsHidden:       isHidden,
					Notes:          notes,
				})
			}
			if err != nil {
				return fmt.Errorf("import row %d: %w", rowLabel, err)
			}
			if len(categorization.tagIDs) > 0 {
				if err := q.AddTransactionTagsByTransactionIDs(ctx, dbgen.AddTransactionTagsByTransactionIDsParams{TransactionIds: []int64{transactionID}, TagIds: categorization.tagIDs}); err != nil {
					return fmt.Errorf("tag row %d: %w", rowLabel, err)
				}
			}
			result.Processed++
		}
		return nil
	}); err != nil {
		return result, err
	}
	return result, nil
}

func importExternalID(row transactions.ImportRow) (string, error) {
	if row.ExternalID != "" {
		return row.ExternalID, nil
	}
	return importRandomID()
}

func importSource(row transactions.ImportRow) string {
	source := strings.TrimSpace(row.Source)
	return lo.Ternary(source != "", source, transactions.TransactionSourceManual)
}

// ExportTransactionPage returns one page of transactions matching the filter,
// ordered by date desc then id desc, plus the cursor for the next page (nil
// on the last page). Keeping each query bounded by limit avoids holding an
// open result set for the whole export while a client streams it slowly.
func (s *Store) ExportTransactionPage(ctx context.Context, filter *model.TransactionsFilter, cursor *transactions.Cursor, limit int) ([]transactions.ExportTransaction, *transactions.Cursor, error) {
	values, err := s.transactionFilterValues(filter, nil)
	if err != nil {
		return nil, nil, err
	}
	params := values.recordsParams()
	// Fetch one extra row to distinguish "exactly limit rows left" from
	// "more pages follow" without a separate count query.
	params.RowLimit = int64(limit + 1)
	newTransactionSortToggles(nil, false).apply(&params)
	cursorFields, err := newTransactionCursorFields(cursor, cursor != nil, nil)
	if err != nil {
		return nil, nil, err
	}
	cursorFields.apply(&params)
	rows, err := s.q.TransactionRecords(ctx, params)
	if err != nil {
		return nil, nil, fmt.Errorf("query transactions: %w", err)
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	toExport := func(row dbgen.TransactionRecordsRow) transactions.ExportTransaction {
		return transactions.ExportTransaction{ExternalID: row.ExternalID, Source: row.Source, Transaction: transactionFromRow(row)}
	}
	page := u.Map(rows, toExport)
	var next *transactions.Cursor
	if hasMore {
		last := rows[len(rows)-1]
		next = &transactions.Cursor{Datetime: last.Datetime.UTC().Format(time.RFC3339), ID: last.ID}
	}
	return page, next, nil
}

func importRandomID() (string, error) {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "import-" + hex.EncodeToString(b), nil
}

type importCategorizationResult struct {
	categoryID        int64
	isReviewed        bool
	tagIDs            []int64
	shouldHide        *bool
	shouldBeRecurring *bool
}

func (s *Store) resolveImportCategorization(ctx context.Context, q *dbgen.Queries, row transactions.ImportRow, accountID int64, categoryMap map[string]int64) (importCategorizationResult, error) {
	if row.Category != "" {
		if id, ok := categoryMap[strings.ToLower(row.Category)]; ok {
			return importCategorizationResult{categoryID: id, isReviewed: true}, nil
		}
	}
	matched, err := autoCategorizationResult(ctx, q, transactions.SyncedTransaction{
		AccountID:      row.AccountID,
		Amount:         row.Amount.Dollars(),
		Datetime:       row.Datetime,
		PostedDatetime: row.PostedDatetime,
		MerchantName:   lo.EmptyableToPtr(row.MerchantName),
		OriginalName:   lo.EmptyableToPtr(row.OriginalName),
	}, accountID)
	if err != nil {
		return importCategorizationResult{categoryID: UncategorizedCategoryID}, err
	}
	if matched != nil && matched.CategoryID != nil {
		return importCategorizationResult{categoryID: *matched.CategoryID, isReviewed: true, tagIDs: matched.TagIDs, shouldHide: matched.ShouldHide, shouldBeRecurring: matched.ShouldBeRecurring}, nil
	}
	if matched != nil {
		return importCategorizationResult{categoryID: UncategorizedCategoryID, tagIDs: matched.TagIDs, shouldHide: matched.ShouldHide, shouldBeRecurring: matched.ShouldBeRecurring}, nil
	}
	return importCategorizationResult{categoryID: UncategorizedCategoryID}, nil
}

func (s *Store) resolveImportAccounts(ctx context.Context, rows []transactions.ImportRow) (map[string]int64, error) {
	toSeenAccountID := func(row transactions.ImportRow) (string, struct{}, bool) {
		if row.AccountID != "" {
			return row.AccountID, struct{}{}, true
		}
		return "", struct{}{}, false
	}
	seen := lo.FilterSliceToMap(rows, toSeenAccountID)
	if len(seen) == 0 {
		return map[string]int64{}, nil
	}
	ids := lo.Keys(seen)
	globalIDsByInputID := make(map[string]int64, len(ids))
	externalIDs := make([]string, 0, len(ids))
	for _, id := range ids {
		globalID, err := model.DecodeGlobalID(id)
		if err != nil {
			externalIDs = append(externalIDs, id)
			continue
		}
		accountID, err := globalID.Int64OfType(model.GlobalIDAccount)
		if err != nil {
			return nil, err
		}
		globalIDsByInputID[id] = accountID
	}

	accountIDsByInputID, err := s.resolveImportGlobalAccountIDs(ctx, globalIDsByInputID)
	if err != nil {
		return nil, err
	}
	if len(externalIDs) == 0 {
		return accountIDsByInputID, nil
	}

	dbRows, err := s.q.AccountRecords(ctx, dbgen.AccountRecordsParams{ExternalIds: externalIDs})
	if err != nil {
		return nil, err
	}
	toFoundAccountID := func(row dbgen.AccountRecordsRow) (string, int64) {
		return row.Account.ExternalID, row.Account.ID
	}
	maps.Copy(accountIDsByInputID, lo.SliceToMap(dbRows, toFoundAccountID))
	return accountIDsByInputID, nil
}

func (s *Store) resolveImportGlobalAccountIDs(ctx context.Context, globalIDsByInputID map[string]int64) (map[string]int64, error) {
	accountIDsByInputID := make(map[string]int64, len(globalIDsByInputID))
	if len(globalIDsByInputID) == 0 {
		return accountIDsByInputID, nil
	}
	foundIDs, err := s.q.AccountRecords(ctx, dbgen.AccountRecordsParams{Ids: lo.Values(globalIDsByInputID)})
	if err != nil {
		return nil, err
	}
	foundIDSet := lo.SliceToMap(foundIDs, func(row dbgen.AccountRecordsRow) (int64, struct{}) { return row.Account.ID, struct{}{} })
	for inputID, accountID := range globalIDsByInputID {
		if _, ok := foundIDSet[accountID]; ok {
			accountIDsByInputID[inputID] = accountID
		}
	}
	return accountIDsByInputID, nil
}

func (s *Store) categoryNameMap(ctx context.Context) (map[string]int64, error) {
	cats, err := s.Categories(ctx)
	toCategoryIDByName := func(c *model.Category) (string, int64) {
		return strings.ToLower(c.Name), c.ID.Int64()
	}
	return dbutil.AssociateRows(cats, err, toCategoryIDByName)
}
