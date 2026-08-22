package accounts

import (
	"context"
	"time"

	"tallyo/internal/graph/model"
)

// Store is the combined account-domain data access interface.
// Satisfied by *db.Store.
type Store interface {
	AccountStore
	ConnectionStore
	OwnerStore
	PlaidItemStore
	EVMWalletStore
	SimpleFinStore
}

// SimpleFinStore covers SimpleFIN access token and connection lifecycle.
type SimpleFinStore interface {
	CreateSimpleFinAccessToken(ctx context.Context, accessURL string, ownerID int64, label string) (*model.SimpleFinAccessToken, error)
	SimpleFinAccessTokens(ctx context.Context) ([]*model.SimpleFinAccessToken, error)
	SimpleFinAccessTokenByID(ctx context.Context, id int64) (*model.SimpleFinAccessToken, error)
	SimpleFinTokensDueForSync(ctx context.Context, now time.Time) ([]SimpleFinAccessTokenSecret, error)
	SetSimpleFinTokenSynced(ctx context.Context, id int64, lastSyncedAt time.Time, nextSyncAt time.Time) error
	DeleteSimpleFinAccessToken(ctx context.Context, id int64) error
	// LinkSimpleFinConnection upserts the simplefin_connections row and its
	// polymorphic connections row in one transaction, returning both IDs so
	// callers don't need to reread either.
	LinkSimpleFinConnection(ctx context.Context, conn UpsertSimpleFinConnectionParams) (simpleFinConnID int64, connectionID int64, err error)
	SimpleFinConnectionsByTokenIDs(ctx context.Context, accessTokenIDs []int64) (map[int64][]*model.SimpleFinConnection, error)
	SimpleFinConnectionByConnID(ctx context.Context, connID int64) (*model.SimpleFinConnection, error)
	SimpleFinConnectionsByConnIDs(ctx context.Context, connIDs []int64) (map[int64]*model.SimpleFinConnection, error)
	SetSimpleFinConnectionHealth(ctx context.Context, connID int64, state string, errMsg *string, lastSyncedAt time.Time) error
	ResetSimpleFinTokenSyncedAt(ctx context.Context, id int64) error
}

// UpsertSimpleFinConnectionParams carries the SimpleFIN-specific fields for an
// upsert plus the generic connection row's name and owner.
type UpsertSimpleFinConnectionParams struct {
	ExternalID    string
	AccessTokenID int64
	OrgID         *string
	OrgDomain     *string
	OrgURL        *string
	SfinURL       *string
	LogoURL       *string
	Name          string
	OwnerID       int64
}

type EVMWalletStore interface {
	CreateEVMWallet(ctx context.Context, address string, ownerID int64, label string, chainIDs []string) (*model.Connection, *model.Account, error)
	EVMWalletByConnectionID(ctx context.Context, connectionID int64) (*EVMWallet, error)
	EVMWalletsByConnectionIDs(ctx context.Context, connectionIDs []int64) (map[int64]*EVMWallet, error)
	DeleteEVMWallet(ctx context.Context, connectionID int64) error
	EVMWalletsDueForBalanceSync(ctx context.Context, now time.Time) ([]EVMWallet, error)
	EVMWalletAccountID(ctx context.Context, walletID int64) (int64, error)
	SetEVMWalletBalanceSynced(ctx context.Context, walletID int64, next time.Time) error
}

// AccountStore covers Plaid and manual account read/write.
type AccountStore interface {
	Accounts(ctx context.Context) ([]*model.Account, error)
	AccountsByItem(ctx context.Context, itemID int64) ([]*model.Account, error)
	SyncableAccountExternalIDsByItem(ctx context.Context, itemID int64) ([]string, error)
	AccountsByIDs(ctx context.Context, ids []int64) (map[int64]*model.Account, error)
	AccountsByItems(ctx context.Context, itemIDs []int64) (map[int64][]*model.Account, error)
	AccountsByRuleIDs(ctx context.Context, ruleIDs []int64) (map[int64][]*model.Account, error)
	UpsertAccount(ctx context.Context, externalID string, account *model.Account) error
	UpsertAccountWithExternalID(ctx context.Context, externalID string, account *model.Account) (int64, error)
	CreateManualAccount(ctx context.Context, input model.CreateManualAccountInput) (*model.Account, error)
	UpdateAccount(ctx context.Context, id int64, input model.UpdateAccountInput) (*model.Account, error)
	RemoveManualAccount(ctx context.Context, id int64) (bool, error)
	AccountByID(ctx context.Context, id int64) (*model.Account, error)
	HiddenAccountIDsByConnection(ctx context.Context, connectionID int64) (map[string]bool, error)
}

// ConnectionStore covers connection lifecycle.
type ConnectionStore interface {
	Connections(ctx context.Context, includeInactive bool) ([]*model.Connection, error)
	ConnectionByID(ctx context.Context, id int64) (*model.Connection, error)
	ConnectionsByIDs(ctx context.Context, ids []int64) (map[int64]*model.Connection, error)
	ConnectionByPlaidItemID(ctx context.Context, plaidItemID int64) (*model.Connection, error)
	CreateConnection(ctx context.Context, plaidItemID int64, name *string, ownerID int64) (*model.Connection, error)
	UpdateConnection(ctx context.Context, input UpdateConnectionInput) (*model.Connection, error)
	DeleteConnection(ctx context.Context, connectionID int64) (bool, error)
}

type UpdateConnectionInput struct {
	ConnectionID        int64
	IsActive            *bool
	SyncCron            *string
	RecurringSyncCron   *string
	NextSyncAt          *time.Time
	NextRecurringSyncAt *time.Time
	EVMChainIDs         []string
}

// OwnerStore covers household owner CRUD.
type OwnerStore interface {
	Owners(ctx context.Context) ([]*model.Owner, error)
	OwnerByID(ctx context.Context, id int64) (*model.Owner, error)
	CreateOwner(ctx context.Context, input model.CreateOwnerInput) (*model.Owner, error)
	DeleteOwner(ctx context.Context, id int64) (bool, error)
}

type PlaidItemStore interface {
	UpsertPlaidItem(ctx context.Context, item PlaidItemSecret) (int64, error)
	PlaidItems(ctx context.Context, includeInactive bool) ([]*model.PlaidItem, error)
	PlaidItem(ctx context.Context, id int64) (*model.PlaidItem, error)
	PlaidItemsByIDs(ctx context.Context, ids []int64) (map[int64]*model.PlaidItem, error)
	PlaidItemSecret(ctx context.Context, id int64) (*PlaidItemSecret, error)
	PlaidItemsMissingLogoURL(ctx context.Context) ([]PlaidItemSecret, error)
	SetPlaidItemLogoURL(ctx context.Context, itemID int64, logoURL *string) error
	SetPlaidProductFlags(ctx context.Context, itemID int64, investmentsEnabled bool, liabilitiesEnabled bool) error
}
