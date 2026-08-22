package transactionsdb

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/money"
	"tallyo/internal/transactions"
	u "tallyo/internal/utils"
)

type autoCategoryResult struct {
	CategoryID        *int64
	MerchantName      *string
	TagIDs            []int64
	ShouldHide        *bool
	ShouldBeRecurring *bool
	FromPFC2          bool
}

func autoCategorizationResult(ctx context.Context, q *dbgen.Queries, tx transactions.SyncedTransaction, accountID int64) (*autoCategoryResult, error) {
	originalName := ""
	if tx.OriginalName != nil {
		originalName = *tx.OriginalName
	}
	merchant := originalName
	if tx.MerchantName != nil {
		merchant = *tx.MerchantName
	}
	result := &autoCategoryResult{}
	amountCents := money.FromDollars(tx.Amount)
	rule, err := q.AutoRuleResult(ctx, dbgen.AutoRuleResultParams{Merchant: merchant, OriginalName: originalName, AmountCents: &amountCents, AccountID: accountID})
	if err == nil {
		result.CategoryID = rule.CategoryID
		result.MerchantName = rule.MerchantName
		parseTagID := func(value string) (int64, error) {
			return strconv.ParseInt(value, 10, 64)
		}
		tagIDs, err := u.MapErr(dbutil.SplitCSV(rule.TagIds), parseTagID)
		if err != nil {
			return nil, err
		}
		result.TagIDs = tagIDs
		result.ShouldHide = rule.ShouldHide
		result.ShouldBeRecurring = rule.ShouldBeRecurring
	} else if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if result.CategoryID != nil {
		return result, nil
	}

	detailed := PlaidDetailedCategory(tx.PlaidCategory)
	if detailed == "" {
		return result, nil
	}
	id, err := q.PlaidCategoryIDByDetailed(ctx, dbgen.PlaidCategoryIDByDetailedParams{PlaidDetailed: detailed})
	if errors.Is(err, sql.ErrNoRows) {
		return result, nil
	}
	if err != nil {
		return nil, err
	}
	result.CategoryID = &id
	result.FromPFC2 = true
	return result, nil
}

func PlaidDetailedCategory(category *string) string {
	if category == nil {
		return ""
	}
	_, detailed, found := strings.Cut(*category, ":")
	if !found {
		detailed = *category
	}
	return strings.ToUpper(strings.TrimSpace(detailed))
}
