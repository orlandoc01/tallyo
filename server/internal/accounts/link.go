package accounts

import (
	"context"
	"fmt"
	"regexp"
	"time"

	"tallyo/internal/apierror"
	"tallyo/internal/clients"
	"tallyo/internal/graph/model"
	u "tallyo/internal/utils"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
	"github.com/samber/lo"
)

const (
	DefaultSyncCron          = "0 6,18 * * *"
	DefaultRecurringSyncCron = "0 12 * * 0"
)

var evmAddressRE = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)

type LinkAccountStore interface {
	OwnerByID(ctx context.Context, id int64) (*model.Owner, error)
	CreateConnection(ctx context.Context, plaidItemID int64, name *string, ownerID int64) (*model.Connection, error)
	CreateEVMWallet(ctx context.Context, address string, ownerID int64, label string, chainIDs []string) (*model.Connection, *model.Account, error)
	AccountsByItem(ctx context.Context, itemID int64) ([]*model.Account, error)
	UpsertAccountWithExternalID(ctx context.Context, externalID string, account *model.Account) (int64, error)
}

type LinkStore interface {
	UpsertPlaidItem(ctx context.Context, item PlaidItemSecret) (int64, error)
	ResetItemSync(ctx context.Context, itemID int64) error
	PlaidItem(ctx context.Context, id int64) (*model.PlaidItem, error)
	PlaidItemSecret(ctx context.Context, id int64) (*PlaidItemSecret, error)
	SetPlaidProductFlags(ctx context.Context, itemID int64, investmentsEnabled bool, liabilitiesEnabled bool) error
}

type ItemSyncer interface {
	SyncItemByID(ctx context.Context, itemID int64) *model.ItemSyncResult
}

type LinkService struct {
	Accounts LinkAccountStore
	Store    LinkStore
	Clients  clients.PlaidClientFactory
	Syncer   ItemSyncer
	Events   Publisher
}

func (s *LinkService) CreateLinkToken(ctx context.Context, credentialID int32, ownerID int64) (*model.CreateLinkTokenPayload, error) {
	owner, err := s.Accounts.OwnerByID(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("lookup owner: %w", err)
	}
	if owner == nil {
		return nil, apierror.Publicf("invalid owner id %d", ownerID)
	}
	client, err := s.Clients.ClientForCredential(ctx, credentialID)
	if err != nil {
		return nil, err
	}
	token, expiration, err := client.CreateLinkToken(ctx, owner.Name)
	if err != nil {
		return nil, err
	}
	return &model.CreateLinkTokenPayload{LinkToken: token, Expiration: expiration}, nil
}

