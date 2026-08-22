package accountsdb_test

import (
	"context"
	"testing"

	"tallyo/internal/accounts"
	accountsdb "tallyo/internal/accounts/db"
	"tallyo/internal/database/dbtest"
	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
)

func openTestStore(tb testing.TB) *accountsdb.Store {
	tb.Helper()
	return accountsdb.New(dbtest.Open(tb))
}

func TestOwnerCRUD(t *testing.T) {
	ctx := context.Background()
	db := dbtest.Open(t)
	s := accountsdb.New(db)

	owners, err := s.Owners(ctx)
	must.NoErr(t, err)
	if len(owners) != 0 {
		t.Fatalf("expected empty owners, got %d", len(owners))
	}

	owner, err := s.CreateOwner(ctx, model.CreateOwnerInput{Name: "alex"})
	if err != nil || owner == nil || owner.Name != "alex" {
		t.Fatalf("CreateOwner(): %v, %v", owner, err)
	}

	got, err := s.OwnerByID(ctx, owner.ID.Int64())
	if err != nil || got == nil || got.Name != "alex" {
		t.Fatalf("OwnerByID(): %v, %v", got, err)
	}

	owners, err = s.Owners(ctx)
	if err != nil || len(owners) != 1 || owners[0].Name != "alex" {
		t.Fatalf("Owners() after create: %v, %v", owners, err)
	}

	missing, err := s.OwnerByID(ctx, 999)
	if err != nil || missing != nil {
		t.Fatalf("OwnerByID missing: %v, %v", missing, err)
	}

	deleted, err := s.DeleteOwner(ctx, owner.ID.Int64())
	if err != nil || !deleted {
		t.Fatalf("DeleteOwner(): %v, %v", deleted, err)
	}

	owners, _ = s.Owners(ctx)
	if len(owners) != 0 {
		t.Fatal("expected empty owners after delete")
	}
}

func TestConnectionCRUD(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	conns, err := s.Connections(ctx, false)
	must.NoErr(t, err)
	if len(conns) != 0 {
		t.Fatalf("expected empty connections")
	}

	owner := test.MustCreateOwner(t, s, model.CreateOwnerInput{Name: "alex"})
	connectionName := "Institution"
	conn, err := s.CreateConnection(ctx, 123, &connectionName, owner.ID.Int64())
	if err != nil || conn == nil {
		t.Fatalf("CreateConnection(): %v, %v", conn, err)
	}
	if !conn.IsActive {
		t.Error("expected connection to be active")
	}

	byID, err := s.ConnectionByID(ctx, conn.ID.Int64())
	if err != nil || byID == nil {
		t.Fatalf("ConnectionByID(): %v, %v", byID, err)
	}

	byItem, err := s.ConnectionByPlaidItemID(ctx, 123)
	if err != nil || byItem == nil {
		t.Fatalf("ConnectionByPlaidItemID(): %v, %v", byItem, err)
	}

	missing, err := s.ConnectionByID(ctx, 999)
	if err != nil || missing != nil {
		t.Fatalf("ConnectionByID missing: %v, %v", missing, err)
	}

	inactive := false
	updated, err := s.UpdateConnection(ctx, accounts.UpdateConnectionInput{ConnectionID: conn.ID.Int64(), IsActive: &inactive})
	if err != nil || updated == nil || updated.IsActive {
		t.Fatalf("UpdateConnection(): %v, %v", updated, err)
	}

	deleted, err := s.DeleteConnection(ctx, conn.ID.Int64())
	if err != nil || !deleted {
		t.Fatalf("DeleteConnection(): %v, %v", deleted, err)
	}
}

func TestAccountUpsertAndQuery(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	owner := test.MustCreateOwner(t, s, model.CreateOwnerInput{Name: "sam"})
	connectionName := "Institution"
	conn := test.MustCreateConnection(t, s, 123, &connectionName, owner.ID.Int64())

	acc := &model.Account{
		Connection: conn,
		Owner:      owner,
		Name:       "Checking",
		Type:       model.AccountTypeDepository,
	}
	test.MustUpsertAccount(t, s, "acc-1", acc, "UpsertAccount(): %v")

	accounts, err := s.Accounts(ctx)
	if err != nil || len(accounts) != 1 || accounts[0].Name != "Checking" {
		t.Fatalf("Accounts(): %v, %v", accounts, err)
	}

	byItem, err := s.AccountsByItem(ctx, 123)
	if err != nil || len(byItem) != 1 {
		t.Fatalf("AccountsByItem(): %v, %v", byItem, err)
	}

	accountID := acc.ID.Int64()
	byID, err := s.AccountByID(ctx, accountID)
	if err != nil || byID == nil {
		t.Fatalf("AccountByID(): %v, %v", byID, err)
	}

	hidden, err := s.HiddenAccountIDsByConnection(ctx, conn.ID.Int64())
	must.NoErr(t, err)
	if hidden["acc-1"] {
		t.Error("expected acc-1 not hidden")
	}
}

