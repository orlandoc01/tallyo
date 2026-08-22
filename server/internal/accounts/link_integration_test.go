package accounts_test

import (
	"context"
	"errors"
	"testing"
	"time"

	. "tallyo/internal/accounts"
	accountsdb "tallyo/internal/accounts/db"
	admindb "tallyo/internal/admin/db"
	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
)

type linkTestStore struct {
	*test.Store
	*accountLinkStore
	Admin *admindb.Store
}

type accountLinkStore struct{ *accountsdb.Store }

func openLinkTestStore(t *testing.T) *linkTestStore {
	t.Helper()
	base := test.OpenStore(t)
	return &linkTestStore{Store: base, accountLinkStore: &accountLinkStore{Store: accountsdb.New(base.Database())}, Admin: admindb.New(base.Database())}
}

func (s *linkTestStore) setPlaidItemHealth(ctx context.Context, itemID int64, state model.PlaidItemHealthState, code *string) error {
	_, err := s.SQL().ExecContext(ctx, `UPDATE plaid_items SET health_state = ?, health_error_code = ? WHERE id = ?`, state, code, itemID)
	return err
}

func (s *linkTestStore) setPlaidItemInstitution(ctx context.Context, itemID int64, institutionID string) error {
	_, err := s.SQL().ExecContext(ctx, `UPDATE plaid_items SET institution_id = ? WHERE id = ?`, institutionID, itemID)
	return err
}

type errorSyncer struct{}

func (errorSyncer) SyncItemByID(ctx context.Context, itemID int64) *model.ItemSyncResult {
	err := "sync failed"
	return &model.ItemSyncResult{Error: &err}
}

type successSyncer struct{ store *linkTestStore }

func (s successSyncer) SyncItemByID(ctx context.Context, itemID int64) *model.ItemSyncResult {
	_, _ = s.store.SQL().ExecContext(ctx, `UPDATE plaid_items SET health_state = 'HEALTHY', health_error_code = NULL, health_error_message = NULL WHERE id = ?`, itemID)
	return &model.ItemSyncResult{}
}

func TestLinkServiceCreatesAndExchangesTokens(t *testing.T) {
	ctx := context.Background()
	store := openLinkTestStore(t)
	owner, existingItemID := test.SeedPlaidItem(t, store, store.Admin, "existing", "alex")
	connectionName := "Institution"
	test.MustCreateConnection(t, store, existingItemID, &connectionName, owner.ID.Int64())
	alexOwner, err := test.OwnerByName(ctx, store, "alex")
	if err != nil || alexOwner == nil {
		t.Fatalf("OwnerByName(alex) = %v, %v", alexOwner, err)
	}
	clientFactory := test.StaticClientFactory{Client: fakeClient}
	events := NewEventBus(test.Logger)
	subscriber := events.RegisterSubscriber("test")
	service := &LinkService{Accounts: store, Store: store, Clients: clientFactory, Events: events}

	link, err := service.CreateLinkToken(ctx, 1, alexOwner.ID.Int64())
	if err != nil || link.LinkToken != "link" {
		t.Fatalf("CreateLinkToken() = %#v, %v", link, err)
	}
	if _, err := service.CreateLinkToken(ctx, 1, 999); err == nil {
		t.Fatalf("expected invalid owner error")
	}

	institutionID := "ins_1"
	payload, err := service.ExchangePublicToken(ctx, "public", 1, alexOwner.ID.Int64(), &institutionID, nil)
	must.NoErr(t, err)
	itemID := payload.Item.ID.Int64()
	if itemID == 0 {
		t.Fatalf("payload item = %#v", payload.Item)
	}
	conn, err := store.ConnectionByPlaidItemID(ctx, itemID)
	if err != nil || conn == nil {
		t.Fatalf("ConnectionByPlaidItemID(item) = %#v, %v", conn, err)
	}
	if conn.Name == nil || *conn.Name != "Institution" || conn.Owner.ID != alexOwner.ID {
		t.Fatalf("connection identity = %#v", conn)
	}
	itemSecret, err := store.PlaidItemSecret(ctx, itemID)
	wantLogoURL := "https://icons.duckduckgo.com/ip3/institution.example.ico"
	missingLogo := itemSecret == nil || itemSecret.LogoURL == nil || *itemSecret.LogoURL != wantLogoURL
	if err != nil || missingLogo {
		t.Fatalf("item logo = %#v, %v", itemSecret, err)
	}
	if len(payload.Accounts) != 1 || payload.Accounts[0].Connection == nil {
		t.Fatalf("payload accounts = %#v", payload.Accounts)
	}
	select {
	case ev := <-subscriber:
		if ev.ConnectionID != conn.ID.Int64() || ev.Provider != SourceTablePlaidItem || ev.SourceID != itemID {
			t.Fatalf("published event = %#v", ev)
		}
	default:
		t.Fatalf("expected accounts created event")
	}
	if _, err := service.ExchangePublicToken(ctx, "public", 1, 999, nil, nil); err == nil {
		t.Fatalf("expected invalid exchange owner error")
	}
}

