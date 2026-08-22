package accounts_test

import (
	"context"
	"time"

	"tallyo/internal/utils/test"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
)

var fakeClient = test.PlaidClientStub{
	AccountsFn: func(context.Context, string) ([]plaidapi.AccountBase, error) {
		return []plaidapi.AccountBase{test.AccountBase("acc", "Checking", "0000", "depository", "checking")}, nil
	},
	CreateLinkTokenFn: func(context.Context, string) (string, time.Time, error) {
		return "link", time.Now().Add(time.Hour), nil
	},
	CreateUpdateLinkTokenFn: func(context.Context, string, string, bool, bool) (string, time.Time, error) {
		return "update-link", time.Now().Add(time.Hour), nil
	},
	ExchangePublicTokenFn: func(context.Context, string) (string, string, error) {
		return "access", "item", nil
	},
	InstitutionFn: func(context.Context, string) (plaidapi.Institution, error) {
		institution := plaidapi.NewInstitutionWithDefaults()
		institution.SetName("Institution")
		institution.SetUrl("institution.example")
		return *institution, nil
	},
	ItemGetFn: func(context.Context, string) (plaidapi.Item, error) {
		item := plaidapi.NewItemWithDefaults()
		item.SetProducts([]plaidapi.Products{plaidapi.PRODUCTS_INVESTMENTS})
		return *item, nil
	},
}