func TestCreateManualAccount(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	owner := test.MustCreateOwner(t, s, model.CreateOwnerInput{Name: "alex"})

	account, err := s.CreateManualAccount(ctx, model.CreateManualAccountInput{
		Name:    "Cash",
		OwnerID: owner.ID,
		Type:    model.AccountTypeDepository,
	})
	if err != nil || account == nil || account.Name != "Cash" {
		t.Fatalf("CreateManualAccount(): %v, %v", account, err)
	}

	accountID := account.ID.Int64()
	removed, err := s.RemoveManualAccount(ctx, accountID)
	if err != nil || !removed {
		t.Fatalf("RemoveManualAccount(): %v, %v", removed, err)
	}
}

func TestUpdateAccount(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	owner := test.MustCreateOwner(t, s, model.CreateOwnerInput{Name: "alex"})
	acc := &model.Account{Owner: owner, Name: "Savings", Type: model.AccountTypeDepository}
	test.MustUpsertAccount(t, s, "acc-upd", acc)

	accountID := acc.ID.Int64()
	newName := "Updated Savings"
	hidden := true
	updated, err := s.UpdateAccount(ctx, accountID, model.UpdateAccountInput{Name: &newName, Hidden: &hidden})
	if err != nil || updated == nil || updated.Name != newName || !updated.Hidden {
		t.Fatalf("UpdateAccount(): %v, %v", updated, err)
	}
}

func TestAccountNeedsReviewLifecycle(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	owner := test.MustCreateOwner(t, s, model.CreateOwnerInput{Name: "alex"})

	flagged := &model.Account{Owner: owner, Name: "Mystery", Type: model.AccountTypeCredit, NeedsReview: true}
	test.MustUpsertAccount(t, s, "needs-review", flagged, "UpsertAccount(needs-review): %v")
	stored, err := s.AccountByID(ctx, flagged.ID.Int64())
	if err != nil || !stored.NeedsReview {
		t.Fatalf("flagged account = %#v, %v", stored, err)
	}

	typeInput := model.AccountTypeCredit
	stored, err = s.UpdateAccount(ctx, flagged.ID.Int64(), model.UpdateAccountInput{Type: &typeInput})
	if err != nil || stored.NeedsReview {
		t.Fatalf("UpdateAccount(confirm type) = %#v, %v", stored, err)
	}

	flagged.Name = "Mystery renamed by provider"
	flagged.NeedsReview = true
	test.MustUpsertAccount(t, s, "needs-review", flagged, "UpsertAccount(re-sync): %v")
	stored, err = s.AccountByID(ctx, flagged.ID.Int64())
	if err != nil || stored.NeedsReview {
		t.Fatalf("re-synced account = %#v, %v", stored, err)
	}

	stillFlagged := &model.Account{Owner: owner, Name: "Needs notes", Type: model.AccountTypeCredit, NeedsReview: true}
	test.MustUpsertAccount(t, s, "needs-review-notes", stillFlagged)
	notes := "review later"
	stored, err = s.UpdateAccount(ctx, stillFlagged.ID.Int64(), model.UpdateAccountInput{Notes: &notes})
	if err != nil || !stored.NeedsReview {
		t.Fatalf("UpdateAccount(notes) = %#v, %v", stored, err)
	}
}

func TestUpdateManualAccountCryptoWalletType(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	owner := test.MustCreateOwner(t, s, model.CreateOwnerInput{Name: "alex"})
	account, err := s.CreateManualAccount(ctx, model.CreateManualAccountInput{
		Name:    "Wallet",
		OwnerID: owner.ID,
		Type:    model.AccountTypeOther,
	})
	must.NoErr(t, err)

	cryptoType := model.AccountTypeCryptoWallet
	updated, err := s.UpdateAccount(ctx, account.ID.Int64(), model.UpdateAccountInput{Type: &cryptoType})
	if err != nil || updated.Type != model.AccountTypeCryptoWallet {
		t.Fatalf("UpdateAccount(to crypto): %v, %v", updated, err)
	}

	otherType := model.AccountTypeOther
	updated, err = s.UpdateAccount(ctx, account.ID.Int64(), model.UpdateAccountInput{Type: &otherType})
	if err != nil || updated.Type != model.AccountTypeOther {
		t.Fatalf("UpdateAccount(from crypto): %v, %v", updated, err)
	}
}

