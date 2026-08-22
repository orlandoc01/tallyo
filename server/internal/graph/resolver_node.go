package graph

import (
	"context"
	"database/sql"
	"errors"

	"tallyo/internal/apierror"
	"tallyo/internal/graph/model"
)

const maxNodeIDs = 100

var nodeScopeQuery = map[model.GlobalIDType]string{
	model.GlobalIDAccount:              "account",
	model.GlobalIDAsset:                "assets",
	model.GlobalIDBalanceReview:        "balanceSnapshotReviews",
	model.GlobalIDSnapshot:             "accountSnapshot",
	model.GlobalIDBudget:               "budgetReport",
	model.GlobalIDCategory:             "categories",
	model.GlobalIDCategoryGroup:        "categoryGroups",
	model.GlobalIDRule:                 "rules",
	model.GlobalIDTag:                  "tags",
	model.GlobalIDConnection:           "connections",
	model.GlobalIDOwner:                "owners",
	model.GlobalIDPlaidItem:            "plaidItems",
	model.GlobalIDRecurringCharge:      "recurringCharges",
	model.GlobalIDSimpleFinAccessToken: "simpleFinAccessTokens",
	model.GlobalIDSimpleFinConnection:  "connections",
	model.GlobalIDTransaction:          "transaction",
	model.GlobalIDUser:                 "users",
}

func (r *Resolver) Node(ctx context.Context, id model.GlobalID) (model.Node, error) {
	if err := requireNodeScope(ctx, id.Type); err != nil {
		return nil, err
	}
	return r.node(ctx, id)
}

func (r *Resolver) node(ctx context.Context, id model.GlobalID) (model.Node, error) {
	switch id.Type {
	case model.GlobalIDAccount:
		return nodeOrNil(r.AccountsStore.AccountByID(ctx, id.Int64()))
	case model.GlobalIDAsset:
		return nodeOrNil(r.WealthDB.AssetByID(ctx, id.Int64()))
	case model.GlobalIDBalanceReview:
		review, err := r.WealthDB.GetBalanceReviewByID(ctx, id.Int64())
		if review == nil {
			return nil, err
		}
		return nodeOrNil(balanceReviewToModel(*review), err)
	case model.GlobalIDSnapshot:
		return nodeOrNil(r.Wealth.AccountSnapshot(ctx, model.AccountSnapshotInput{SnapshotID: &id}))
	case model.GlobalIDBudget:
		return nodeOrNil(r.Budgets.BudgetByID(ctx, id.Int64()))
	case model.GlobalIDCategory:
		return nodeOrNil(r.TransactionsStore.Category(ctx, id.Int64()))
	case model.GlobalIDCategoryGroup:
		return nodeOrNil(r.TransactionsStore.CategoryGroupByID(ctx, id.Int64()))
	case model.GlobalIDRule:
		return nodeOrNil(r.TransactionsStore.RuleByID(ctx, id.Int64()))
	case model.GlobalIDTag:
		return nodeOrNil(r.TransactionsStore.TagByID(ctx, id.Int64()))
	case model.GlobalIDConnection:
		return nodeOrNil(r.AccountsStore.ConnectionByID(ctx, id.Int64()))
	case model.GlobalIDOwner:
		return nodeOrNil(r.AccountsStore.OwnerByID(ctx, id.Int64()))
	case model.GlobalIDPlaidItem:
		return nodeOrNil(r.AccountsStore.PlaidItem(ctx, id.Int64()))
	case model.GlobalIDRecurringCharge:
		return nodeOrNil(r.TransactionsStore.RecurringChargeByID(ctx, id.Int64()))
	case model.GlobalIDSimpleFinAccessToken:
		return nodeOrNil(r.AccountsStore.SimpleFinAccessTokenByID(ctx, id.Int64()))
	case model.GlobalIDSimpleFinConnection:
		return nodeOrNil(r.AccountsStore.SimpleFinConnectionByConnID(ctx, id.Int64()))
	case model.GlobalIDTransaction:
		return nodeOrNil(r.TransactionsStore.Transaction(ctx, id.Int64()))
	case model.GlobalIDUser:
		return nodeOrNil(r.Admin.UserByID(ctx, id.Int64()))
	default:
		return nil, apierror.Publicf("unsupported node type %q", id.Type)
	}
}

func nodeOrNil[T interface {
	model.Node
	comparable
}](value T, err error) (model.Node, error) {
	if isNodeMissing(err) {
		return nil, nil
	}
	if value == *new(T) {
		return nil, err
	}
	return value, err
}

func (r *Resolver) Nodes(ctx context.Context, ids []*model.GlobalID) ([]model.Node, error) {
	if err := validateNodeIDs(ids); err != nil {
		return nil, err
	}
	if err := requireNodeScopes(ctx, ids); err != nil {
		return nil, err
	}

	nodes := make([]model.Node, len(ids))
	for i, id := range ids {
		node, err := r.node(ctx, *id)
		if err != nil {
			return nil, err
		}
		nodes[i] = node
	}
	return nodes, nil
}

func validateNodeIDs(ids []*model.GlobalID) error {
	if len(ids) > maxNodeIDs {
		return apierror.Publicf("nodes accepts at most %d ids", maxNodeIDs)
	}
	for _, id := range ids {
		if id == nil {
			return apierror.Publicf("nodes ids must not contain null")
		}
	}
	return nil
}

func requireNodeScopes(ctx context.Context, ids []*model.GlobalID) error {
	seen := map[model.GlobalIDType]bool{}
	for _, id := range ids {
		if id == nil {
			continue
		}
		if seen[id.Type] {
			continue
		}
		seen[id.Type] = true
		if err := requireNodeScope(ctx, id.Type); err != nil {
			return err
		}
	}
	return nil
}

func requireNodeScope(ctx context.Context, typ model.GlobalIDType) error {
	fieldName, ok := nodeScopeQuery[typ]
	if !ok {
		return apierror.Publicf("unsupported node type %q", typ)
	}
	return RequireOperationScope(ctx, "Query", fieldName)
}

func isNodeMissing(err error) bool {
	return errors.Is(err, sql.ErrNoRows)
}
