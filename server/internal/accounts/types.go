package accounts

import (
	"time"

	"tallyo/internal/graph/model"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
)

// PlaidItemSecret is the full Plaid item record including the access token,
// used by sync services.
type PlaidItemSecret struct {
	ID                  int64
	ExternalID          string
	CredentialID        int32
	AccessToken         string
	OwnerID             int64
	OwnerName           string
	InstitutionID       *string
	InstitutionName     *string
	LogoURL             *string
	LastSyncedAt        *time.Time
	SyncCron            string
	RecurringSyncCron   string
	NextSyncAt          *time.Time
	NextRecurringSyncAt *time.Time
	NextBalanceSyncAt   *time.Time
	InvestmentsEnabled  bool
	LiabilitiesEnabled  bool
}

type PlaidSyncKind string

const (
	PlaidSyncKindTransactions PlaidSyncKind = "sync"
	PlaidSyncKindRecurring    PlaidSyncKind = "recurring"
	PlaidSyncKindBalance      PlaidSyncKind = "balance"
)

// EVMWallet is the internal representation of a linked EVM wallet.
type EVMWallet struct {
	ID                int64
	Address           string
	ChainIDs          []string
	OwnerID           int64
	Label             string
	CreatedAt         time.Time
	NextBalanceSyncAt *time.Time
}

type SimpleFinTokenSecretKind string

const (
	SimpleFinTokenSecretKindSync    SimpleFinTokenSecretKind = "sync"
	SimpleFinTokenSecretKindBalance SimpleFinTokenSecretKind = "balance"
)

type PlaidAccountFields struct {
	ID      string
	Name    string
	Type    model.AccountType
	Subtype *string
	Mask    *string
}

func FieldsFromPlaidAccount(account plaidapi.AccountBase) PlaidAccountFields {
	subtype := string(account.GetSubtype())
	mask := account.GetMask()
	return PlaidAccountFields{
		ID:      account.GetAccountId(),
		Name:    account.GetName(),
		Type:    TypeFromPlaid(string(account.GetType())),
		Subtype: &subtype,
		Mask:    &mask,
	}
}

func TypeFromPlaid(value string) model.AccountType {
	switch value {
	case "depository":
		return model.AccountTypeDepository
	case "credit":
		return model.AccountTypeCredit
	case "loan":
		return model.AccountTypeLoan
	case "investment":
		return model.AccountTypeInvestment
	case "other":
		return model.AccountTypeOther
	default:
		return model.AccountTypeOther
	}
}
