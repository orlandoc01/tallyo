package wealthdb

import (
	"cmp"
	"context"
	"database/sql"
	"fmt"

	accountsdb "tallyo/internal/accounts/db"
	"tallyo/internal/apierror"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/money"
	"tallyo/internal/wealth"
)

func (s *Store) ListInReviewBalanceReviews(ctx context.Context) ([]wealth.BalanceReview, error) {
	rows, err := s.q.ListInReviewBalanceReviews(ctx, dbgen.ListInReviewBalanceReviewsParams{InReviewOnly: true})
	return dbutil.MapRows(rows, err, balanceReviewFromListRow)
}

func (s *Store) GetBalanceReviewByID(ctx context.Context, id int64) (*wealth.BalanceReview, error) {
	return balanceReviewByRowID(ctx, s.q, id)
}

func approvedBalanceReviewFromValue(providerBalanceUSD money.Cents) *wealth.ApprovedBalanceReview {
	return &wealth.ApprovedBalanceReview{ProviderBalanceUSD: providerBalanceUSD}
}

func (s *Store) GetApprovedBalanceReviewByAccount(ctx context.Context, accountID int64) (*wealth.ApprovedBalanceReview, error) {
	row, err := s.q.GetApprovedBalanceReviewByAccount(ctx, dbgen.GetApprovedBalanceReviewByAccountParams{AccountID: accountID})
	return dbutil.MapRow(row, err, approvedBalanceReviewFromValue)
}

func (s *Store) UpsertBalanceReview(ctx context.Context, review wealth.BalanceReviewUpsert) error {
	_, err := upsertBalanceReview(ctx, s.q, review)
	return err
}

func upsertBalanceReview(ctx context.Context, q *dbgen.Queries, review wealth.BalanceReviewUpsert) (int64, error) {
	count := cmp.Or(int64(review.FlaggedSnapshotCount), 1)
	return q.UpsertBalanceReview(ctx, dbgen.UpsertBalanceReviewParams{
		AccountID:                   review.AccountID,
		FirstFlaggedDate:            review.FirstFlaggedDate,
		LatestFlaggedDate:           review.LatestFlaggedDate,
		FlaggedSnapshotCount:        count,
		ProviderBalanceUsdCents:     review.ProviderBalanceUSD,
		CarryForwardBalanceUsdCents: review.CarryForwardBalanceUSD,
		FlagReason:                  &review.FlagReason,
	})
}

func (s *Store) ApproveBalanceReview(ctx context.Context, id int64) error {
	return s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		review, err := balanceReviewByRowID(ctx, q, id)
		if err != nil {
			return err
		}
		if review == nil || review.Decision != "IN_REVIEW" {
			return apierror.Publicf("balance review %d not found", id)
		}
		hasFlaggedSnapshot, err := q.HasFlaggedSnapshotForAccountBetweenDates(ctx, dbgen.HasFlaggedSnapshotForAccountBetweenDatesParams{
			AccountID: review.AccountID,
			StartDate: review.FirstFlaggedDate,
			EndDate:   review.LatestFlaggedDate,
		})
		if err != nil {
			return fmt.Errorf("list flagged snapshots: %w", err)
		}
		if hasFlaggedSnapshot == 0 {
			return apierror.Publicf("balance review %d has no flagged snapshots", id)
		}
		rows, err := q.ApproveInReviewBalanceReview(ctx, dbgen.ApproveInReviewBalanceReviewParams{ID: id})
		if err != nil {
			return fmt.Errorf("approve balance review: %w", err)
		}
		if rows == 0 {
			return apierror.Publicf("balance review %d not found", id)
		}
		if err := q.UnflagSnapshotsBetweenDates(ctx, dbgen.UnflagSnapshotsBetweenDatesParams{
			AccountID:  review.AccountID,
			AfterDate:  review.FirstFlaggedDate,
			BeforeDate: review.LatestFlaggedDate,
			Inclusive:  true,
		}); err != nil {
			return fmt.Errorf("unflag approved snapshots: %w", err)
		}
		if err := q.DeleteSnapshotProviderStatesBetweenDates(ctx, dbgen.DeleteSnapshotProviderStatesBetweenDatesParams{
			AccountID:  review.AccountID,
			AfterDate:  &review.FirstFlaggedDate,
			BeforeDate: &review.LatestFlaggedDate,
			Inclusive:  true,
		}); err != nil {
			return fmt.Errorf("delete approved provider states: %w", err)
		}
		return nil
	})
}

