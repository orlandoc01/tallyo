package graph

import (
	"context"
	"errors"
	"tallyo/internal/utils/must"
	"testing"
)

func TestBatchByKeyPreservesOrderAndZerosMissingKeys(t *testing.T) {
	batch := batchByKey(func(ctx context.Context, keys []string) (map[string]int, error) {
		return map[string]int{"b": 2, "a": 1}, nil
	})

	results := batch(context.Background(), []string{"b", "missing", "a"})
	if len(results) != 3 {
		t.Fatalf("results len = %d, want 3", len(results))
	}
	if results[0].Data != 2 || results[0].Error != nil {
		t.Fatalf("results[0] = %#v, want b=2", results[0])
	}
	if results[1].Data != 0 || results[1].Error != nil {
		t.Fatalf("results[1] = %#v, want zero missing result", results[1])
	}
	if results[2].Data != 1 || results[2].Error != nil {
		t.Fatalf("results[2] = %#v, want a=1", results[2])
	}
}

func TestBatchByKeyFansOutFetchError(t *testing.T) {
	fetchErr := errors.New("fetch failed")
	batch := batchByKey(func(ctx context.Context, keys []int32) (map[int32]string, error) {
		return nil, fetchErr
	})

	results := batch(context.Background(), []int32{2, 1})
	if len(results) != 2 {
		t.Fatalf("results len = %d, want 2", len(results))
	}
	for i, result := range results {
		if !errors.Is(result.Error, fetchErr) || result.Data != "" {
			t.Fatalf("results[%d] = %#v, want fetch error and zero data", i, result)
		}
	}
}

func TestNewLoaderClearsCompletedBatchCache(t *testing.T) {
	var calls int
	loader := newLoader(func(_ context.Context, keys []int) (map[int]int, error) {
		calls++
		return map[int]int{keys[0]: calls}, nil
	})

	first, err := loader.Load(context.Background(), 7)()
	must.NoErr(t, err)
	second, err := loader.Load(context.Background(), 7)()
	must.NoErr(t, err)
	if first != 1 || second != 2 || calls != 2 {
		t.Fatalf("loads = (%d, %d), calls = %d; want refetch after completed batch", first, second, calls)
	}
}