func (s *LinkService) ExchangePublicToken(ctx context.Context, publicToken string, credentialID int32, ownerID int64, institutionID *string, institutionName *string) (*model.ExchangePublicTokenPayload, error) {
	owner, err := s.Accounts.OwnerByID(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("lookup owner: %w", err)
	}
	if owner == nil {
		return nil, apierror.Publicf("invalid owner id %d", ownerID)
	}
	client, err := s.Clients.ClientForCredential(ctx, credentialID)
	if err != nil {
		return nil, err
	}
	accessToken, itemID, err := client.ExchangePublicToken(ctx, publicToken)
	if err != nil {
		return nil, err
	}
	investmentsEnabled, liabilitiesEnabled, err := detectProducts(ctx, client, accessToken)
	if err != nil {
		return nil, err
	}
	resolvedName, logoURL := resolveInstitutionMetadata(ctx, client, institutionID, institutionName)
	now := time.Now().UTC()
	nextSyncAt, err := u.NextAfter(DefaultSyncCron, now)
	if err != nil {
		return nil, err
	}
	nextRecurringSyncAt, err := u.NextAfter(DefaultRecurringSyncCron, now)
	if err != nil {
		return nil, err
	}
	item := PlaidItemSecret{
		ExternalID:          itemID,
		CredentialID:        credentialID,
		AccessToken:         accessToken,
		OwnerID:             owner.ID.Int64(),
		OwnerName:           owner.Name,
		InstitutionID:       institutionID,
		InstitutionName:     resolvedName,
		LogoURL:             logoURL,
		NextSyncAt:          &nextSyncAt,
		NextRecurringSyncAt: &nextRecurringSyncAt,
		NextBalanceSyncAt:   &now,
		InvestmentsEnabled:  investmentsEnabled,
		LiabilitiesEnabled:  liabilitiesEnabled,
	}
	rowID, err := s.Store.UpsertPlaidItem(ctx, item)
	if err != nil {
		return nil, err
	}
	item.ID = rowID
	conn, err := s.Accounts.CreateConnection(ctx, rowID, resolvedName, owner.ID.Int64())
	if err != nil {
		return nil, fmt.Errorf("create connection: %w", err)
	}
	if err := s.Store.ResetItemSync(ctx, rowID); err != nil {
		return nil, err
	}
	if err := s.upsertAccounts(ctx, client, item, conn); err != nil {
		return nil, err
	}
	s.Events.Publish(AccountsCreated{
		ConnectionID: conn.ID.Int64(),
		Provider:     SourceTable(conn.SourceTable),
		SourceID:     conn.SourceID,
	})
	itemModel, err := s.Store.PlaidItem(ctx, rowID)
	if err != nil {
		return nil, err
	}
	accounts, err := s.Accounts.AccountsByItem(ctx, rowID)
	if err != nil {
		return nil, err
	}
	return &model.ExchangePublicTokenPayload{Item: itemModel, Accounts: accounts}, nil
}

func (s *LinkService) upsertAccounts(
	ctx context.Context,
	client clients.PlaidClient,
	item PlaidItemSecret,
	conn *model.Connection,
) error {
	plaidAccounts, err := client.Accounts(ctx, item.AccessToken)
	if err != nil {
		return err
	}
	for _, account := range plaidAccounts {
		fields := FieldsFromPlaidAccount(account)
		account := &model.Account{
			Connection: conn,
			Owner:      &model.Owner{ID: model.New(model.GlobalIDOwner, item.OwnerID), Name: item.OwnerName},
			Name:       fields.Name,
			Type:       fields.Type,
			Subtype:    fields.Subtype,
			Mask:       fields.Mask,
		}
		if _, err := s.Accounts.UpsertAccountWithExternalID(ctx, fields.ID, account); err != nil {
			return err
		}
	}
	return nil
}

func (s *LinkService) LinkEVMWallet(
	ctx context.Context,
	address string,
	ownerID int64,
	label string,
	chainIDs []string,
) (*model.LinkEVMWalletPayload, error) {
	if !evmAddressRE.MatchString(address) {
		return nil, apierror.Publicf("invalid EVM address: must be 0x followed by 40 hex characters")
	}
	if err := ValidateEVMChainIDs(chainIDs); err != nil {
		return nil, err
	}
	chainIDs = NormalizeEVMChainIDs(chainIDs)

	conn, account, err := s.Accounts.CreateEVMWallet(ctx, address, ownerID, label, chainIDs)
	if err != nil {
		return nil, fmt.Errorf("link evm wallet: %w", err)
	}

	s.Events.Publish(AccountsCreated{
		ConnectionID: conn.ID.Int64(),
		Provider:     SourceTable(conn.SourceTable),
		SourceID:     conn.SourceID,
	})
	return &model.LinkEVMWalletPayload{Connection: conn, Account: account}, nil
}

