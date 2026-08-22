package accountsdb

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/samber/lo"

	"tallyo/internal/accounts"
	"tallyo/internal/database/dbgen"
	"tallyo/internal/database/dbutil"
	"tallyo/internal/graph/model"
	u "tallyo/internal/utils"
)

func (s *Store) CreateEVMWallet(
	ctx context.Context,
	address string,
	ownerID int64,
	label string,
	chainIDs []string,
) (*model.Connection, *model.Account, error) {
	owner, err := s.OwnerByID(ctx, ownerID)
	if err != nil {
		return nil, nil, fmt.Errorf("lookup owner: %w", err)
	}
	if owner == nil {
		return nil, nil, fmt.Errorf("unknown owner id %d", ownerID)
	}

	name := label
	if name == "" {
		name = truncateAddress(address)
	}

	accountID, err := dbutil.RandomID()
	if err != nil {
		return nil, nil, err
	}
	var connID int64
	var accountRowID int64
	var walletID int64

	if err := s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		newWalletID, err := q.InsertEVMWallet(ctx, dbgen.InsertEVMWalletParams{
			Address:  address,
			Label:    label,
			ChainIds: strings.Join(accounts.NormalizeEVMChainIDs(chainIDs), ","),
		})
		if err != nil {
			return fmt.Errorf("insert evm_wallet: %w", err)
		}
		walletID = newWalletID
		newConnID, err := q.UpsertConnection(ctx, dbgen.UpsertConnectionParams{
			SourceTable: string(accounts.SourceTableEVMWallet),
			SourceID:    walletID,
			Name:        &name,
			OwnerID:     ownerID,
		})
		if err != nil {
			return fmt.Errorf("insert connection: %w", err)
		}
		connID = newConnID
		newAccountID, err := q.InsertLinkedAccount(ctx, dbgen.InsertLinkedAccountParams{
			ExternalID:   accountID,
			ConnectionID: &connID,
			OwnerID:      ownerID,
			Name:         name,
			Type:         string(model.AccountTypeCryptoWallet),
		})
		if err != nil {
			return fmt.Errorf("insert evm account: %w", err)
		}
		accountRowID = newAccountID
		return nil
	}); err != nil {
		return nil, nil, err
	}

	conn := &model.Connection{ID: model.New(model.GlobalIDConnection, connID), Name: &name, Owner: owner, IsActive: true, SourceTable: string(accounts.SourceTableEVMWallet), SourceID: walletID}
	account := &model.Account{
		ID:         model.New(model.GlobalIDAccount, accountRowID),
		Connection: conn,
		Owner:      owner,
		Name:       name,
		Type:       model.AccountTypeCryptoWallet,
		Manual:     false,
	}
	return conn, account, nil
}

func (s *Store) EVMWalletByConnectionID(ctx context.Context, connectionID int64) (*accounts.EVMWallet, error) {
	walletsByConnectionID, err := s.EVMWalletsByConnectionIDs(ctx, []int64{connectionID})
	return dbutil.MapSingle(walletsByConnectionID, err, connectionID)
}

func (s *Store) EVMWalletsByConnectionIDs(ctx context.Context, connectionIDs []int64) (map[int64]*accounts.EVMWallet, error) {
	if len(connectionIDs) == 0 {
		return map[int64]*accounts.EVMWallet{}, nil
	}
	rows, err := s.q.EVMWallets(ctx, dbgen.EVMWalletsParams{ConnectionIds: connectionIDs})
	if err != nil {
		return nil, fmt.Errorf("lookup evm wallets by connection: %w", err)
	}
	toWalletByConnectionID := func(row dbgen.EVMWalletsRow) (int64, *accounts.EVMWallet) {
		wallet := evmWalletFromSQLRow(row)
		return row.ConnectionID, &wallet
	}
	return lo.Associate(rows, toWalletByConnectionID), nil
}

func (s *Store) EVMWalletsDueForBalanceSync(ctx context.Context, now time.Time) ([]accounts.EVMWallet, error) {
	nowUTC := now.UTC()
	rows, err := s.q.EVMWallets(ctx, dbgen.EVMWalletsParams{Now: &nowUTC, DueOnly: true})
	if err != nil {
		return nil, fmt.Errorf("list evm wallets due for balance sync: %w", err)
	}
	return u.Map(rows, evmWalletFromSQLRow), nil
}

func (s *Store) SetEVMWalletBalanceSynced(ctx context.Context, walletID int64, next time.Time) error {
	nextUTC := next.UTC()
	return s.q.SetEVMWalletBalanceSynced(ctx, dbgen.SetEVMWalletBalanceSyncedParams{
		ID:                walletID,
		NextBalanceSyncAt: &nextUTC,
	})
}

func (s *Store) EVMWalletAccountID(ctx context.Context, walletID int64) (int64, error) {
	accountID, err := s.q.EVMWalletAccountID(ctx, dbgen.EVMWalletAccountIDParams{WalletID: walletID})
	identity := func(id int64) int64 { return id }
	return dbutil.MapRow(accountID, err, identity)
}

func (s *Store) DeleteEVMWallet(ctx context.Context, connectionID int64) error {
	wallet, err := s.EVMWalletByConnectionID(ctx, connectionID)
	if err != nil {
		return err
	}
	if wallet == nil {
		return fmt.Errorf("evm wallet for connection %d not found", connectionID)
	}

	return s.WithTx(ctx, func(_ *sql.Tx, q *dbgen.Queries) error {
		if err := q.DeleteAccountsByConnection(ctx, dbgen.DeleteAccountsByConnectionParams{ConnectionID: &connectionID}); err != nil {
			return fmt.Errorf("delete accounts: %w", err)
		}
		if err := q.DeleteConnectionByID(ctx, dbgen.DeleteConnectionByIDParams{ID: connectionID}); err != nil {
			return fmt.Errorf("delete connection: %w", err)
		}
		if err := q.DeleteEVMWallet(ctx, dbgen.DeleteEVMWalletParams{ID: wallet.ID}); err != nil {
			return fmt.Errorf("delete evm_wallet: %w", err)
		}
		return nil
	})
}

func evmWalletFromSQLRow(row dbgen.EVMWalletsRow) accounts.EVMWallet {
	return accounts.EVMWallet{
		ID:                row.ID,
		Address:           row.Address,
		ChainIDs:          dbutil.SplitCSV(row.ChainIds),
		OwnerID:           row.OwnerID,
		Label:             row.Label,
		CreatedAt:         row.CreatedAt,
		NextBalanceSyncAt: row.NextBalanceSyncAt,
	}
}

func truncateAddress(addr string) string {
	if len(addr) <= 10 {
		return addr
	}
	return addr[:6] + "…" + addr[len(addr)-4:]
}
