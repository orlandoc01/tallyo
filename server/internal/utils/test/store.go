package test

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"

	"github.com/samber/lo"

	"tallyo/internal/accounts"
	"tallyo/internal/clients"
	"tallyo/internal/database"
	"tallyo/internal/graph/model"
)

type Store struct {
	db *database.DB
}

func Open(ctx context.Context, path string) (*Store, error) {
	db, err := database.OpenDB(ctx, database.OpenOptions{Path: path, Logger: Logger})
	if err != nil {
		return nil, err
	}
	return New(db), nil
}

func New(db *database.DB) *Store {
	return &Store{db: db}
}

func OpenStore(tb testing.TB) *Store {
	tb.Helper()
	return OpenStoreAt(tb, ":memory:", "Open() error = %v")
}

func OpenStoreAt(tb testing.TB, path, failureFormat string) *Store {
	tb.Helper()
	store, err := Open(context.Background(), path)
	if err != nil {
		tb.Fatalf(failureFormat, err)
	}
	tb.Cleanup(func() { _ = store.Close() })
	return store
}

func (s *Store) Database() *database.DB { return s.db }

func (s *Store) SQL() *sql.DB { return s.db.SQL() }

func (s *Store) Close() error { return s.db.Close() }

type CredentialSeeder interface {
	CreatePlaidCredential(context.Context, model.CreatePlaidCredentialInput) (*model.PlaidCredential, error)
	PlaidCredentials(context.Context) ([]*model.PlaidCredential, error)
}

type ItemSeeder interface {
	Owners(context.Context) ([]*model.Owner, error)
	CreateOwner(context.Context, model.CreateOwnerInput) (*model.Owner, error)
	UpsertPlaidItem(context.Context, accounts.PlaidItemSecret) (int64, error)
}

type AccountSeeder interface {
	ItemSeeder
	CreateConnection(context.Context, int64, *string, int64) (*model.Connection, error)
	UpsertAccount(context.Context, string, *model.Account) error
}

func MustCreateOwner(tb testing.TB, seeder ItemSeeder, input model.CreateOwnerInput) *model.Owner {
	tb.Helper()
	owner, err := seeder.CreateOwner(context.Background(), input)
	if err != nil {
		tb.Fatalf("CreateOwner() error = %v", err)
	}
	return owner
}

func MustCreatePlaidCredential(tb testing.TB, seeder CredentialSeeder, input model.CreatePlaidCredentialInput) *model.PlaidCredential {
	tb.Helper()
	credential, err := seeder.CreatePlaidCredential(context.Background(), input)
	if err != nil {
		tb.Fatalf("CreatePlaidCredential: %v", err)
	}
	return credential
}

func MustCreateConnection(tb testing.TB, seeder AccountSeeder, itemRowID int64, name *string, ownerID int64) *model.Connection {
	tb.Helper()
	connection, err := seeder.CreateConnection(context.Background(), itemRowID, name, ownerID)
	if err != nil {
		tb.Fatalf("CreateConnection() error = %v", err)
	}
	return connection
}

func MustSeedAccount(tb testing.TB, seeder AccountSeeder, externalID, ownerName, accountName string, accountType model.AccountType) *model.Account {
	tb.Helper()
	owner := MustCreateOwner(tb, seeder, model.CreateOwnerInput{Name: ownerName})
	account := &model.Account{Owner: owner, Name: accountName, Type: accountType}
	MustUpsertAccount(tb, seeder, externalID, account)
	return account
}

func MustUpsertAccount(tb testing.TB, seeder AccountSeeder, externalID string, account *model.Account, failureFormat ...string) {
	tb.Helper()
	format := "UpsertAccount() error = %v"
	if len(failureFormat) != 0 {
		format = failureFormat[0]
	}
	if err := seeder.UpsertAccount(context.Background(), externalID, account); err != nil {
		tb.Fatalf(format, err)
	}
}

type CredentialFinder interface {
	PlaidCredentials(context.Context) ([]*model.PlaidCredential, error)
}

