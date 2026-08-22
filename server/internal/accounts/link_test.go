package accounts_test

import (
	"context"
	"testing"

	"tallyo/internal/accounts"
	"tallyo/internal/utils/nooplog"
	testutil "tallyo/internal/utils/test"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
	"tallyo/internal/utils/must"
)

func TestPlaidItemHasProduct(t *testing.T) {
	products := []plaidapi.Products{plaidapi.PRODUCTS_INVESTMENTS, plaidapi.PRODUCTS_TRANSACTIONS}
	item := plaidapi.Item{
		AvailableProducts: []plaidapi.Products{plaidapi.PRODUCTS_LIABILITIES},
		BilledProducts:    products,
		Products:          &products,
		ConsentedProducts: &[]plaidapi.Products{plaidapi.PRODUCTS_INVESTMENTS},
	}

	checks := []struct {
		product plaidapi.Products
		want    bool
	}{
		{plaidapi.PRODUCTS_INVESTMENTS, true},
		{plaidapi.PRODUCTS_TRANSACTIONS, true},
		{plaidapi.PRODUCTS_LIABILITIES, true},
		{plaidapi.PRODUCTS_AUTH, false},
	}
	for _, c := range checks {
		if got := accounts.PlaidItemHasProduct(item, c.product); got != c.want {
			t.Errorf("PlaidItemHasProduct(%s) = %v, want %v", c.product, got, c.want)
		}
	}

	if accounts.PlaidItemHasProduct(plaidapi.Item{}, plaidapi.PRODUCTS_INVESTMENTS) {
		t.Error("PlaidItemHasProduct on empty item should be false")
	}
}

func TestDetectProductsReturnsItemGetError(t *testing.T) {
	client := testutil.PlaidClientStub{ItemGetFn: func(context.Context, string) (plaidapi.Item, error) {
		return plaidapi.Item{}, context.Canceled
	}}
	if _, _, err := accounts.DetectProducts(context.Background(), client, "bad-token"); err == nil {
		t.Fatal("detectProducts() error = nil, want item get error")
	}
}

func TestLogoBackfillerBackfillsMissingLogos(t *testing.T) {
	institutionID := "ins_1"
	store := &fakeLogoBackfillStore{
		items: []accounts.PlaidItemSecret{{ID: 1, ExternalID: "item", CredentialID: 1, InstitutionID: &institutionID}},
	}
	backfiller := &accounts.LogoBackfiller{
		Store: store,
		Clients: testutil.StaticClientFactory{Client: testutil.PlaidClientStub{InstitutionFn: func(context.Context, string) (plaidapi.Institution, error) {
			institution := plaidapi.NewInstitutionWithDefaults()
			institution.SetName("Bank")
			institution.SetUrl("https://bank.example/path")
			return *institution, nil
		}}},
		Log: nooplog.Logger,
	}

	must.NoErr(t, backfiller.Backfill(context.Background()))
	if store.logoURL == nil || *store.logoURL != "https://icons.duckduckgo.com/ip3/bank.example.ico" {
		t.Fatalf("logo url = %#v", store.logoURL)
	}
}

type fakeLogoBackfillStore struct {
	items   []accounts.PlaidItemSecret
	logoURL *string
}

func (s *fakeLogoBackfillStore) PlaidItemsMissingLogoURL(context.Context) ([]accounts.PlaidItemSecret, error) {
	return s.items, nil
}

func (s *fakeLogoBackfillStore) SetPlaidItemLogoURL(ctx context.Context, itemID int64, logoURL *string) error {
	s.logoURL = logoURL
	return nil
}
