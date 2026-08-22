package database

import (
	"context"
	"path/filepath"
	"testing"

	"tallyo/internal/database/dbgen"
	"tallyo/internal/utils/must"
)

func TestSeedReferenceCategoriesSkipsWhenSentinelExists(t *testing.T) {
	ctx := context.Background()
	db := mustOpenDB(t, ctx, filepath.Join(t.TempDir(), "tallyo.db"), "")
	t.Cleanup(func() { _ = db.Close() })

	q := dbgen.New(db.SQL())
	sentinelCount, err := q.CountSentinelCategories(ctx)
	must.NoErr(t, err)
	if sentinelCount != 1 {
		t.Fatalf("CountSentinelCategories() = %d, want 1", sentinelCount)
	}

	categoryCount, err := q.CountNonSentinelCategories(ctx)
	must.NoErr(t, err)
	if categoryCount == 0 {
		t.Fatalf("CountNonSentinelCategories() = %d, want seeded categories", categoryCount)
	}

	if _, err := db.SQL().ExecContext(ctx, "DELETE FROM plaid_category_mappings WHERE plaid_detailed = 'OTHER_OTHER'"); err != nil {
		t.Fatalf("delete sentinel mapping: %v", err)
	}
	must.NoErr(t, db.seedReferenceCategories(ctx))

	var mappingCount int64
	must.NoErr(t, db.SQL().QueryRowContext(ctx, "SELECT COUNT(*) FROM plaid_category_mappings WHERE plaid_detailed = 'OTHER_OTHER'").Scan(&mappingCount))
	if mappingCount != 0 {
		t.Fatalf("sentinel mapping count after reseed = %d, want 0", mappingCount)
	}

	categoryCountAfter, err := q.CountNonSentinelCategories(ctx)
	must.NoErr(t, err)
	if categoryCountAfter != categoryCount {
		t.Fatalf("CountNonSentinelCategories() after reseed = %d, want %d", categoryCountAfter, categoryCount)
	}
}
