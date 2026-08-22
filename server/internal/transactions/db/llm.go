package transactionsdb

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/samber/lo"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/money"
	"tallyo/internal/transactions/categorizer"
	u "tallyo/internal/utils"
)

// CategoriesForLLM loads the lightweight category references needed by the LLM
// prompt. Excludes transfer and income categories.
func (s *Store) CategoriesForLLM(ctx context.Context) ([]categorizer.CategoryRef, error) {
	rows, err := s.q.CategoriesForLLM(ctx)
	fromRow := func(row dbgen.CategoriesForLLMRow) categorizer.CategoryRef {
		return categorizer.CategoryRef{ID: row.ID, Name: row.Name, GroupName: row.GroupName}
	}
	return dbutil.MapRows(rows, err, fromRow)
}

// UncategorizedForLLM fetches transactions that are staged for LLM
// categorization. Returns up to `limit` transactions ordered by date desc.
func (s *Store) UncategorizedForLLM(ctx context.Context, limit int) ([]categorizer.TransactionInput, error) {
	rows, err := s.q.UncategorizedForLLM(ctx, dbgen.UncategorizedForLLMParams{RowLimit: int64(limit)})
	fromRow := func(row dbgen.UncategorizedForLLMRow) categorizer.TransactionInput {
		return categorizer.TransactionInput{ID: strconv.FormatInt(row.ID, 10), MerchantName: lo.FromPtr(row.MerchantName), OriginalName: lo.FromPtr(row.OriginalName), Amount: row.AmountCents.Dollars(), PlaidCategory: lo.FromPtr(row.PlaidCategory), HasPFC2Match: row.Pfc2Categorized}
	}
	return dbutil.MapRows(rows, err, fromRow)
}

func (s *Store) CountStagedForLLM(ctx context.Context) (int64, error) {
	return s.q.CountStagedForLLM(ctx)
}

// StageUncategorizedForLLM stages every unreviewed transaction for LLM categorization.
func (s *Store) StageUncategorizedForLLM(ctx context.Context) (int64, error) {
	return s.q.StageUncategorizedForLLM(ctx)
}

// TopMerchantExamples returns the top `limit` merchant->category pairings by
// frequency from reviewed transactions older than 7 days. These are used as
// global few-shot examples in the LLM prompt.
func (s *Store) TopMerchantExamples(ctx context.Context, limit int) ([]categorizer.ExampleTransaction, error) {
	rows, err := s.q.TopMerchantExamples(ctx, dbgen.TopMerchantExamplesParams{RowLimit: int64(limit)})
	fromRow := func(row dbgen.TopMerchantExamplesRow) categorizer.ExampleTransaction {
		return categorizer.ExampleTransaction{MerchantName: row.MerchantName, CategoryName: row.CategoryName, CategoryID: row.CategoryID}
	}
	return dbutil.MapRows(rows, err, fromRow)
}

// SimilarCategorizedByMerchants returns per-merchant examples in one query:
// the most recent reviewed expense transactions older than 7 days, capped at
// `limit` examples per merchant.
func (s *Store) SimilarCategorizedByMerchants(ctx context.Context, merchantNames []string, limit int) (map[string][]categorizer.ExampleTransaction, error) {
	if len(merchantNames) == 0 {
		return map[string][]categorizer.ExampleTransaction{}, nil
	}
	merchantKeys := lo.Uniq(u.Map(merchantNames, strings.ToLower))
	merchantKeysJSON, _ := json.Marshal(merchantKeys)
	rows, err := s.similarCategorizedByMerchants(ctx, string(merchantKeysJSON), int64(limit))
	toMerchantExample := func(row similarCategorizedByMerchantsRow) (string, categorizer.ExampleTransaction) {
		return row.MerchantKey, categorizer.ExampleTransaction{
			MerchantName: row.MerchantName,
			Amount:       row.AmountCents.Dollars(),
			CategoryName: row.CategoryName,
			CategoryID:   row.CategoryID,
		}
	}
	return dbutil.GroupRows(rows, err, toMerchantExample)
}

const similarCategorizedByMerchantsSQL = `
SELECT
  merchant_key,
  merchant_name,
  amount_cents,
  category_id,
  category_name
FROM (
  SELECT
    CAST(LOWER(t.merchant_name) AS TEXT) AS merchant_key,
    t.merchant_name,
    t.amount_cents,
    cr.cat_id AS category_id,
    cr.cat_name AS category_name,
    t.datetime,
    t.id,
    CAST(ROW_NUMBER() OVER (
      PARTITION BY LOWER(t.merchant_name)
      ORDER BY t.datetime DESC, t.id DESC
    ) AS INTEGER) AS merchant_rank
  FROM transactions t
  JOIN category_rows cr ON cr.cat_id = t.category_id
  WHERE t.merchant_name IS NOT NULL
    AND t.is_reviewed = 1
    AND LOWER(t.merchant_name) IN (SELECT value FROM json_each(CAST(? AS TEXT)))
    AND cr.group_kind = 'EXPENSE'
    AND t.datetime < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-7 days')
) ranked
WHERE merchant_rank <= ?
ORDER BY datetime DESC, id DESC`

type similarCategorizedByMerchantsRow struct {
	MerchantKey  string
	MerchantName string
	AmountCents  money.Cents
	CategoryID   int64
	CategoryName string
}

func (s *Store) similarCategorizedByMerchants(
	ctx context.Context,
	merchantKeysJSON string,
	perMerchantLimit int64,
) ([]similarCategorizedByMerchantsRow, error) {
	rows, err := s.SQL().QueryContext(ctx, similarCategorizedByMerchantsSQL, merchantKeysJSON, perMerchantLimit)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	items := []similarCategorizedByMerchantsRow{}
	for rows.Next() {
		var item similarCategorizedByMerchantsRow
		if err := rows.Scan(
			&item.MerchantKey,
			&item.MerchantName,
			&item.AmountCents,
			&item.CategoryID,
			&item.CategoryName,
		); err != nil {
			return nil, fmt.Errorf("scan similar categorized merchant: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

// ApplyLLMCategory sets the category on a transaction and marks it as reviewed
// and no longer staged for LLM. Only updates if the transaction still has the
// uncategorized sentinel (avoids racing with manual edits).
func (s *Store) ApplyLLMCategory(ctx context.Context, transactionID string, categoryID int64) error {
	id, err := strconv.ParseInt(transactionID, 10, 64)
	if err != nil {
		return err
	}
	return s.q.ApplyLLMCategory(ctx, dbgen.ApplyLLMCategoryParams{CategoryID: categoryID, ID: id, UncategorizedCategoryID: UncategorizedCategoryID})
}

// ClearStagedForLLM resets the staged_for_llm flag on all staged transactions.
// Used for crash recovery and after LLM processing to surface any transactions
// the LLM could not categorize.
func (s *Store) ClearStagedForLLM(ctx context.Context) error {
	return s.q.ClearStagedForLLM(ctx, dbgen.ClearStagedForLLMParams{})
}

// ClearStagedForLLMByIDs resets the staged_for_llm flag for the given
// transactions only, so the worker can un-stage a processed batch without
// disturbing rows it has not yet fetched.
func (s *Store) ClearStagedForLLMByIDs(ctx context.Context, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	parseID := func(id string) (int64, error) { return strconv.ParseInt(id, 10, 64) }
	parsedIDs, err := u.MapErr(ids, parseID)
	if err != nil {
		return err
	}
	return s.q.ClearStagedForLLM(ctx, dbgen.ClearStagedForLLMParams{Ids: parsedIDs})
}
