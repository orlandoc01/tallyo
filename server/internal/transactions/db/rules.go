package transactionsdb

import (
	"context"
	"database/sql"
	"strings"

	"github.com/samber/lo"

	"tallyo/internal/apierror"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
)

func (s *Store) Rules(ctx context.Context, input *model.RulesInput) ([]*model.Rule, error) {
	rows, err := s.q.ListRules(ctx, listRulesParams(input))
	return dbutil.MapRows(rows, err, ruleFromRow)
}

func (s *Store) CreateRule(ctx context.Context, input model.CreateRuleInput) (*model.Rule, int32, error) {
	changes, err := ruleChangesFromUpdates(input.Changes)
	if err != nil {
		return nil, 0, err
	}
	if !changes.hasAction() {
		return nil, 0, apierror.Publicf("changes.categoryId, changes.merchantName, changes.tagIds, changes.isHidden, or changes.isRecurring is required")
	}
	merchantPattern := optionalInputString(input.MerchantPattern)
	if merchantPattern == "" && optionalInputString(input.OriginalPattern) == "" {
		return nil, 0, apierror.Publicf("merchantPattern or originalPattern is required")
	}
	priority := lo.FromPtrOr(input.Priority, int32(0))
	var (
		ruleID  int64
		updated int32
	)
	err = s.WithTx(ctx, func(tx *sql.Tx, q *dbgen.Queries) error {
		var err error
		ruleID, err = q.CreateRule(ctx, dbgen.CreateRuleParams{
			MerchantPattern:   merchantPattern,
			OriginalPattern:   optionalInputString(input.OriginalPattern),
			MerchantName:      changes.merchantName,
			CategoryID:        changes.categoryID,
			ShouldHide:        changes.shouldHide,
			ShouldBeRecurring: changes.shouldBeRecurring,
			AmountMinCents:    input.AmountMin,
			AmountMaxCents:    input.AmountMax,
			Priority:          int64(priority),
		})
		if err != nil {
			return err
		}
		accountIDs, err := model.LocalInt64IDsOfTypePtr(input.AccountIds, model.GlobalIDAccount)
		if err != nil {
			return err
		}
		for _, accountID := range accountIDs {
			if err := q.InsertRuleAccount(ctx, dbgen.InsertRuleAccountParams{RuleID: ruleID, AccountID: accountID}); err != nil {
				return err
			}
		}
		if err := setRuleTags(ctx, q, ruleID, changes.tagIDs); err != nil {
			return err
		}
		updated, err = applyRuleRetroactively(ctx, tx, input, changes)
		return err
	})
	if err != nil {
		return nil, 0, err
	}
	rule, err := s.RuleByID(ctx, ruleID)
	return rule, updated, err
}

func (s *Store) UpdateRule(ctx context.Context, input model.UpdateRuleInput) (*model.Rule, int32, error) {
	ruleID := input.ID.Int64()
	changes, err := ruleChangesFromUpdates(input.Changes)
	if err != nil {
		return nil, 0, err
	}
	if !changes.hasAction() {
		return nil, 0, apierror.Publicf("changes.categoryId, changes.merchantName, changes.tagIds, changes.isHidden, or changes.isRecurring is required")
	}
	merchantPattern := optionalInputString(input.MerchantPattern)
	if merchantPattern == "" && optionalInputString(input.OriginalPattern) == "" {
		return nil, 0, apierror.Publicf("merchantPattern or originalPattern is required")
	}
	priority := lo.FromPtrOr(input.Priority, int32(0))
	var updated int32
	err = s.WithTx(ctx, func(tx *sql.Tx, q *dbgen.Queries) error {
		rows, err := q.UpdateRule(ctx, dbgen.UpdateRuleParams{
			MerchantPattern:   merchantPattern,
			OriginalPattern:   optionalInputString(input.OriginalPattern),
			MerchantName:      changes.merchantName,
			CategoryID:        changes.categoryID,
			ShouldHide:        changes.shouldHide,
			ShouldBeRecurring: changes.shouldBeRecurring,
			AmountMinCents:    input.AmountMin,
			AmountMaxCents:    input.AmountMax,
			Priority:          int64(priority),
			ID:                ruleID,
		})
		if err != nil {
			return err
		}
		if rows == 0 {
			return apierror.Publicf("rule %d not found", ruleID)
		}
		if err := q.DeleteRuleAccounts(ctx, dbgen.DeleteRuleAccountsParams{RuleID: ruleID}); err != nil {
			return err
		}
		accountIDs, err := model.LocalInt64IDsOfTypePtr(input.AccountIds, model.GlobalIDAccount)
		if err != nil {
			return err
		}
		for _, accountID := range accountIDs {
			if err := q.InsertRuleAccount(ctx, dbgen.InsertRuleAccountParams{RuleID: ruleID, AccountID: accountID}); err != nil {
				return err
			}
		}
		if err := q.DeleteRuleTags(ctx, dbgen.DeleteRuleTagsParams{RuleID: ruleID}); err != nil {
			return err
		}
		if err := setRuleTags(ctx, q, ruleID, changes.tagIDs); err != nil {
			return err
		}
		updated, err = applyRuleUpdateRetroactively(ctx, tx, input, changes)
		return err
	})
	if err != nil {
		return nil, 0, err
	}
	rule, err := s.RuleByID(ctx, ruleID)
	return rule, updated, err
}

