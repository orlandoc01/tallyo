package utils

import (
	"errors"
	"slices"
	"tallyo/internal/utils/must"
	"testing"
)

func TestMap(t *testing.T) {
	got := Map([]int{1, 2, 3}, func(v int) int { return v * 2 })
	want := []int{2, 4, 6}
	if !slices.Equal(got, want) {
		t.Fatalf("Map() = %v, want %v", got, want)
	}
}

func TestMapEmpty(t *testing.T) {
	got := Map([]int{}, func(v int) int { return v })
	if len(got) != 0 {
		t.Fatalf("Map(empty) = %v, want empty", got)
	}
}

func TestMapErr(t *testing.T) {
	got, err := MapErr([]int{1, 2, 3}, func(v int) (int, error) { return v * 2, nil })
	must.NoErr(t, err)
	want := []int{2, 4, 6}
	if !slices.Equal(got, want) {
		t.Fatalf("MapErr() = %v, want %v", got, want)
	}
}

func TestMapErrPropagatesError(t *testing.T) {
	wantErr := errors.New("boom")
	got, err := MapErr([]int{1, 2, 3}, func(v int) (int, error) {
		if v == 2 {
			return 0, wantErr
		}
		return v, nil
	})
	if !errors.Is(err, wantErr) {
		t.Fatalf("MapErr() error = %v, want %v", err, wantErr)
	}
	if got != nil {
		t.Fatalf("MapErr() result = %v, want nil on error", got)
	}
}
