package accounts_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"tallyo/internal/accounts"
	"tallyo/internal/clients"
	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/nooplog"
	testutil "tallyo/internal/utils/test"
)

func TestFieldsFromSimpleFinAccount(t *testing.T) {
	tests := []struct {
		name        string
		account     clients.SimpleFinAccount
		accountType model.AccountType
		accountName string
		mask        string
		needsReview bool
	}{
		{name: "checking", account: clients.SimpleFinAccount{ID: "abc1234", Name: "Joint Checking"}, accountType: model.AccountTypeDepository},
		{name: "name mask", account: clients.SimpleFinAccount{ID: "card", Name: "Sapphire Reserve (4628)"}, accountType: model.AccountTypeCredit, accountName: "Sapphire Reserve", mask: "4628"},
		{name: "credit", account: clients.SimpleFinAccount{ID: "card", Name: "Sapphire Reserve"}, accountType: model.AccountTypeCredit},
		{name: "loan", account: clients.SimpleFinAccount{ID: "loan", Name: "Auto Loan"}, accountType: model.AccountTypeLoan},
		{name: "investment", account: clients.SimpleFinAccount{ID: "inv", Name: "Self Directed", Holdings: []clients.SimpleFinHolding{{Symbol: "VTI"}}}, accountType: model.AccountTypeInvestment},
		{name: "brokerage", account: clients.SimpleFinAccount{ID: "brokerage", Name: "Taxable brokerage"}, accountType: model.AccountTypeInvestment},
		{name: "brokerage title case", account: clients.SimpleFinAccount{ID: "brokerage-title", Name: "Self Directed BrokerageAccount"}, accountType: model.AccountTypeInvestment},
		{name: "fallback", account: clients.SimpleFinAccount{ID: "xx", Name: "Mystery Account"}, accountType: model.AccountTypeCredit, needsReview: true},
		// Name keywords win over the balance sign: an overdrawn checking account
		// stays DEPOSITORY rather than being misclassified as a liability.
		{name: "overdrawn checking", account: clients.SimpleFinAccount{ID: "od", Name: "Joint Checking", Balance: "-106.17"}, accountType: model.AccountTypeDepository},
		// Uninformative name + negative balance => liability.
		{name: "negative unknown", account: clients.SimpleFinAccount{ID: "neg", Name: "Premier Account", Balance: "-50.00"}, accountType: model.AccountTypeCredit},
		// Uninformative name + positive balance => asset (the H1 case).
		{name: "positive unknown", account: clients.SimpleFinAccount{ID: "pos", Name: "Premier Account", Balance: "500.00"}, accountType: model.AccountTypeDepository},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fields := accounts.FieldsFromSimpleFinAccount(tt.account)
			accountName := tt.account.Name
			if tt.accountName != "" {
				accountName = tt.accountName
			}
			if fields.Name != accountName {
				t.Fatalf("name = %q, want %q", fields.Name, accountName)
			}
			if fields.Type != tt.accountType || fields.NeedsReview != tt.needsReview {
				t.Fatalf("fields = %#v", fields)
			}
			if tt.mask == "" && fields.Mask != nil {
				t.Fatalf("mask = %#v, want nil", fields.Mask)
			}
			if tt.mask != "" && (fields.Mask == nil || *fields.Mask != tt.mask) {
				t.Fatalf("mask = %#v, want %q", fields.Mask, tt.mask)
			}
		})
	}
}

func TestSimpleFinServiceCreateAccessToken(t *testing.T) {
	ctx := context.Background()
	owner := &model.Owner{ID: model.New(model.GlobalIDOwner, 1), Name: "Alex"}
	store := &fakeSimpleFinLinkStore{
		owner: owner,
		token: &model.SimpleFinAccessToken{
			ID:        model.New(model.GlobalIDSimpleFinAccessToken, 7),
			Owner:     owner,
			SyncCron:  accounts.DefaultSyncCron,
			CreatedAt: time.Now(),
		},
	}
	store.connections = []*model.SimpleFinConnection{{
		ID:        model.New(model.GlobalIDSimpleFinConnection, 1),
		Accounts:  []*model.Account{},
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}, {ID: model.New(model.GlobalIDSimpleFinConnection, 2), Accounts: []*model.Account{}, CreatedAt: time.Now(), UpdatedAt: time.Now()}}
	events := &recordingPublisher{}
	service := &accounts.SimpleFinService{
		Store: store,
		Client: testutil.SimpleFinClientStub{
			ClaimURL: "https://user:pass@bridge.example/simplefin",
			Accounts: clients.SimpleFinAccountSet{
				Connections: []clients.SimpleFinConnection{{ConnID: "conn-1", Name: "Bank", OrgID: "mx.bank", OrgURL: "https://bank.example", SfinURL: "https://bridge.example/simplefin"}, {ConnID: "conn-2", Name: "Broker"}},
				Accounts: []clients.SimpleFinAccount{
					{ID: "acc-1234", ConnID: "conn-1", Name: "Mystery Account", Extra: map[string]any{"x": "y"}},
					{ID: "acc-5678", ConnID: "conn-2", Name: "Joint Checking"},
				},
			},
		},
		Events: events,
		Log:    nooplog.Logger,
	}

	payload, err := service.CreateAccessToken(ctx, "setup-token", owner.ID.Int64(), "Bridge")
	must.NoErr(t, err)
	if payload.AccessToken.ID != store.token.ID || len(payload.Connections) != 2 || len(payload.Accounts) != 2 {
		t.Fatalf("payload = %#v", payload)
	}
	if len(payload.Connections[0].Accounts) != 1 || len(payload.Connections[1].Accounts) != 1 {
		t.Fatalf("payload connection accounts = %#v", payload.Connections[0].Accounts)
	}
	if payload.Accounts[0].CreatedAt.IsZero() || payload.Accounts[0].UpdatedAt.IsZero() {
		t.Fatalf("payload account timestamps = %#v", payload.Accounts[0])
	}
	if len(store.upsertedConnections) != 2 || store.upsertedConnections[0].ExternalID != "conn-1" {
		t.Fatalf("upserted connections = %#v", store.upsertedConnections)
	}
	if len(store.accounts) != 2 || store.accounts[0].Owner.ID != owner.ID || store.accounts[0].Type != model.AccountTypeCredit || !store.accounts[0].NeedsReview {
		t.Fatalf("accounts = %#v", store.accounts)
	}
	if !payload.Accounts[0].NeedsReview {
		t.Fatalf("payload account = %#v", payload.Accounts[0])
	}
	if len(events.events) != 1 || events.events[0].Provider != accounts.SourceTableSimpleFinConnection || events.events[0].SourceID != 1 {
		t.Fatalf("events = %#v", events.events)
	}
}

