package transactionsdb

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/graph/model"
	"tallyo/internal/money"
)

type retroactiveRuleParams struct {
	applyRetroactively *bool
	merchantPattern    *string
	originalPattern    *string
	amountMin          *money.Cents
	amountMax          *money.Cents
	accountIds         []*model.GlobalID
	changes            ruleChanges
}

func applyRuleRetroactively(ctx context.Context, tx *sql.Tx, input model.CreateRuleInput, changes ruleChanges) (int32, error) {
	return applyRuleRetroactivelyParams(ctx, tx, retroactiveRuleParams{
		applyRetroactively: input.ApplyRetroactively,
		merchantPattern:    input.MerchantPattern,
		originalPattern:    input.OriginalPattern,
		amountMin:          input.AmountMin,
		amountMax:          input.AmountMax,
		accountIds:         input.AccountIds,
		changes:            changes,
	})
}

func applyRuleUpdateRetroactively(ctx context.Context, tx *sql.Tx, input model.UpdateRuleInput, changes ruleChanges) (int32, error) {
	return applyRuleRetroactivelyParams(ctx, tx, retroactiveRuleParams{
		applyRetroactively: input.ApplyRetroactively,
		merchantPattern:    input.MerchantPattern,
		originalPattern:    input.OriginalPattern,
		amountMin:          input.AmountMin,
		amountMax:          input.AmountMax,
		accountIds:         input.AccountIds,
		changes:            changes,
	})
}

func applyRuleRetroactivelyParams(ctx context.Context, tx *sql.Tx, p retroactiveRuleParams) (int32, error) {
	if p.applyRetroactively == nil || !*p.applyRetroactively {
		return 0, nil
	}
	if optionalInputString(p.merchantPattern) == "" && optionalInputString(p.originalPattern) == "" {
		return 0, nil
	}
	ids, err := retroactiveRuleTransactionIDs(ctx, tx, p)
	if err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		return 0, nil
	}
	q := dbgen.New(tx)
	params := dbgen.UpdateTransactionFieldsByIDsParams{Ids: ids}
	if p.changes.merchantName != nil {
		params.SetMerchantName = true
		params.MerchantName = p.changes.merchantName
	}
	if p.changes.categoryID != nil {
		params.SetCategory = true
		params.CategoryID = *p.changes.categoryID
	}
	if p.changes.shouldHide != nil {
		params.SetHidden = true
		params.IsHidden = *p.changes.shouldHide
	}
	if p.changes.shouldBeRecurring != nil {
		params.SetRecurring = true
		params.IsRecurring = *p.changes.shouldBeRecurring
	}
	if params.SetMerchantName || params.SetCategory || params.SetHidden || params.SetRecurring {
		if _, err := q.UpdateTransactionFieldsByIDs(ctx, params); err != nil {
			return 0, err
		}
	}
	if len(p.changes.tagIDs) > 0 {
		if err := q.AddTransactionTagsByTransactionIDs(ctx, dbgen.AddTransactionTagsByTransactionIDsParams{TagIds: p.changes.tagIDs, TransactionIds: ids}); err != nil {
			return 0, err
		}
	}
	return int32(len(ids)), nil
}

// retroactiveRuleTransactionIDs finds transactions matching a rule's
// merchant/original substring (OR), optional amount bounds, and optional
// account set, mirroring the live rule-match semantics in
// queries/categorization.sql's AutoRuleResult (instr()-based, case-insensitive).
func retroactiveRuleTransactionIDs(ctx context.Context, tx *sql.Tx, p retroactiveRuleParams) ([]int64, error) {
	params := dbgen.RetroactiveRuleTransactionIDsParams{AmountMin: p.amountMin, AmountMax: p.amountMax}
	if merchantPattern := optionalInputString(p.merchantPattern); merchantPattern != "" {
		params.MerchantPattern = new(strings.ToLower(merchantPattern))
	}
	if originalPattern := optionalInputString(p.originalPattern); originalPattern != "" {
		params.OriginalPattern = new(strings.ToLower(originalPattern))
	}
	if len(p.accountIds) > 0 {
		accountIDs, err := model.LocalInt64IDsOfTypePtr(p.accountIds, model.GlobalIDAccount)
		if err != nil {
			return nil, err
		}
		params.AccountIds = accountIDs
	}
	ids, err := dbgen.New(tx).RetroactiveRuleTransactionIDs(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("select retroactive rule transaction ids: %w", err)
	}
	return ids, nil
}