func TestLinkServiceLinkEVMWalletPublishesEvent(t *testing.T) {
	ctx := context.Background()
	store := openLinkTestStore(t)
	owner := test.MustCreateOwner(t, store, model.CreateOwnerInput{Name: "evm"})
	events := NewEventBus(test.Logger)
	subscriber := events.RegisterSubscriber("test")
	service := &LinkService{Accounts: store, Events: events}

	payload, err := service.LinkEVMWallet(ctx, "0x1111111111111111111111111111111111111111", owner.ID.Int64(), "Wallet", []string{"eth"})
	must.NoErr(t, err)
	if payload.Connection.SourceTable != string(SourceTableEVMWallet) || payload.Account.Connection.ID != payload.Connection.ID {
		t.Fatalf("payload = %#v", payload)
	}

	select {
	case ev := <-subscriber:
		if ev.ConnectionID != payload.Connection.ID.Int64() || ev.Provider != SourceTableEVMWallet {
			t.Fatalf("published event = %#v", ev)
		}
		if ev.SourceID != payload.Connection.SourceID {
			t.Fatalf("published event payload = %#v", ev)
		}
	default:
		t.Fatalf("expected accounts created event")
	}

	if _, err := service.LinkEVMWallet(ctx, "bad-address", owner.ID.Int64(), "", []string{"eth"}); err == nil {
		t.Fatalf("expected invalid address error")
	}
	validAddress := "0x2222222222222222222222222222222222222222"
	if _, err := service.LinkEVMWallet(ctx, validAddress, owner.ID.Int64(), "", nil); err == nil {
		t.Fatal("expected missing chain error")
	}
	if _, err := service.LinkEVMWallet(ctx, validAddress, owner.ID.Int64(), "", []string{"unknown"}); err == nil {
		t.Fatal("expected unknown chain error")
	}
}

func TestLinkServiceUpdateModeTokenAndCompletion(t *testing.T) {
	ctx := context.Background()
	store := openLinkTestStore(t)
	owner, itemID := test.SeedPlaidItem(t, store, store.Admin, "existing", "alex")
	connectionName := "Institution"
	test.MustCreateConnection(t, store, itemID, &connectionName, owner.ID.Int64())
	code := "ITEM_LOGIN_REQUIRED"
	must.NoErr(t, store.setPlaidItemHealth(ctx, itemID, model.PlaidItemHealthStateLinkUpdateRequired, &code))
	clientFactory := test.StaticClientFactory{Client: fakeClient}
	service := &LinkService{Accounts: store, Store: store, Clients: clientFactory, Syncer: successSyncer{store: store}}

	link, err := service.CreateUpdateLinkToken(ctx, itemID)
	if err != nil || link.LinkToken != "update-link" {
		t.Fatalf("CreateUpdateLinkToken() = %#v, %v", link, err)
	}
	payload, err := service.CompleteLinkUpdate(ctx, itemID)
	must.NoErr(t, err)
	if payload.Item.HealthState != model.PlaidItemHealthStateHealthy {
		t.Fatalf("CompleteLinkUpdate() = %#v", payload)
	}
}