func (s *Store) UseProviderBalanceReview(ctx context.Context, id int64) error {
	return s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		review, err := balanceReviewByRowID(ctx, q, id)
		if err != nil {
			return err
		}
		if review == nil || review.Decision != "IN_REVIEW" {
			return apierror.Publicf("balance review %d not found", id)
		}
		snapshots, err := q.FlaggedSnapshotsWithProviderStatesForReview(ctx, dbgen.FlaggedSnapshotsWithProviderStatesForReviewParams{
			AccountID: review.AccountID,
			StartDate: review.FirstFlaggedDate,
			EndDate:   review.LatestFlaggedDate,
		})
		if err != nil {
			return fmt.Errorf("list flagged snapshots: %w", err)
		}
		if len(snapshots) == 0 {
			return apierror.Publicf("balance review %d has no flagged snapshots", id)
		}
		restores := make([]providerSnapshotRestore, 0, len(snapshots))
		for _, snapshot := range snapshots {
			if snapshot.MissingProviderState {
				return apierror.Publicf("balance review %d is missing provider state", id)
			}
			holdingsJSON := snapshot.ProviderHoldingsJson
			holdings, err := wealth.BalanceReviewProviderHoldingsFromJSON(&holdingsJSON)
			if err != nil {
				return fmt.Errorf("decode provider holdings for %s: %w", snapshot.Date, err)
			}
			restores = append(restores, providerSnapshotRestore{
				SnapshotID: snapshot.ID,
				Date:       snapshot.Date,
				BalanceUSD: snapshot.ProviderBalanceUsdCents,
				Holdings:   holdings,
			})
		}
		for _, snapshot := range restores {
			if err := q.UpdateSnapshotBalanceAndUnflag(ctx, dbgen.UpdateSnapshotBalanceAndUnflagParams{
				ID:              snapshot.SnapshotID,
				BalanceUsdCents: snapshot.BalanceUSD,
			}); err != nil {
				return fmt.Errorf("restore snapshot balance: %w", err)
			}
			if err := q.DeleteAssetDailyHoldingsBySnapshotID(ctx, dbgen.DeleteAssetDailyHoldingsBySnapshotIDParams{SnapshotID: snapshot.SnapshotID}); err != nil {
				return fmt.Errorf("delete carried-forward holdings: %w", err)
			}
			if err := insertProviderHoldings(ctx, q, providerHoldingsInput{
				AccountID:  review.AccountID,
				SnapshotID: snapshot.SnapshotID,
				Date:       snapshot.Date,
				Holdings:   snapshot.Holdings,
			}); err != nil {
				return err
			}
		}
		if err := q.DeleteSnapshotProviderStatesBetweenDates(ctx, dbgen.DeleteSnapshotProviderStatesBetweenDatesParams{
			AccountID:  review.AccountID,
			AfterDate:  &review.FirstFlaggedDate,
			BeforeDate: &review.LatestFlaggedDate,
			Inclusive:  true,
		}); err != nil {
			return fmt.Errorf("delete provider states: %w", err)
		}
		if err := q.DeleteBalanceReviewByID(ctx, dbgen.DeleteBalanceReviewByIDParams{ID: id}); err != nil {
			return fmt.Errorf("delete balance review: %w", err)
		}
		return nil
	})
}

type providerSnapshotRestore struct {
	SnapshotID int64
	Date       string
	BalanceUSD money.Cents
	Holdings   []wealth.BalanceReviewProviderHolding
}

func balanceReviewByRowID(ctx context.Context, q *dbgen.Queries, id int64) (*wealth.BalanceReview, error) {
	rows, err := q.ListInReviewBalanceReviews(ctx, dbgen.ListInReviewBalanceReviewsParams{ID: &id})
	toReview := func(row dbgen.ListInReviewBalanceReviewsRow) *wealth.BalanceReview {
		review := balanceReviewFromListRow(row)
		return &review
	}
	return dbutil.MapFirstRow(rows, err, toReview)
}

func balanceReviewFromListRow(row dbgen.ListInReviewBalanceReviewsRow) wealth.BalanceReview {
	return wealth.BalanceReview{
		ID:                     row.ID,
		AccountID:              row.AccountID,
		Account:                accountsdb.AccountFromRow(row.Account, row.OwnerName),
		Decision:               row.Decision,
		FirstFlaggedDate:       row.FirstFlaggedDate,
		LatestFlaggedDate:      row.LatestFlaggedDate,
		FlaggedSnapshotCount:   int(row.FlaggedSnapshotCount),
		ProviderBalanceUSD:     row.ProviderBalanceUsdCents,
		CarryForwardBalanceUSD: row.CarryForwardBalanceUsdCents,
		FlagReason:             row.FlagReason,
		CreatedAt:              row.CreatedAt,
		UpdatedAt:              row.UpdatedAt,
	}
}