func TestSimpleFinServiceCreateAccessTokenInitialFetchFailureReturnsOwner(t *testing.T) {
	ctx := context.Background()
	owner := &model.Owner{ID: model.New(model.GlobalIDOwner, 1), Name: "Alex"}
	store := &fakeSimpleFinLinkStore{
		owner: owner,
		token: &model.SimpleFinAccessToken{
			ID:        model.New(model.GlobalIDSimpleFinAccessToken, 7),
			SyncCron:  accounts.DefaultSyncCron,
			CreatedAt: time.Now(),
		},
	}
	service := &accounts.SimpleFinService{
		Store:  store,
		Client: testutil.SimpleFinClientStub{ClaimURL: "https://user:pass@bridge.example/simplefin", AccountsErr: errors.New("bridge down")},
		Events: &recordingPublisher{},
		Log:    nooplog.Logger,
	}

	payload, err := service.CreateAccessToken(ctx, "setup-token", owner.ID.Int64(), "Bridge")
	must.NoErr(t, err)
	if payload.AccessToken.Owner == nil || payload.AccessToken.Owner.ID != owner.ID || payload.AccessToken.Owner.Name != owner.Name {
		t.Fatalf("payload token owner = %#v", payload.AccessToken.Owner)
	}
}

type fakeSimpleFinLinkStore struct {
	owner               *model.Owner
	token               *model.SimpleFinAccessToken
	connections         []*model.SimpleFinConnection
	upsertedConnections []accounts.UpsertSimpleFinConnectionParams
	accounts            []*model.Account
}

func (f *fakeSimpleFinLinkStore) OwnerByID(ctx context.Context, id int64) (*model.Owner, error) {
	if f.owner != nil && f.owner.ID.Int64() == id {
		return f.owner, nil
	}
	return nil, nil
}

func (f *fakeSimpleFinLinkStore) CreateSimpleFinAccessToken(ctx context.Context, accessURL string, ownerID int64, label string) (*model.SimpleFinAccessToken, error) {
	return f.token, nil
}

func (f *fakeSimpleFinLinkStore) SimpleFinAccessTokenByID(ctx context.Context, id int64) (*model.SimpleFinAccessToken, error) {
	return f.token, nil
}

func (f *fakeSimpleFinLinkStore) LinkSimpleFinConnection(ctx context.Context, conn accounts.UpsertSimpleFinConnectionParams) (int64, int64, error) {
	f.upsertedConnections = append(f.upsertedConnections, conn)
	simpleFinConnID := int64(len(f.upsertedConnections))
	connectionID := simpleFinConnID
	return simpleFinConnID, connectionID, nil
}

func (f *fakeSimpleFinLinkStore) SimpleFinConnectionsByTokenIDs(ctx context.Context, accessTokenIDs []int64) (map[int64][]*model.SimpleFinConnection, error) {
	byToken := make(map[int64][]*model.SimpleFinConnection, len(accessTokenIDs))
	for _, id := range accessTokenIDs {
		byToken[id] = []*model.SimpleFinConnection{}
	}
	for _, conn := range f.connections {
		conn.Accounts = []*model.Account{}
		for _, account := range f.accounts {
			if account.Connection.ID.Int64() == conn.ID.Int64() {
				conn.Accounts = append(conn.Accounts, account)
			}
		}
	}
	byToken[f.token.ID.Int64()] = f.connections
	return byToken, nil
}

func (f *fakeSimpleFinLinkStore) UpsertAccountWithExternalID(ctx context.Context, externalID string, account *model.Account) (int64, error) {
	accountID := int64(len(f.accounts) + 1)
	account.ID = model.New(model.GlobalIDAccount, accountID)
	account.CreatedAt = time.Date(2026, 7, 11, 12, 0, 0, 0, time.UTC)
	account.UpdatedAt = account.CreatedAt
	f.accounts = append(f.accounts, account)
	return accountID, nil
}

func (f *fakeSimpleFinLinkStore) ResetSimpleFinTokenSyncedAt(ctx context.Context, id int64) error {
	return nil
}

func (f *fakeSimpleFinLinkStore) DeleteSimpleFinAccessToken(ctx context.Context, id int64) error {
	return nil
}

type recordingPublisher struct{ events []accounts.AccountsCreated }

func (p *recordingPublisher) Publish(ev accounts.AccountsCreated) {
	p.events = append(p.events, ev)
}