func (s *LinkService) CreateUpdateLinkToken(ctx context.Context, itemID int64) (*model.CreateLinkTokenPayload, error) {
	item, err := s.Store.PlaidItemSecret(ctx, itemID)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, apierror.Publicf("plaid item %d not found", itemID)
	}
	client, err := s.Clients.ClientForCredential(ctx, item.CredentialID)
	if err != nil {
		return nil, err
	}
	investmentsEnabled, liabilitiesEnabled := item.InvestmentsEnabled, item.LiabilitiesEnabled
	if !investmentsEnabled || !liabilitiesEnabled {
		support := institutionWealthProductSupport(ctx, client, item.InstitutionID)
		investmentsEnabled = investmentsEnabled || !support.Investments
		liabilitiesEnabled = liabilitiesEnabled || !support.Liabilities
	}
	token, expiration, err := client.CreateUpdateLinkToken(ctx, item.AccessToken, item.OwnerName, investmentsEnabled, liabilitiesEnabled)
	if err != nil {
		return nil, err
	}
	return &model.CreateLinkTokenPayload{LinkToken: token, Expiration: expiration}, nil
}

// institutionProductSupport reports whether an institution supports the
// investments/liabilities products.
type institutionProductSupport struct {
	Investments bool
	Liabilities bool
}

// institutionWealthProductSupport reports whether the item's institution
// supports investments/liabilities, so update-mode link tokens don't request
// additional_consented_products Plaid will reject with "Update mode: X not
// supported by <institution>". Unknown institution or a lookup failure
// defaults to unsupported (skip requesting) rather than risking that same
// hard failure — worst case a relink misses a chance to add the product.
func institutionWealthProductSupport(ctx context.Context, client clients.PlaidClient, institutionID *string) institutionProductSupport {
	if institutionID == nil || *institutionID == "" {
		return institutionProductSupport{}
	}
	institution, err := client.Institution(ctx, *institutionID)
	if err != nil {
		return institutionProductSupport{}
	}
	products := institution.GetProducts()
	return institutionProductSupport{
		Investments: lo.Contains(products, plaidapi.PRODUCTS_INVESTMENTS),
		Liabilities: lo.Contains(products, plaidapi.PRODUCTS_LIABILITIES),
	}
}

func (s *LinkService) CompleteLinkUpdate(ctx context.Context, itemID int64) (*model.CompleteLinkUpdatePayload, error) {
	item, err := s.Store.PlaidItem(ctx, itemID)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, apierror.Publicf("plaid item %d not found", itemID)
	}
	syncResult := s.Syncer.SyncItemByID(ctx, itemID)
	if syncResult != nil && syncResult.Error == nil {
		if err := s.syncProductFlags(ctx, itemID); err != nil {
			return nil, err
		}
	}
	item, err = s.Store.PlaidItem(ctx, itemID)
	if err != nil {
		return nil, err
	}
	return &model.CompleteLinkUpdatePayload{Item: item}, nil
}

func (s *LinkService) syncProductFlags(ctx context.Context, itemID int64) error {
	itemSecret, err := s.Store.PlaidItemSecret(ctx, itemID)
	if err != nil {
		return err
	}
	if itemSecret == nil {
		return nil
	}
	client, err := s.Clients.ClientForCredential(ctx, itemSecret.CredentialID)
	if err != nil {
		return err
	}
	hasInvestments, hasLiabilities, err := detectProducts(ctx, client, itemSecret.AccessToken)
	if err != nil {
		return err
	}
	return s.Store.SetPlaidProductFlags(ctx, itemID, hasInvestments, hasLiabilities)
}

func detectProducts(ctx context.Context, client clients.PlaidClient, accessToken string) (bool, bool, error) {
	plaidItem, err := client.ItemGet(ctx, accessToken)
	if err != nil {
		return false, false, err
	}
	return plaidItemHasProduct(plaidItem, plaidapi.PRODUCTS_INVESTMENTS), plaidItemHasProduct(plaidItem, plaidapi.PRODUCTS_LIABILITIES), nil
}

func plaidItemHasProduct(item plaidapi.Item, product plaidapi.Products) bool {
	if lo.Contains(item.GetAvailableProducts(), product) {
		return true
	}
	if lo.Contains(item.GetBilledProducts(), product) {
		return true
	}
	products, ok := item.GetProductsOk()
	if ok && products != nil && lo.Contains(*products, product) {
		return true
	}
	consented, ok := item.GetConsentedProductsOk()
	if ok && consented != nil && lo.Contains(*consented, product) {
		return true
	}
	return false
}
