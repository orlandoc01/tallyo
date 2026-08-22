package accountsdb

import (
	"context"
	"slices"
	"testing"
	"time"

	"tallyo/internal/accounts"
	"tallyo/internal/database/dbtest"
	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
)

func openEVMWalletStore(t *testing.T) *Store {
	t.Helper()
	return New(dbtest.Open(t))
}

func mustEVMWalletByConnectionID(t *testing.T, store *Store, connectionID int64) *accounts.EVMWallet {
	t.Helper()
	wallet, err := store.EVMWalletByConnectionID(context.Background(), connectionID)
	must.NoErr(t, err)
	return wallet
}

func mustEVMWalletsDueForBalanceSync(t *testing.T, store *Store, now time.Time) []accounts.EVMWallet {
	t.Helper()
	wallets, err := store.EVMWalletsDueForBalanceSync(context.Background(), now)
	must.NoErr(t, err)
	return wallets
}

func TestEVMWalletCRUD(t *testing.T) {
	ctx := context.Background()
	s := openEVMWalletStore(t)

	owner := test.MustCreateOwner(t, s, model.CreateOwnerInput{Name: "walletowner"})

	const addr = "0xf7462c16f1eea90bc62cee10b4c66c656a752e18"

	conn, account, err := s.CreateEVMWallet(ctx, addr, owner.ID.Int64(), "My Wallet", []string{"eth", "base"})
	must.NoErr(t, err)
	if conn == nil || conn.ID.Int64() == 0 {
		t.Fatal("CreateEVMWallet returned nil/empty connection")
	}
	if account == nil || account.ID.Int64() == 0 {
		t.Fatal("CreateEVMWallet returned nil/empty account")
	}
	if account.Name != "My Wallet" {
		t.Errorf("account name = %q, want 'My Wallet'", account.Name)
	}
	if account.Type != model.AccountTypeCryptoWallet {
		t.Errorf("account type = %q, want CRYPTO_WALLET", account.Type)
	}

	wallet := mustEVMWalletByConnectionID(t, s, conn.ID.Int64())
	if wallet == nil {
		t.Fatal("EVMWalletByConnectionID returned nil")
	}
	if wallet.Address != addr {
		t.Errorf("wallet address = %q, want %q", wallet.Address, addr)
	}
	if wallet.Label != "My Wallet" {
		t.Errorf("wallet label = %q, want 'My Wallet'", wallet.Label)
	}
	if !slices.Equal(wallet.ChainIDs, []string{"base", "eth"}) {
		t.Errorf("wallet chain IDs = %v, want [base eth]", wallet.ChainIDs)
	}
	_, err = s.UpdateConnection(ctx, accounts.UpdateConnectionInput{ConnectionID: conn.ID.Int64(), EVMChainIDs: []string{"op", "arb", "op"}})
	must.NoErr(t, err)
	wallet, err = s.EVMWalletByConnectionID(ctx, conn.ID.Int64())
	if err != nil || !slices.Equal(wallet.ChainIDs, []string{"arb", "op"}) {
		t.Fatalf("wallet after chain update = %#v, %v", wallet, err)
	}

	missing := mustEVMWalletByConnectionID(t, s, 999)
	if missing != nil {
		t.Error("expected nil for unknown connection ID")
	}

	accountID, err := s.EVMWalletAccountID(ctx, wallet.ID)
	must.NoErr(t, err)
	wantAccountID := account.ID.Int64()
	if accountID != wantAccountID {
		t.Errorf("EVMWalletAccountID = %d, want %d", accountID, wantAccountID)
	}

	emptyID, err := s.EVMWalletAccountID(ctx, 999)
	must.NoErr(t, err)
	if emptyID != 0 {
		t.Errorf("EVMWalletAccountID for missing wallet = %d, want 0", emptyID)
	}

	must.NoErr(t, s.DeleteEVMWallet(ctx, conn.ID.Int64()))

	deleted := mustEVMWalletByConnectionID(t, s, conn.ID.Int64())
	if deleted != nil {
		t.Error("expected nil after deletion")
	}
}

func TestCreateEVMWalletDefaultLabel(t *testing.T) {
	ctx := context.Background()
	s := openEVMWalletStore(t)

	owner := test.MustCreateOwner(t, s, model.CreateOwnerInput{Name: "noLabel"})
	_, account, err := s.CreateEVMWallet(ctx, "0xaabbccddeeaabbccddeeaabbccddeeaabbccddee", owner.ID.Int64(), "", []string{"eth"})
	must.NoErr(t, err)
	if account.Name == "" {
		t.Error("account name should not be empty when label is omitted")
	}
	if account.Name != "0xaabb…ddee" {
		t.Errorf("account name = %q, want '0xaabb…ddee'", account.Name)
	}
}

