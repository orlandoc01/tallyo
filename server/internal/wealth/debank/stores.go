package debank

import (
	"context"
	"time"

	"tallyo/internal/accounts"
	"tallyo/internal/wealth/syncerids"
)

type WalletStore interface {
	EVMWalletsDueForBalanceSync(ctx context.Context, now time.Time) ([]accounts.EVMWallet, error)
	EVMWalletByConnectionID(ctx context.Context, connectionID int64) (*accounts.EVMWallet, error)
	EVMWalletAccountID(ctx context.Context, walletID int64) (int64, error)
	SetEVMWalletBalanceSynced(ctx context.Context, walletID int64, next time.Time) error
}

type ScheduleStore interface {
	BalanceSyncScheduleCron(ctx context.Context, id syncerids.ID) (string, error)
}
