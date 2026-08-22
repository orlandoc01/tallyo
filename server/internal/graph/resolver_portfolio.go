package graph

import (
	"context"

	"tallyo/internal/graph/model"
	"tallyo/internal/portfolio"
)

func (r *Resolver) Analysis(ctx context.Context, input model.AnalysisInput) (*model.AnalysisReport, error) {
	ownerIDs, err := model.LocalInt64IDsOfTypePtr(input.OwnerIds, model.GlobalIDOwner)
	if err != nil {
		return nil, err
	}
	accountIDs, err := model.LocalInt64IDsOfTypePtr(input.AccountIds, model.GlobalIDAccount)
	if err != nil {
		return nil, err
	}
	report, err := r.Portfolio.Analyze(ctx, input.View, portfolio.HoldingsFilter{OwnerIDs: ownerIDs, AccountSubtypes: input.AccountSubtypes, AccountIDs: accountIDs, IncludeUnclassified: input.IncludeUnclassified != nil && *input.IncludeUnclassified})
	return report, err
}