func (s *Store) DeleteRule(ctx context.Context, id int64) (bool, error) {
	rows, err := s.q.DeleteRule(ctx, dbgen.DeleteRuleParams{ID: id})
	return dbutil.RowsAffected(rows, err)
}

func (s *Store) RuleByID(ctx context.Context, id int64) (*model.Rule, error) {
	rows, err := s.q.ListRules(ctx, dbgen.ListRulesParams{ID: &id})
	return dbutil.MapFirstRow(rows, err, ruleFromRow)
}

func listRulesParams(input *model.RulesInput) dbgen.ListRulesParams {
	params := dbgen.ListRulesParams{}
	if input == nil {
		return params
	}
	params.MerchantPattern = lo.EmptyableToPtr(optionalRuleSearch(input.MerchantPattern))
	params.OriginalPattern = lo.EmptyableToPtr(optionalRuleSearch(input.OriginalPattern))
	params.AmountMinCents = input.AmountMin
	params.AmountMaxCents = input.AmountMax
	params.AccountIds = model.LocalInt64IDsPtr(input.AccountIds)
	return params
}

func optionalRuleSearch(value *string) string {
	return strings.ToLower(strings.TrimSpace(lo.FromPtr(value)))
}

func ruleFromRow(row dbgen.ListRulesRow) *model.Rule {
	ruleRow := row.Rule
	rule := &model.Rule{
		ID:                model.New(model.GlobalIDRule, ruleRow.ID),
		OriginalPattern:   lo.EmptyableToPtr(ruleRow.OriginalPattern),
		MerchantName:      ruleRow.MerchantName,
		AmountMin:         ruleRow.AmountMinCents,
		AmountMax:         ruleRow.AmountMaxCents,
		ShouldHide:        ruleRow.ShouldHide,
		ShouldBeRecurring: ruleRow.ShouldBeRecurring,
		Priority:          int32(ruleRow.Priority),
		CreatedAt:         ruleRow.CreatedAt,
		Category:          ruleCategoryFromRow(row),
	}
	if ruleRow.MerchantPattern != "" {
		rule.MerchantPattern = &ruleRow.MerchantPattern
	}
	return rule
}

func ruleCategoryFromRow(row dbgen.ListRulesRow) *model.Category {
	if row.CatID == nil || row.CatName == nil || row.CatEmoji == nil || row.GroupName == nil || row.GroupEmoji == nil || row.GroupKind == nil || row.SortOrder == nil || row.PlaidPfc2Codes == nil {
		return nil
	}
	return CategoryFromRow(dbgen.CategoryRow{
		CatID: *row.CatID, CatName: *row.CatName, CatEmoji: *row.CatEmoji,
		GroupName: *row.GroupName, GroupEmoji: *row.GroupEmoji, GroupKind: *row.GroupKind,
		SortOrder: *row.SortOrder, PlaidPfc2Codes: *row.PlaidPfc2Codes,
	})
}

func setRuleTags(ctx context.Context, q *dbgen.Queries, ruleID int64, tagIDs []int64) error {
	for _, tagID := range tagIDs {
		if err := q.InsertRuleTag(ctx, dbgen.InsertRuleTagParams{RuleID: ruleID, TagID: tagID}); err != nil {
			return err
		}
	}
	return nil
}

func optionalInputString(value *string) string {
	return lo.FromPtr(value)
}
