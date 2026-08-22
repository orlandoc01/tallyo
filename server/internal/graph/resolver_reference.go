package graph

import (
	"context"
	"fmt"

	"tallyo/internal/apierror"
	"tallyo/internal/graph/model"
	"tallyo/internal/transactions/pfc2"
	u "tallyo/internal/utils"
	"tallyo/internal/wealth/realestate"
)

func (r *Resolver) Categories(ctx context.Context) (*model.CategoryList, error) {
	return listResult(ctx, r.TransactionsStore.Categories, func(items []*model.Category) *model.CategoryList { return &model.CategoryList{Items: items} })
}

func (r *Resolver) CategoryGroups(ctx context.Context) (*model.CategoryGroupList, error) {
	return listResult(ctx, r.TransactionsStore.CategoryGroups, func(items []*model.CategoryGroup) *model.CategoryGroupList {
		return &model.CategoryGroupList{Items: items}
	})
}

func (r *Resolver) PlaidPFC2Codes(ctx context.Context) ([]string, error) {
	return pfc2.Codes(), nil
}

func (r *Resolver) Accounts(ctx context.Context) (*model.AccountList, error) {
	return listResult(ctx, r.AccountsStore.Accounts, func(items []*model.Account) *model.AccountList { return &model.AccountList{Items: items} })
}

func (r *Resolver) RecurringCharges(ctx context.Context) (*model.RecurringChargeList, error) {
	return listResult(ctx, r.TransactionsStore.GetRecurringCharges, func(items []*model.RecurringCharge) *model.RecurringChargeList {
		return &model.RecurringChargeList{Items: items}
	})
}

func listResult[T any, L any](ctx context.Context, load func(context.Context) ([]T, error), wrap func([]T) *L) (*L, error) {
	items, err := load(ctx)
	if err != nil {
		return nil, err
	}
	return wrap(items), nil
}

// Rules batch-hydrates tags and accounts directly on every rule (one tag
// query, one account query) so callers that bypass GraphQL's per-field
// dataloaders — MCP tool calls in particular — still see complete rules.
func (r *Resolver) Rules(ctx context.Context, input *model.RulesInput) (*model.RuleList, error) {
	if input != nil {
		if _, err := model.LocalInt64IDsOfTypePtr(input.AccountIds, model.GlobalIDAccount); err != nil {
			return nil, err
		}
	}
	rules, err := r.TransactionsStore.Rules(ctx, input)
	if err != nil {
		return nil, err
	}
	if err := r.hydrateRules(ctx, rules); err != nil {
		return nil, err
	}
	return &model.RuleList{Items: rules}, nil
}

func (r *Resolver) hydrateRules(ctx context.Context, rules []*model.Rule) error {
	if len(rules) == 0 {
		return nil
	}
	toRuleID := func(rule *model.Rule) int64 { return rule.ID.Int64() }
	ruleIDs := u.Map(rules, toRuleID)
	tagsByRule, err := r.TransactionsStore.TagsByRuleIDs(ctx, ruleIDs)
	if err != nil {
		return fmt.Errorf("load rule tags: %w", err)
	}
	accountsByRule, err := r.AccountsStore.AccountsByRuleIDs(ctx, ruleIDs)
	if err != nil {
		return fmt.Errorf("load rule accounts: %w", err)
	}
	for _, rule := range rules {
		rule.Tags = tagsByRule[rule.ID.Int64()]
		if rule.Tags == nil {
			rule.Tags = []*model.Tag{}
		}
		rule.Accounts = accountsByRule[rule.ID.Int64()]
		if rule.Accounts == nil {
			rule.Accounts = []*model.Account{}
		}
	}
	return nil
}

func (r *Resolver) GetOwners(ctx context.Context) (*model.OwnerList, error) {
	return listResult(ctx, r.AccountsStore.Owners, func(items []*model.Owner) *model.OwnerList { return &model.OwnerList{Items: items} })
}

func (r *Resolver) CreateOwner(ctx context.Context, input model.CreateOwnerInput) (*model.Owner, error) {
	return r.AccountsStore.CreateOwner(ctx, input)
}

func (r *Resolver) DeleteOwner(ctx context.Context, id model.GlobalID) (bool, error) {
	ownerID, err := id.Int64OfType(model.GlobalIDOwner)
	if err != nil {
		return false, err
	}
	deleted, err := r.AccountsStore.DeleteOwner(ctx, ownerID)
	if err != nil {
		return false, fmt.Errorf("delete owner: %w", err)
	}
	return deleted, nil
}