func TestTruncateAddress(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{"0x1234567890abcdef1234", "0x1234…1234"},
		{"short", "short"},
		{"0x12345678901234567890", "0x1234…7890"},
	}
	for _, tc := range cases {
		got := truncateAddress(tc.input)
		if got != tc.want {
			t.Errorf("truncateAddress(%q) = %q, want %q", tc.input, got, tc.want)
		}
	}
}

func TestDeleteEVMWalletNotFound(t *testing.T) {
	ctx := context.Background()
	s := openEVMWalletStore(t)
	err := s.DeleteEVMWallet(ctx, 999)
	if err == nil {
		t.Error("expected error deleting nonexistent wallet, got nil")
	}
}

func TestCreateEVMWalletUnknownOwner(t *testing.T) {
	ctx := context.Background()
	s := openEVMWalletStore(t)
	_, _, err := s.CreateEVMWallet(ctx, "0xaaaa", 999, "", []string{"eth"})
	if err == nil {
		t.Error("expected error creating wallet with unknown owner, got nil")
	}
}

func TestEVMWalletBalanceSyncScheduling(t *testing.T) {
	ctx := context.Background()
	s := openEVMWalletStore(t)

	owner := test.MustCreateOwner(t, s, model.CreateOwnerInput{Name: "scheduleowner"})
	conn, _, err := s.CreateEVMWallet(ctx, "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead", owner.ID.Int64(), "Scheduled", []string{"eth"})
	must.NoErr(t, err)
	wallet := mustEVMWalletByConnectionID(t, s, conn.ID.Int64())
	if wallet.NextBalanceSyncAt != nil {
		t.Error("expected NextBalanceSyncAt to be nil for a newly created wallet")
	}

	now := time.Now().UTC()
	due := mustEVMWalletsDueForBalanceSync(t, s, now)
	if len(due) != 1 {
		t.Fatalf("EVMWalletsDueForBalanceSync count = %d, want 1 (nil next_balance_sync_at is due immediately)", len(due))
	}

	future := now.Add(24 * time.Hour)
	must.NoErr(t, s.SetEVMWalletBalanceSynced(ctx, wallet.ID, future))
	due = mustEVMWalletsDueForBalanceSync(t, s, now)
	if len(due) != 0 {
		t.Fatalf("EVMWalletsDueForBalanceSync count = %d, want 0 after scheduling a future sync", len(due))
	}

	past := now.Add(-time.Minute)
	must.NoErr(t, s.SetEVMWalletBalanceSynced(ctx, wallet.ID, past))
	due = mustEVMWalletsDueForBalanceSync(t, s, now)
	if len(due) != 1 {
		t.Fatalf("EVMWalletsDueForBalanceSync count = %d, want 1 once next_balance_sync_at is reached", len(due))
	}

	inactive := false
	if _, err := s.UpdateConnection(ctx, accounts.UpdateConnectionInput{ConnectionID: conn.ID.Int64(), IsActive: &inactive}); err != nil {
		t.Fatalf("UpdateConnection(inactive): %v", err)
	}
	due = mustEVMWalletsDueForBalanceSync(t, s, now)
	if len(due) != 0 {
		t.Fatalf("EVMWalletsDueForBalanceSync count = %d, want 0 for inactive connection", len(due))
	}

	active := true
	if _, err := s.UpdateConnection(ctx, accounts.UpdateConnectionInput{ConnectionID: conn.ID.Int64(), IsActive: &active}); err != nil {
		t.Fatalf("UpdateConnection(active): %v", err)
	}

	accountID, err := s.EVMWalletAccountID(ctx, wallet.ID)
	must.NoErr(t, err)
	closed := true
	if _, err := s.UpdateAccount(ctx, accountID, model.UpdateAccountInput{Closed: &closed}); err != nil {
		t.Fatalf("UpdateAccount(closed): %v", err)
	}
	due = mustEVMWalletsDueForBalanceSync(t, s, now)
	if len(due) != 0 {
		t.Fatalf("EVMWalletsDueForBalanceSync count = %d, want 0 once the linked account is closed", len(due))
	}
}

func TestCreateEVMWalletDuplicateAddress(t *testing.T) {
	ctx := context.Background()
	s := openEVMWalletStore(t)
	owner := test.MustCreateOwner(t, s, model.CreateOwnerInput{Name: "dupuser"})
	const addr = "0xcccccccccccccccccccccccccccccccccccccccc"
	if _, _, err := s.CreateEVMWallet(ctx, addr, owner.ID.Int64(), "First", []string{"eth"}); err != nil {
		t.Fatalf("first CreateEVMWallet: %v", err)
	}
	_, _, err := s.CreateEVMWallet(ctx, addr, owner.ID.Int64(), "Second", []string{"eth"})
	if err == nil {
		t.Error("expected error creating wallet with duplicate address, got nil")
	}
}
