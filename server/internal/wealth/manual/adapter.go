package manual

import (
	"context"

	"tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"
)

var _ wealth.SyncAdapter = (*Service)(nil)

func (s *Service) Handles(context.Context, wealth.ConnectionRef) (bool, error) {
	// Manual accounts are not connection-backed, so account-created events never
	// target this adapter. They still participate in scheduled syncs.
	return false, nil
}

func (s *Service) Source() syncerids.ID {
	return syncerids.Manual
}

func (s *Service) SyncConnectionInto(
	context.Context,
	wealth.ConnectionRef,
	wealth.PersistSink,
) error {
	return nil
}

func (s *Service) SyncDue(ctx context.Context, sink wealth.PersistSink) error {
	return wealth.RunScheduledBalanceSync(ctx, s.Store, syncerids.Manual, sink.Now(), func() error {
		return s.emitManualSnapshots(ctx, sink)
	})
}
