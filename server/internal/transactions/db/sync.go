package transactionsdb

import (
	"context"
	"database/sql"
	"errors"

	"github.com/samber/lo"
	accountsdb "tallyo/internal/accounts/db"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/money"
	"tallyo/internal/transactions"
)

func (s *Store) UpsertSyncedTransaction(ctx context.Context, tx transactions.SyncedTransaction) (bool, error) {
	var newRecord bool
	err := s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		row, err := accountsdb.AccountByExternalID(ctx, q, tx.AccountID)
		if err != nil {
			return err
		}
		accountID := row.Account.ID
		categoryResult, err := syncedTransactionCategory(ctx, q, tx, accountID)
		if err != nil {
			return err
		}
		newRecord = categoryResult.newRecord
		source := lo.CoalesceOrEmpty(tx.Source, "plaid")
		isHidden := tx.HiddenByAccount
		if categoryResult.shouldHide != nil {
			isHidden = isHidden || *categoryResult.shouldHide
		}
		isRecurring := false
		if categoryResult.shouldBeRecurring != nil {
			isRecurring = *categoryResult.shouldBeRecurring
		}
		stageForLLM := tx.StageForLLM && categoryResult.stagedForLLM
		merchantName := tx.MerchantName
		if categoryResult.merchantName != nil {
			merchantName = categoryResult.merchantName
		}
		transactionID, err := q.UpsertSyncedTransaction(ctx, dbgen.UpsertSyncedTransactionParams{
			ExternalID:      tx.ExternalID,
			AccountID:       accountID,
			AmountCents:     money.FromDollars(tx.Amount),
			Datetime:        tx.Datetime,
			PostedDatetime:  tx.PostedDatetime,
			MerchantName:    merchantName,
			OriginalName:    tx.OriginalName,
			LogoUrl:         tx.LogoURL,
			CategoryID:      categoryResult.categoryID,
			IsReviewed:      categoryResult.isReviewed,
			PlaidCategory:   tx.PlaidCategory,
			RawProviderJson: tx.RawProviderJSON,
			Source:          source,
			Pending:         tx.Pending,
			IsRecurring:     isRecurring,
			IsHidden:        isHidden,
			StagedForLlm:    stageForLLM,
			Pfc2Categorized: categoryResult.pfc2Categorized,
		})
		if err != nil || len(categoryResult.tagIDs) == 0 {
			return err
		}
		return q.AddTransactionTagsByTransactionIDs(ctx, dbgen.AddTransactionTagsByTransactionIDsParams{TransactionIds: []int64{transactionID}, TagIds: categoryResult.tagIDs})
	})
	return newRecord, err
}

func (s *Store) UpsertSyncedAccount(ctx context.Context, draft transactions.AccountDraft) error {
	_, err := s.q.UpsertAccount(ctx, dbgen.UpsertAccountParams{
		ExternalID:   draft.ID,
		ConnectionID: &draft.ConnectionID,
		OwnerID:      draft.OwnerID,
		Name:         draft.Name,
		Type:         string(draft.Type),
		Subtype:      draft.Subtype,
		Mask:         draft.Mask,
		NeedsReview:  draft.NeedsReview,
	})
	return err
}

type syncedTransactionCategoryResult struct {
	newRecord         bool
	categoryID        int64
	merchantName      *string
	isReviewed        bool
	stagedForLLM      bool
	pfc2Categorized   bool
	tagIDs            []int64
	shouldHide        *bool
	shouldBeRecurring *bool
}

func syncedTransactionCategory(ctx context.Context, q *dbgen.Queries, tx transactions.SyncedTransaction, accountID int64) (syncedTransactionCategoryResult, error) {
	source := lo.CoalesceOrEmpty(tx.Source, transactions.TransactionSourcePlaid)
	row, scanErr := q.SyncedTransactionState(ctx, dbgen.SyncedTransactionStateParams{ExternalID: tx.ExternalID, Source: source})
	if scanErr != nil && !errors.Is(scanErr, sql.ErrNoRows) {
		return syncedTransactionCategoryResult{categoryID: UncategorizedCategoryID}, scanErr
	}
	newRecord := errors.Is(scanErr, sql.ErrNoRows)
	matched, matchErr := autoCategorizationResult(ctx, q, tx, accountID)
	if !newRecord && row.IsReviewed {
		if matchErr != nil {
			return syncedTransactionCategoryResult{categoryID: row.CategoryID, isReviewed: true}, matchErr
		}
		var merchantName *string
		if matched != nil {
			merchantName = matched.MerchantName
		}
		return syncedTransactionCategoryResult{categoryID: row.CategoryID, merchantName: merchantName, isReviewed: true}, nil
	}
	if matchErr != nil || matched == nil || matched.CategoryID == nil {
		result := syncedTransactionCategoryResult{
			newRecord:    newRecord,
			categoryID:   UncategorizedCategoryID,
			stagedForLLM: true,
		}
		if matched != nil {
			result.merchantName = matched.MerchantName
			result.tagIDs = matched.TagIDs
			result.shouldHide = matched.ShouldHide
			result.shouldBeRecurring = matched.ShouldBeRecurring
		}
		return result, matchErr
	}
	return syncedTransactionCategoryResult{
		newRecord:         newRecord,
		categoryID:        *matched.CategoryID,
		merchantName:      matched.MerchantName,
		isReviewed:        true,
		stagedForLLM:      matched.FromPFC2,
		pfc2Categorized:   matched.FromPFC2,
		tagIDs:            matched.TagIDs,
		shouldHide:        matched.ShouldHide,
		shouldBeRecurring: matched.ShouldBeRecurring,
	}, nil
}
