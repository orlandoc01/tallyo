package wealthdb

import (
	"context"
	"testing"
	"time"

	"tallyo/internal/utils/must"
	"tallyo/internal/wealth/syncerids"
)

func TestBalanceSyncScheduleHelpers(t *testing.T) {
	ctx := context.Background()
	store := testDB(t)
	now := time.Date(2026, 1, 1, 20, 0, 0, 0, time.UTC)

	cron, due, err := store.BalanceSyncScheduleDue(ctx, syncerids.Manual, now)
	must.NoErr(t, err)
	if !due || cron != "30 16 * * *" {
		t.Fatalf("BalanceSyncScheduleDue(null) = %q, %v; want default due", cron, due)
	}

	future := now.Add(24 * time.Hour)
	must.NoErr(t, store.SetBalanceSyncScheduleSynced(ctx, syncerids.Manual, future))
	cron, due, err = store.BalanceSyncScheduleDue(ctx, syncerids.Manual, now)
	must.NoErr(t, err)
	if due || cron != "" {
		t.Fatalf("BalanceSyncScheduleDue(future) = %q, %v; want not due", cron, due)
	}

	cron, err = store.BalanceSyncScheduleCron(ctx, syncerids.Manual)
	must.NoErr(t, err)
	if cron != "30 16 * * *" {
		t.Fatalf("BalanceSyncScheduleCron = %q, want default cron", cron)
	}

	providerCrons := map[syncerids.ID]string{
		syncerids.Plaid:     "30 16 * * 1-5",
		syncerids.SimpleFin: "30 16 * * 1-5",
		syncerids.Debank:    "30 16 * * *",
	}
	for id, want := range providerCrons {
		cron, err := store.BalanceSyncScheduleCron(ctx, id)
		must.NoErr(t, err)
		if cron != want {
			t.Fatalf("BalanceSyncScheduleCron(%s) = %q, want %q", id, cron, want)
		}
	}
}
