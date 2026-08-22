package transactionsdb_test

import (
	"context"
	"testing"

	"tallyo/internal/utils/must"
)

func TestStageUncategorizedForLLM(t *testing.T) {
	ctx := context.Background()
	_, store := openSeededTestStore(t)
	mustUpsertSynced(t, store, syncedTxn("unstaged", 10, "2026-05-10T12:00:00Z", "Unstaged"))
	mustUpsertSynced(t, store, syncedTxn("reviewed", 20, "2026-05-11T12:00:00Z", "Reviewed"))
	alreadyStaged := syncedTxn("already-staged", 30, "2026-05-12T12:00:00Z", "Already staged")
	alreadyStaged.StageForLLM = true
	mustUpsertSynced(t, store, alreadyStaged)
	_, err := store.SQL().ExecContext(ctx, `UPDATE transactions SET is_reviewed = 1 WHERE external_id = ?`, "reviewed")
	must.NoErr(t, err)
	count, err := store.CountStagedForLLM(ctx)
	must.NoErr(t, err)
	if count != 1 {
		t.Fatalf("CountStagedForLLM() before staging = %d, want 1", count)
	}

	stagedCount, err := store.StageUncategorizedForLLM(ctx)
	must.NoErr(t, err)
	if stagedCount != 1 {
		t.Fatalf("StageUncategorizedForLLM() = %d, want 1", stagedCount)
	}
	count, err = store.CountStagedForLLM(ctx)
	must.NoErr(t, err)
	if count != 2 {
		t.Fatalf("CountStagedForLLM() after staging = %d, want 2", count)
	}

	for externalID, wantStaged := range map[string]bool{
		"unstaged":       true,
		"reviewed":       false,
		"already-staged": true,
	} {
		var staged bool
		must.NoErr(t, store.SQL().QueryRowContext(ctx, `SELECT staged_for_llm FROM transactions WHERE external_id = ?`, externalID).Scan(&staged))
		if staged != wantStaged {
			t.Errorf("%s staged_for_llm = %t, want %t", externalID, staged, wantStaged)
		}
	}
}
