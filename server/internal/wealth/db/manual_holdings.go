package wealthdb

import (
	"context"
)

func (s *Store) ManualSnapshotAccountIDs(ctx context.Context) ([]int64, error) {
	return s.q.ManualSnapshotAccountIDs(ctx)
}