func TestLinkServiceUpdateModeProductSupport(t *testing.T) {
	tests := []struct {
		name          string
		institutionFn func(context.Context, string) (plaidapi.Institution, error)
		wantSkipped   bool // additional_consented_products omitted (product already treated as enabled)
	}{
		{
			name: "institution does not support investments/liabilities",
			institutionFn: func(context.Context, string) (plaidapi.Institution, error) {
				institution := plaidapi.NewInstitutionWithDefaults()
				institution.SetProducts([]plaidapi.Products{plaidapi.PRODUCTS_TRANSACTIONS})
				return *institution, nil
			},
			wantSkipped: true,
		},
		{
			name: "institution lookup fails",
			institutionFn: func(context.Context, string) (plaidapi.Institution, error) {
				return plaidapi.Institution{}, errors.New("boom")
			},
			wantSkipped: true,
		},
		{
			name: "institution supports investments/liabilities",
			institutionFn: func(context.Context, string) (plaidapi.Institution, error) {
				institution := plaidapi.NewInstitutionWithDefaults()
				institution.SetProducts([]plaidapi.Products{plaidapi.PRODUCTS_INVESTMENTS, plaidapi.PRODUCTS_LIABILITIES})
				return *institution, nil
			},
			wantSkipped: false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			store := openLinkTestStore(t)
			owner, itemID := test.SeedPlaidItem(t, store, store.Admin, "boa-item", "alex")
			connectionName := "Bank of America"
			test.MustCreateConnection(t, store, itemID, &connectionName, owner.ID.Int64())
			must.NoErr(t, store.setPlaidItemInstitution(ctx, itemID, "ins_boa"))

			var gotInvestments, gotLiabilities bool
			client := test.PlaidClientStub{
				InstitutionFn: tc.institutionFn,
				CreateUpdateLinkTokenFn: func(_ context.Context, _, _ string, investments, liabilities bool) (string, time.Time, error) {
					gotInvestments, gotLiabilities = investments, liabilities
					return "update-link", time.Now().Add(time.Hour), nil
				},
			}
			service := &LinkService{Accounts: store, Store: store, Clients: test.StaticClientFactory{Client: client}}

			if _, err := service.CreateUpdateLinkToken(ctx, itemID); err != nil {
				t.Fatalf("CreateUpdateLinkToken() error = %v", err)
			}
			if gotInvestments != tc.wantSkipped || gotLiabilities != tc.wantSkipped {
				t.Fatalf("investments=%v liabilities=%v, want both %v", gotInvestments, gotLiabilities, tc.wantSkipped)
			}
		})
	}
}

func TestLinkServiceRejectsManualItemUpdateMode(t *testing.T) {
	ctx := context.Background()
	store := openLinkTestStore(t)
	test.SeedPlaidItem(t, store, store.Admin, "existing", "alex")
	service := &LinkService{Accounts: store, Store: store, Clients: test.StaticClientFactory{Client: fakeClient}, Syncer: successSyncer{store: store}}

	if _, err := service.CreateUpdateLinkToken(ctx, 999); err == nil {
		t.Fatalf("expected nonexistent item error")
	}
	if _, err := service.CompleteLinkUpdate(ctx, 999); err == nil {
		t.Fatalf("expected nonexistent item error")
	}
}

func TestCompleteLinkUpdateProductFlags(t *testing.T) {
	tests := []struct {
		name      string
		syncError bool
	}{
		{name: "sets product flags"},
		{name: "skips flags on sync error", syncError: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			store := openLinkTestStore(t)
			owner, itemID := test.SeedPlaidItem(t, store, store.Admin, "existing", "alex")
			connectionName := "Institution"
			conn := test.MustCreateConnection(t, store, itemID, &connectionName, owner.ID.Int64())
			if !tc.syncError {
				test.MustUpsertAccount(t, store, "acc", &model.Account{Connection: conn, Owner: owner, Name: "Checking", Type: model.AccountTypeDepository})
			}
			syncer := ItemSyncer(successSyncer{store: store})
			if tc.syncError {
				syncer = errorSyncer{}
			}
			service := &LinkService{Accounts: store, Store: store, Clients: test.StaticClientFactory{Client: fakeClient}, Syncer: syncer}

			payload, err := service.CompleteLinkUpdate(ctx, itemID)
			must.NoErr(t, err)
			if payload.Item == nil {
				t.Fatalf("expected item in payload")
			}
			secret, err := store.PlaidItemSecret(ctx, itemID)
			if err != nil || secret == nil {
				t.Fatalf("PlaidItemSecret() = %v, %v", secret, err)
			}
			if tc.syncError {
				if secret.InvestmentsEnabled {
					t.Error("InvestmentsEnabled = true, want false (sync error should skip flag update)")
				}
				return
			}
			if !secret.InvestmentsEnabled {
				t.Error("InvestmentsEnabled = false, want true (fakeClient ItemGet returns investments)")
			}
			if secret.LiabilitiesEnabled {
				t.Error("LiabilitiesEnabled = true, want false (fakeClient ItemGet does not return liabilities)")
			}
		})
	}
}
