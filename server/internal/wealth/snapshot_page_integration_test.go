package wealth_test

import (
	"context"
	"testing"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	u "tallyo/internal/utils"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
	"tallyo/internal/wealth"
)

func TestAccountSnapshotsPagesNewestDedupedDays(t *testing.T) {
	ctx := u.ContextWithTimezone(context.Background(), "UTC")
	store := openWealthTestStore(t)
	account := createSnapshotEditorAccount(t, ctx, store, "snapshot-page")
	asset := createSnapshotEditorAsset(t, store, "PAGE")
	quantity := 2.0
	price := 175.0

	writeSnapshot := func(source string, date string, syncedAt string, balanceUSD money.Cents, holdings ...wealth.AssetDailyHolding) {
		t.Helper()
		must.NoErr(t, store.ReplaceAccountBalanceSnapshot(ctx, wealth.AccountBalanceSnapshot{
			AccountID:  account.ID.Int64(),
			Source:     source,
			Date:       date,
			SyncedAt:   syncedAt,
			BalanceUSD: balanceUSD,
			Holdings:   holdings,
		}))
	}
	writeSnapshot("plaid", "2026-06-03", "2026-06-03T10:00:00Z", 300)
	writeSnapshot("manual", "2026-06-03", "2026-06-03T12:00:00Z", 350, wealth.AssetDailyHolding{AssetID: asset.ID.Int64(), Quantity: &quantity, Price: &price, ValueUSD: 350, CountsTowardValue: true})
	writeSnapshot("plaid", "2026-06-02", "2026-06-02T10:00:00Z", 200, wealth.AssetDailyHolding{AssetID: asset.ID.Int64(), ValueUSD: 200, CountsTowardValue: true})
	writeSnapshot("plaid", "2026-06-01", "2026-06-01T10:00:00Z", 100)
	writeSnapshot("plaid", "2026-05-31", "2026-05-31T10:00:00Z", 50)

	svc := &wealth.Service{Store: store, Log: test.Logger}
	first := int32(2)
	page, err := svc.AccountSnapshots(ctx, model.AccountSnapshotsInput{AccountID: account.ID, First: &first})
	must.NoErr(t, err)
	if len(page.Edges) != 2 || page.TotalCount != 4 || !page.PageInfo.HasNextPage || page.PageInfo.HasPreviousPage {
		t.Fatalf("page 1 = %#v", page)
	}
	if page.Edges[0].Node.Date != "2026-06-03" || page.Edges[0].Node.BalanceUsd != 350 {
		t.Fatalf("first edge = %#v, want deduped latest 2026-06-03 balance 350", page.Edges[0])
	}
	if len(page.Edges[0].Node.Holdings) != 1 || page.Edges[0].Node.Holdings[0].Asset.ID != asset.ID {
		t.Fatalf("first edge holdings = %#v", page.Edges[0].Node.Holdings)
	}
	if page.PageInfo.EndCursor == nil {
		t.Fatal("page 1 end cursor is nil")
	}

	next, err := svc.AccountSnapshots(ctx, model.AccountSnapshotsInput{
		AccountID: account.ID,
		First:     &first,
		After:     page.PageInfo.EndCursor,
	})
	must.NoErr(t, err)
	if len(next.Edges) != 2 || next.PageInfo.HasNextPage || !next.PageInfo.HasPreviousPage {
		t.Fatalf("page 2 = %#v", next)
	}
	if next.Edges[0].Node.Date != "2026-06-01" || next.Edges[1].Node.Date != "2026-05-31" {
		t.Fatalf("page 2 edges = %#v", next.Edges)
	}

	owner := test.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "snapshot-page-liability-owner"})
	liability := &model.Account{Owner: owner, Name: "snapshot-page-liability", Type: model.AccountTypeCredit}
	test.MustUpsertAccount(t, store, "snapshot-page-liability", liability)
	must.NoErr(t, store.ReplaceAccountBalanceSnapshot(ctx, wealth.AccountBalanceSnapshot{
		AccountID:  liability.ID.Int64(),
		Source:     "manual",
		Date:       "2026-06-03",
		SyncedAt:   "2026-06-03T12:00:00Z",
		BalanceUSD: 500,
	}))
	liabilityPage, err := svc.AccountSnapshots(ctx, model.AccountSnapshotsInput{AccountID: liability.ID})
	must.NoErr(t, err)
	if len(liabilityPage.Edges) != 1 || liabilityPage.Edges[0].Node.NetContributionUsd != -500 {
		t.Fatalf("liability page = %#v", liabilityPage)
	}
}
