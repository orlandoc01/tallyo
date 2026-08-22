package balancesync

import (
	"context"
	"testing"
	"time"

	"tallyo/internal/accounts"
	"tallyo/internal/graph/model"
)

func TestTrackingDisabledSkipsDueSync(t *testing.T) {
	store := &syncStore{assets: map[int64]*model.Asset{}}
	adapter := &recordingAdapter{}
	portfolio := &recordingPortfolio{}
	syncer := testBalanceSyncer(
		store,
		adapter,
		portfolio,
		func() time.Time { return time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC) },
	)
	syncer.trackingDisabled = func() bool { return true }

	syncer.syncDue(context.Background())
	if adapter.due || store.swept != 0 || portfolio.calls != 0 {
		t.Fatalf("adapter.due=%t swept=%d portfolio=%d", adapter.due, store.swept, portfolio.calls)
	}
}

func TestTrackingDisabledSkipsAccountCreatedSync(t *testing.T) {
	store := &syncStore{assets: map[int64]*model.Asset{}}
	adapter := &recordingAdapter{provider: accounts.SourceTablePlaidItem}
	syncer := testBalanceSyncer(
		store,
		adapter,
		noopPortfolioSyncer{},
		func() time.Time { return time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC) },
	)
	syncer.trackingDisabled = func() bool { return true }

	syncer.syncAccountCreated(context.Background(), accounts.AccountsCreated{
		Provider:     accounts.SourceTablePlaidItem,
		ConnectionID: 3,
		SourceID:     42,
	})
	if adapter.connection || store.swept != 0 {
		t.Fatalf("adapter.connection=%t swept=%d", adapter.connection, store.swept)
	}
}
