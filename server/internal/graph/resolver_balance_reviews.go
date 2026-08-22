package graph

import (
	"context"

	"tallyo/internal/apierror"
	"tallyo/internal/graph/model"
	u "tallyo/internal/utils"
	"tallyo/internal/wealth"
)

func (r *Resolver) BalanceSnapshotReviews(ctx context.Context) (*model.BalanceSnapshotReviewList, error) {
	reviews, err := r.WealthDB.ListInReviewBalanceReviews(ctx)
	if err != nil {
		return nil, err
	}
	return &model.BalanceSnapshotReviewList{Items: u.Map(reviews, balanceReviewToModel)}, nil
}

func (r *Resolver) ResolveBalanceReview(ctx context.Context, input model.ResolveBalanceReviewInput) (*model.ResolveBalanceReviewPayload, error) {
	reviewID, err := input.ID.Int64OfType(model.GlobalIDBalanceReview)
	if err != nil {
		return nil, err
	}
	switch input.Action {
	case model.BalanceReviewActionApproveChanges:
		if err := r.WealthDB.ApproveBalanceReview(ctx, reviewID); err != nil {
			return nil, err
		}
	case model.BalanceReviewActionUseProvider:
		if err := r.WealthDB.UseProviderBalanceReview(ctx, reviewID); err != nil {
			return nil, err
		}
	default:
		return nil, apierror.Publicf("unsupported balance review action %q", input.Action)
	}
	return &model.ResolveBalanceReviewPayload{Success: true}, nil
}

func balanceReviewToModel(review wealth.BalanceReview) *model.BalanceSnapshotReview {
	return &model.BalanceSnapshotReview{
		ID:                     model.New(model.GlobalIDBalanceReview, review.ID),
		Account:                review.Account,
		FirstFlaggedDate:       model.Date(review.FirstFlaggedDate),
		LatestFlaggedDate:      model.Date(review.LatestFlaggedDate),
		FlaggedSnapshotCount:   int32(review.FlaggedSnapshotCount),
		ProviderBalanceUsd:     review.ProviderBalanceUSD,
		CarryForwardBalanceUsd: review.CarryForwardBalanceUSD,
		FlagReason:             review.FlagReason,
		CreatedAt:              review.CreatedAt,
		UpdatedAt:              review.UpdatedAt,
	}
}