func TestUpdateLinkedEVMWalletTypeRejected(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	owner := test.MustCreateOwner(t, s, model.CreateOwnerInput{Name: "alex"})
	_, account, err := s.CreateEVMWallet(ctx, "0x1111111111111111111111111111111111111111", owner.ID.Int64(), "Wallet", []string{"eth"})
	must.NoErr(t, err)

	otherType := model.AccountTypeOther
	if _, err := s.UpdateAccount(ctx, account.ID.Int64(), model.UpdateAccountInput{Type: &otherType}); err == nil {
		t.Fatal("expected linked EVM wallet type update to fail")
	}
}

func TestConnectionsIncludeInactive(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	owner := test.MustCreateOwner(t, s, model.CreateOwnerInput{Name: "alex"})
	connectionName := "Institution"
	conn := test.MustCreateConnection(t, s, 123, &connectionName, owner.ID.Int64())
	inactive := false
	if _, err := s.UpdateConnection(ctx, accounts.UpdateConnectionInput{ConnectionID: conn.ID.Int64(), IsActive: &inactive}); err != nil {
		t.Fatalf("UpdateConnection(): %v", err)
	}

	active, _ := s.Connections(ctx, false)
	all, _ := s.Connections(ctx, true)
	if len(active) != 0 || len(all) != 1 {
		t.Fatalf("Connections: active=%d all=%d, want 0/1", len(active), len(all))
	}
}

func TestCreateManualAccountInvalidOwner(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	_, err := s.CreateManualAccount(ctx, model.CreateManualAccountInput{
		Name:    "Cash",
		OwnerID: model.New(model.GlobalIDOwner, 1),
		Type:    model.AccountTypeDepository,
	})
	if err == nil {
		t.Fatal("expected error for invalid owner")
	}
}

func TestUpdateAccountNotes(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	owner := test.MustCreateOwner(t, s, model.CreateOwnerInput{Name: "alex"})
	acc := &model.Account{Owner: owner, Name: "Savings", Type: model.AccountTypeDepository}
	test.MustUpsertAccount(t, s, "acc-notes", acc)

	accountID := acc.ID.Int64()
	notes := "  test note  "
	updated, err := s.UpdateAccount(ctx, accountID, model.UpdateAccountInput{Notes: &notes})
	if err != nil || updated == nil {
		t.Fatalf("UpdateAccount(notes): %v, %v", updated, err)
	}

	// UpdateAccount with no fields (no-op path)
	noOp, err := s.UpdateAccount(ctx, accountID, model.UpdateAccountInput{})
	if err != nil || noOp == nil {
		t.Fatalf("UpdateAccount(no-op): %v, %v", noOp, err)
	}

	// Update with a valid subtype
	subtype := "checking"
	updated2, err := s.UpdateAccount(ctx, accountID, model.UpdateAccountInput{Subtype: &subtype})
	if err != nil || updated2 == nil {
		t.Fatalf("UpdateAccount(subtype): %v, %v", updated2, err)
	}

	// Update with an invalid subtype
	bad := "not_a_real_subtype"
	if _, err := s.UpdateAccount(ctx, accountID, model.UpdateAccountInput{Subtype: &bad}); err == nil {
		t.Fatal("expected error for invalid subtype")
	}
}

func TestUpdateAccountOwner(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	owner1 := test.MustCreateOwner(t, s, model.CreateOwnerInput{Name: "alex"})
	owner2 := test.MustCreateOwner(t, s, model.CreateOwnerInput{Name: "sam"})
	acc := &model.Account{Owner: owner1, Name: "Savings", Type: model.AccountTypeDepository}
	test.MustUpsertAccount(t, s, "acc-owner", acc)

	accountID := acc.ID.Int64()
	updated, err := s.UpdateAccount(ctx, accountID, model.UpdateAccountInput{OwnerID: &owner2.ID})
	if err != nil || updated == nil {
		t.Fatalf("UpdateAccount(owner): %v, %v", updated, err)
	}
	if updated.Owner == nil || updated.Owner.Name != "sam" {
		t.Fatalf("expected owner sam, got %v", updated.Owner)
	}
}

func TestHiddenAccountIDsByConnection(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t)

	owner := test.MustCreateOwner(t, s, model.CreateOwnerInput{Name: "sam"})
	connectionName := "Institution"
	conn := test.MustCreateConnection(t, s, 123, &connectionName, owner.ID.Int64())
	hidden := true
	acc := &model.Account{Connection: conn, Owner: owner, Name: "Hidden", Type: model.AccountTypeDepository, Hidden: hidden}
	test.MustUpsertAccount(t, s, "acc-h", acc)

	ids, err := s.HiddenAccountIDsByConnection(ctx, conn.ID.Int64())
	must.NoErr(t, err)
	if !ids["acc-h"] {
		t.Error("expected acc-h to be hidden")
	}
}
