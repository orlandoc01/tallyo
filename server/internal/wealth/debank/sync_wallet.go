package debank

import (
	"context"
	"fmt"
	"sync"
	"time"

	"tallyo/internal/accounts"
	"tallyo/internal/wealth"
	"tallyo/internal/wealth/syncerids"
)

// walletSyncStagger spaces out the start of each wallet's sync within a
// batch so concurrent wallets don't all hit the Debank API at once and
// trigger 429s.
const walletSyncStagger = 2 * time.Second

const walletSyncMaxConcurrent = 4

func (s *Adapter) Handles(_ context.Context, conn wealth.ConnectionRef) (bool, error) {
	return conn.SourceTable == accounts.SourceTableEVMWallet, nil
}

// SyncDue syncs EVM wallets whose next balance sync time is due now.
func (s *Adapter) SyncDue(ctx context.Context, sink wealth.PersistSink) error {
	wallets, err := s.Wallets.EVMWalletsDueForBalanceSync(ctx, s.now())
	if err != nil {
		return fmt.Errorf("list evm wallets due for balance sync: %w", err)
	}
	cron, err := s.Schedules.BalanceSyncScheduleCron(ctx, syncerids.Debank)
	if err != nil {
		return err
	}
	s.syncWallets(ctx, wallets, cron, sink)
	return nil
}

func (s *Adapter) syncWallets(ctx context.Context, wallets []accounts.EVMWallet, cron string, sink wealth.PersistSink) {
	var wg sync.WaitGroup
	semaphore := make(chan struct{}, walletSyncMaxConcurrent)

	for _, wallet := range wallets {
		select {
		case semaphore <- struct{}{}:
		case <-ctx.Done():
			wg.Wait()
			return
		}
		wg.Go(func() {
			defer func() { <-semaphore }()
			if err := s.SyncWalletInto(ctx, wallet, cron, sink); err != nil {
				s.Log.Error("evmchain: sync wallet failed", "address", wallet.Address, "error", err)
			}
		})
		if err := s.SleepBeforeContinue(ctx, walletSyncStagger); err != nil {
			break
		}
	}
	wg.Wait()
}

func (s *Adapter) SyncConnectionInto(
	ctx context.Context,
	conn wealth.ConnectionRef,
	sink wealth.PersistSink,
) error {
	return wealth.SyncConnectionVia(ctx, sink, "evm wallet for connection", conn.ConnectionID, s.Wallets.EVMWalletByConnectionID, func(ctx context.Context) (string, error) {
		return s.Schedules.BalanceSyncScheduleCron(ctx, syncerids.Debank)
	}, s.SyncWalletInto)
}

func (s *Adapter) SyncWalletInto(ctx context.Context, wallet accounts.EVMWallet, cron string, sink wealth.PersistSink) error {
	accountID, err := s.Wallets.EVMWalletAccountID(ctx, wallet.ID)
	if err != nil {
		return err
	}
	if accountID == 0 {
		return fmt.Errorf("no account found for evm wallet %d", wallet.ID)
	}
	var syncedAt time.Time
	if err := wealth.WithPersist(ctx, sink, func(events chan<- wealth.PersistEvent) error {
		var pendingSince time.Time
		var retryCount int32
		for {
			eval, err := s.evaluateWalletSnapshot(ctx, wallet, accountID, sink.Today())
			if err != nil {
				return err
			}
			if eval.anomalyReason == "" {
				s.emitWalletSnapshot(eval, events)
				syncedAt = eval.syncedAt
				return nil
			}
			matches, err := s.ApprovedReviewMatches(ctx, eval.accountID, eval.snapshot.BalanceUSD)
			if err != nil {
				return err
			}
			if matches {
				wealth.EmitApprovedCarryForward(eval.snapshot, eval.prior, eval.anomalyReason, events)
				syncedAt = eval.syncedAt
				return nil
			}

			if pendingSince.IsZero() {
				pendingSince = eval.syncedAt
			}
			deadline := pendingSince.Add(flagRetryWindow)
			if !eval.syncedAt.Before(deadline) {
				if err := s.emitFlaggedSnapshot(eval, events); err != nil {
					return err
				}
				syncedAt = eval.syncedAt
				return nil
			}

			delay := nextFlagRetryDelay(retryCount)
			retryCount++
			remaining := deadline.Sub(eval.syncedAt)
			delay = min(delay, remaining)
			s.Log.Warn("evmchain: snapshot deviation detected, retrying after backoff",
				"address", wallet.Address,
				"new_usd", eval.snapshot.BalanceUSD,
				"carry_usd", eval.prior.AmountUSD,
				"reason", eval.anomalyReason,
				"retry_count", retryCount,
				"next_retry_at", eval.syncedAt.Add(delay),
				"deadline", deadline,
			)
			if err := s.SleepBeforeContinue(ctx, delay); err != nil {
				return err
			}
		}
	}); err != nil {
		s.Log.Warn("evmchain: persist wallet snapshot failed", "address", wallet.Address, "error", err)
		return err
	}
	return s.scheduleNextSync(ctx, wallet, cron, syncedAt)
}

func (s *Adapter) scheduleNextSync(ctx context.Context, wallet accounts.EVMWallet, cron string, now time.Time) error {
	next, err := wealth.NextBalanceSyncAfter(cron, now)
	if err != nil {
		return fmt.Errorf("compute next balance sync: %w", err)
	}
	if err := s.Wallets.SetEVMWalletBalanceSynced(ctx, wallet.ID, next); err != nil {
		return fmt.Errorf("set balance synced: %w", err)
	}
	return nil
}
