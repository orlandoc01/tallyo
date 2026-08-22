package dbutil_test

import (
	"database/sql"
	"errors"
	"fmt"
	"testing"

	"tallyo/internal/database/dbutil"
)

// Pull exported names into scope for brevity.
var (
	IsUniqueConstraintViolation = dbutil.IsUniqueConstraintViolation
	RandomID                    = dbutil.RandomID
	SplitCSV                    = dbutil.SplitCSV
	UsesFTS                     = dbutil.UsesFTS
	FTSQuery                    = dbutil.FTSQuery
	FTSPrefixQuery              = dbutil.FTSPrefixQuery
)

func TestIsUniqueConstraintViolation(t *testing.T) {
	if !IsUniqueConstraintViolation(fmt.Errorf("UNIQUE constraint failed: users.email")) {
		t.Error("expected true for UNIQUE constraint error")
	}
	if IsUniqueConstraintViolation(fmt.Errorf("some other error")) {
		t.Error("expected false for non-constraint error")
	}
}

func TestRandomID(t *testing.T) {
	id1, err := RandomID()
	if err != nil || len(id1) != 32 {
		t.Fatalf("RandomID() = %q, %v", id1, err)
	}
	id2, _ := RandomID()
	if id1 == id2 {
		t.Error("RandomID returned the same value twice")
	}
}

func TestSplitCSV(t *testing.T) {
	if got := SplitCSV(""); len(got) != 0 {
		t.Errorf("SplitCSV(\"\") = %v", got)
	}
	if got := SplitCSV("a,b,c"); len(got) != 3 || got[1] != "b" {
		t.Errorf("SplitCSV = %v", got)
	}
}

func TestMapRow(t *testing.T) {
	mapper := func(value int) *int { return new(value) }
	if got, err := dbutil.MapRow(1, sql.ErrNoRows, mapper); got != nil || err != nil {
		t.Fatalf("MapRow missing row = %v, %v", got, err)
	}
	wantErr := fmt.Errorf("query failed")
	if _, err := dbutil.MapRow(1, wantErr, mapper); !errors.Is(err, wantErr) {
		t.Fatalf("MapRow error = %v, want %v", err, wantErr)
	}
	if got, err := dbutil.MapRow(1, nil, mapper); err != nil || got == nil || *got != 1 {
		t.Fatalf("MapRow success = %v, %v", got, err)
	}
}

func TestMapFirstRow(t *testing.T) {
	mapper := func(value int) *int { return new(value) }
	if got, err := dbutil.MapFirstRow([]int{}, nil, mapper); got != nil || err != nil {
		t.Fatalf("MapFirstRow empty = %v, %v", got, err)
	}
	wantErr := fmt.Errorf("query failed")
	if _, err := dbutil.MapFirstRow([]int{1}, wantErr, mapper); !errors.Is(err, wantErr) {
		t.Fatalf("MapFirstRow error = %v, want %v", err, wantErr)
	}
	if got, err := dbutil.MapFirstRow([]int{1, 2}, nil, mapper); err != nil || got == nil || *got != 1 {
		t.Fatalf("MapFirstRow success = %v, %v", got, err)
	}
}

func TestFirstRow(t *testing.T) {
	if _, err := dbutil.FirstRow([]int{}, nil); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("FirstRow empty error = %v", err)
	}
	wantErr := fmt.Errorf("query failed")
	if _, err := dbutil.FirstRow([]int{1}, wantErr); !errors.Is(err, wantErr) {
		t.Fatalf("FirstRow error = %v, want %v", err, wantErr)
	}
	if got, err := dbutil.FirstRow([]int{1, 2}, nil); err != nil || got != 1 {
		t.Fatalf("FirstRow success = %v, %v", got, err)
	}
}

func TestSearchHelpers(t *testing.T) {
	if !UsesFTS("blue bottle") {
		t.Fatal("expected FTS for terms with at least three runes")
	}
	if UsesFTS("us gas") {
		t.Fatal("expected literal substring fallback when any term is shorter than three runes")
	}
	if got := FTSQuery(`bottle blue "reserve"`); got != `"bottle" AND "blue" AND """reserve"""` {
		t.Fatalf("FTSQuery = %q", got)
	}
	if got := FTSPrefixQuery(`bottle blue "reserve"`); got != `"bottle"* AND "blue"* AND """reserve"""*` {
		t.Fatalf("FTSPrefixQuery = %q", got)
	}
}