func (r *Resolver) CreateManualAccount(ctx context.Context, input model.CreateManualAccountInput) (*model.CreateManualAccountPayload, error) {
	if err := validateCreateManualAccountInput(input); err != nil {
		return nil, err
	}
	if input.Type == model.AccountTypeProperty {
		return nil, apierror.Publicf("real estate accounts must be created via linkRealEstate")
	}
	account, err := r.AccountsStore.CreateManualAccount(ctx, input)
	if err != nil {
		return nil, err
	}
	if err := r.ManualSnapshot.SeedInitialSnapshot(ctx, account); err != nil {
		return nil, fmt.Errorf("seed initial snapshot: %w", err)
	}
	return &model.CreateManualAccountPayload{Account: account}, nil
}

func validateCreateManualAccountInput(input model.CreateManualAccountInput) error {
	if err := input.OwnerID.ValidateType(model.GlobalIDOwner); err != nil {
		return err
	}
	return validateOptionalGlobalID(input.ConnectionID, model.GlobalIDConnection)
}

func (r *Resolver) AccountConnection(ctx context.Context, obj *model.Account) (*model.Connection, error) {
	if obj.Connection == nil {
		return nil, nil
	}
	if obj.Connection.ID.Int64() != 0 {
		connectionID := obj.Connection.ID.Int64()
		conn, err := loadersFrom(ctx).Connection.Load(ctx, connectionID)()
		if conn != nil || err != nil {
			return conn, err
		}
	}
	return obj.Connection, nil
}

func (r *Resolver) CreateRule(ctx context.Context, input model.CreateRuleInput) (*model.CreateRulePayload, error) {
	if err := validateRuleInput(input.Changes, input.AccountIds); err != nil {
		return nil, err
	}
	rule, updated, err := r.TransactionsStore.CreateRule(ctx, input)
	if err != nil {
		return nil, err
	}
	if err := r.hydrateRules(ctx, []*model.Rule{rule}); err != nil {
		return nil, err
	}
	return &model.CreateRulePayload{Rule: rule, RetroactivelyUpdated: updated}, nil
}

func (r *Resolver) UpdateRule(ctx context.Context, input model.UpdateRuleInput) (*model.UpdateRulePayload, error) {
	if err := input.ID.ValidateType(model.GlobalIDRule); err != nil {
		return nil, err
	}
	if err := validateRuleInput(input.Changes, input.AccountIds); err != nil {
		return nil, err
	}
	rule, updated, err := r.TransactionsStore.UpdateRule(ctx, input)
	if err != nil {
		return nil, err
	}
	if err := r.hydrateRules(ctx, []*model.Rule{rule}); err != nil {
		return nil, err
	}
	return &model.UpdateRulePayload{Rule: rule, RetroactivelyUpdated: updated}, nil
}

func validateRuleInput(changes *model.TransactionUpdates, accountIDs []*model.GlobalID) error {
	if changes != nil {
		if err := validateTransactionUpdateIDTypes(*changes); err != nil {
			return err
		}
	}
	_, err := model.LocalInt64IDsOfTypePtr(accountIDs, model.GlobalIDAccount)
	return err
}

func (r *Resolver) DeleteRule(ctx context.Context, id model.GlobalID) (*model.DeleteRulePayload, error) {
	ruleID, err := id.Int64OfType(model.GlobalIDRule)
	if err != nil {
		return nil, err
	}
	success, err := r.TransactionsStore.DeleteRule(ctx, ruleID)
	if err != nil {
		return nil, err
	}
	return &model.DeleteRulePayload{Success: success}, nil
}

func (r *Resolver) UpdateAccount(ctx context.Context, input model.UpdateAccountInput) (*model.UpdateAccountPayload, error) {
	accountID, err := input.ID.Int64OfType(model.GlobalIDAccount)
	if err != nil {
		return nil, err
	}
	if err := validateOptionalGlobalID(input.OwnerID, model.GlobalIDOwner); err != nil {
		return nil, err
	}
	account, err := r.AccountsStore.UpdateAccount(ctx, accountID, input)
	if err != nil {
		return nil, err
	}
	if input.Name != nil && account.Type == model.AccountTypeProperty && account.Connection != nil {
		_, err := r.RealEstate.Update(ctx, realestate.UpdateInput{
			ConnectionID: account.Connection.ID.Int64(),
			Name:         input.Name,
		})
		if err != nil {
			return nil, fmt.Errorf("sync real estate name: %w", err)
		}
	}
	return &model.UpdateAccountPayload{Account: account}, nil
}

func (r *Resolver) RemoveManualAccount(ctx context.Context, input model.RemoveManualAccountInput) (*model.RemoveManualAccountPayload, error) {
	accountID, err := input.ID.Int64OfType(model.GlobalIDAccount)
	if err != nil {
		return nil, err
	}
	success, err := r.AccountsStore.RemoveManualAccount(ctx, accountID)
	if err != nil {
		return nil, err
	}
	return &model.RemoveManualAccountPayload{Success: success}, nil
}