func PlaidCredentialByClientID(ctx context.Context, store CredentialFinder, clientID string) (*model.PlaidCredential, error) {
	credentials, err := store.PlaidCredentials(ctx)
	if err != nil {
		return nil, err
	}
	matchesClientID := func(credential *model.PlaidCredential) bool { return credential.ClientID == clientID }
	credential, found := lo.Find(credentials, matchesClientID)
	return lo.Ternary(found, credential, nil), nil
}

func EnsurePlaidCredential(ctx context.Context, store CredentialSeeder) (*model.PlaidCredential, error) {
	const clientID = "test-client"
	existing, err := PlaidCredentialByClientID(ctx, store, clientID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing, nil
	}
	return store.CreatePlaidCredential(ctx, model.CreatePlaidCredentialInput{ClientID: clientID, Secret: "test-secret", Environment: model.PlaidEnvironmentSandbox})
}

func SeedPlaidAccount(tb testing.TB, accts AccountSeeder, creds CredentialSeeder, accountID, ownerName string) *model.Account {
	tb.Helper()
	owner, itemRowID := SeedPlaidItem(tb, accts, creds, "item", ownerName)
	connectionName := "Institution"
	conn := MustCreateConnection(tb, accts, itemRowID, &connectionName, owner.ID.Int64())
	account := &model.Account{Connection: conn, Owner: owner, Name: "Checking", Type: model.AccountTypeDepository, Mask: new("0000")}
	MustUpsertAccount(tb, accts, accountID, account)
	return account
}

func SeedPlaidItem(tb testing.TB, items ItemSeeder, creds CredentialSeeder, itemID, ownerName string) (*model.Owner, int64) {
	tb.Helper()
	ctx := context.Background()
	owner, err := OwnerByName(ctx, items, ownerName)
	if err != nil {
		tb.Fatalf("OwnerByName() error = %v", err)
	}
	if owner == nil {
		owner = MustCreateOwner(tb, items, model.CreateOwnerInput{Name: ownerName})
	}
	cred, err := EnsurePlaidCredential(ctx, creds)
	if err != nil {
		tb.Fatalf("EnsurePlaidCredential() error = %v", err)
	}
	itemRowID, err := items.UpsertPlaidItem(ctx, accounts.PlaidItemSecret{ExternalID: itemID, CredentialID: cred.ID, AccessToken: "token", OwnerID: owner.ID.Int64(), OwnerName: owner.Name})
	if err != nil {
		tb.Fatalf("UpsertPlaidItem() error = %v", err)
	}
	return owner, itemRowID
}

type OwnerFinder interface {
	Owners(context.Context) ([]*model.Owner, error)
}

func OwnerByName(ctx context.Context, owners OwnerFinder, name string) (*model.Owner, error) {
	rows, err := owners.Owners(ctx)
	if err != nil {
		return nil, err
	}
	matchesName := func(owner *model.Owner) bool { return owner.Name == name }
	owner, found := lo.Find(rows, matchesName)
	return lo.Ternary(found, owner, nil), nil
}

type CategoryFinder interface {
	Categories(context.Context) ([]*model.Category, error)
}

func CategoryIDByName(tb testing.TB, store CategoryFinder, name string) int64 {
	tb.Helper()
	categories, err := store.Categories(context.Background())
	if err != nil {
		tb.Fatalf("Categories() error = %v", err)
	}
	matchesName := func(category *model.Category) bool { return category.Name == name }
	category, found := lo.Find(categories, matchesName)
	if !found {
		tb.Fatalf("category %q not found", name)
	}
	return category.ID.Int64()
}

type StaticClientFactory struct {
	Client clients.PlaidClient
}

func (f StaticClientFactory) ClientForCredential(ctx context.Context, credentialID int32) (clients.PlaidClient, error) {
	if f.Client == nil {
		return nil, fmt.Errorf("plaid client is not configured")
	}
	return f.Client, nil
}

type LastKnownPriceProvider struct{}

func (LastKnownPriceProvider) PriceAt(_ context.Context, asset *model.Asset, _ time.Time) (float64, error) {
	if asset.AssetType == model.AssetTypeCurrency && asset.Identifier == "USD" {
		return 1, nil
	}
	if asset.CurrentPrice == nil {
		return 0, nil
	}
	return *asset.CurrentPrice, nil
}
