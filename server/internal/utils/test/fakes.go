package test

import (
	"cmp"
	"context"
	"errors"
	"time"

	"tallyo/internal/clients"
	"tallyo/internal/wealth/syncerids"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
	"github.com/samber/lo"
)

var _ clients.PlaidClient = (*PlaidClientStub)(nil)

var _ clients.SimpleFinClient = SimpleFinClientStub{}

type SimpleFinClientStub struct {
	ClaimURL    string
	ClaimErr    error
	Accounts    clients.SimpleFinAccountSet
	AccountsErr error
}

func (s SimpleFinClientStub) Claim(context.Context, string) (string, error) {
	return s.ClaimURL, s.ClaimErr
}

func (s SimpleFinClientStub) GetAccounts(context.Context, string, clients.GetAccountsOpts) (clients.SimpleFinAccountSet, error) {
	return s.Accounts, s.AccountsErr
}

type PlaidClientStub struct {
	AccountsFn                   func(context.Context, string) ([]plaidapi.AccountBase, error)
	AccountsBalanceGetFn         func(context.Context, string) ([]plaidapi.AccountBase, error)
	InvestmentsHoldingsGetFn     func(context.Context, string) (plaidapi.InvestmentsHoldingsGetResponse, error)
	InvestmentsTransactionsGetFn func(context.Context, string, string, string, []string, int32, int32) (plaidapi.InvestmentsTransactionsGetResponse, error)
	SyncFn                       func(context.Context, string, string) (plaidapi.TransactionsSyncResponse, error)
	CreateLinkTokenFn            func(context.Context, string) (string, time.Time, error)
	CreateUpdateLinkTokenFn      func(context.Context, string, string, bool, bool) (string, time.Time, error)
	ExchangePublicTokenFn        func(context.Context, string) (string, string, error)
	ItemGetFn                    func(context.Context, string) (plaidapi.Item, error)
	InstitutionFn                func(context.Context, string) (plaidapi.Institution, error)
	TransactionsRecurringGetFn   func(context.Context, string, []string) (plaidapi.TransactionsRecurringGetResponse, error)
}

func configured[F any](ok bool, value, fallback F) F { return lo.Ternary(ok, value, fallback) }

func (s PlaidClientStub) Accounts(ctx context.Context, accessToken string) ([]plaidapi.AccountBase, error) {
	return configured(s.AccountsFn != nil, s.AccountsFn, func(context.Context, string) ([]plaidapi.AccountBase, error) { return []plaidapi.AccountBase{}, nil })(ctx, accessToken)
}

func (s PlaidClientStub) AccountsBalanceGet(ctx context.Context, accessToken string) ([]plaidapi.AccountBase, error) {
	return configured(s.AccountsBalanceGetFn != nil, s.AccountsBalanceGetFn, func(context.Context, string) ([]plaidapi.AccountBase, error) { return []plaidapi.AccountBase{}, nil })(ctx, accessToken)
}

func (s PlaidClientStub) InvestmentsHoldingsGet(ctx context.Context, accessToken string) (plaidapi.InvestmentsHoldingsGetResponse, error) {
	return configured(s.InvestmentsHoldingsGetFn != nil, s.InvestmentsHoldingsGetFn, func(context.Context, string) (plaidapi.InvestmentsHoldingsGetResponse, error) {
		return plaidapi.InvestmentsHoldingsGetResponse{}, nil
	})(ctx, accessToken)
}

func (s PlaidClientStub) InvestmentsTransactionsGet(
	ctx context.Context,
	accessToken, startDate, endDate string,
	accountIDs []string,
	count, offset int32,
) (plaidapi.InvestmentsTransactionsGetResponse, error) {
	return configured(s.InvestmentsTransactionsGetFn != nil, s.InvestmentsTransactionsGetFn, func(context.Context, string, string, string, []string, int32, int32) (plaidapi.InvestmentsTransactionsGetResponse, error) {
		return plaidapi.InvestmentsTransactionsGetResponse{}, nil
	})(ctx, accessToken, startDate, endDate, accountIDs, count, offset)
}

func (s PlaidClientStub) Sync(ctx context.Context, accessToken, cursor string) (plaidapi.TransactionsSyncResponse, error) {
	return configured(s.SyncFn != nil, s.SyncFn, func(context.Context, string, string) (plaidapi.TransactionsSyncResponse, error) {
		return plaidapi.TransactionsSyncResponse{}, nil
	})(ctx, accessToken, cursor)
}

func (s PlaidClientStub) CreateLinkToken(ctx context.Context, owner string) (string, time.Time, error) {
	return configured(s.CreateLinkTokenFn != nil, s.CreateLinkTokenFn, func(context.Context, string) (string, time.Time, error) { return "", time.Time{}, nil })(ctx, owner)
}

func (s PlaidClientStub) CreateUpdateLinkToken(ctx context.Context, accessToken, owner string, investmentsEnabled, liabilitiesEnabled bool) (string, time.Time, error) {
	return configured(s.CreateUpdateLinkTokenFn != nil, s.CreateUpdateLinkTokenFn, func(context.Context, string, string, bool, bool) (string, time.Time, error) {
		return "", time.Time{}, nil
	})(ctx, accessToken, owner, investmentsEnabled, liabilitiesEnabled)
}

func (s PlaidClientStub) ExchangePublicToken(ctx context.Context, publicToken string) (string, string, error) {
	return configured(s.ExchangePublicTokenFn != nil, s.ExchangePublicTokenFn, func(context.Context, string) (string, string, error) { return "", "", nil })(ctx, publicToken)
}

func (s PlaidClientStub) ItemGet(ctx context.Context, accessToken string) (plaidapi.Item, error) {
	return configured(s.ItemGetFn != nil, s.ItemGetFn, func(context.Context, string) (plaidapi.Item, error) { return plaidapi.Item{}, nil })(ctx, accessToken)
}

func (s PlaidClientStub) Institution(ctx context.Context, institutionID string) (plaidapi.Institution, error) {
	return configured(s.InstitutionFn != nil, s.InstitutionFn, func(context.Context, string) (plaidapi.Institution, error) { return plaidapi.Institution{}, nil })(ctx, institutionID)
}

func (s PlaidClientStub) TransactionsRecurringGet(ctx context.Context, accessToken string, accountIDs []string) (plaidapi.TransactionsRecurringGetResponse, error) {
	return configured(s.TransactionsRecurringGetFn != nil, s.TransactionsRecurringGetFn, func(context.Context, string, []string) (plaidapi.TransactionsRecurringGetResponse, error) {
		return plaidapi.TransactionsRecurringGetResponse{}, nil
	})(ctx, accessToken, accountIDs)
}

func AccountBase(id, name, mask, accountType, subtype string) plaidapi.AccountBase {
	account := plaidapi.NewAccountBaseWithDefaults()
	account.SetAccountId(id)
	account.SetName(name)
	if mask != "" {
		account.SetMask(mask)
	}
	account.SetType(plaidapi.AccountType(accountType))
	account.SetSubtype(plaidapi.AccountSubtype(subtype))
	return *account
}

func DateTime(value string) time.Time {
	return lo.Must(time.Parse(time.RFC3339, value))
}

type EventSink[T any] struct {
	TodayValue string
	NowValue   time.Time
	Err        error
	Events     []T
}

func (s *EventSink[T]) Open(context.Context) (chan<- T, <-chan error) {
	events := make(chan T)
	result := make(chan error, 1)
	go func() {
		for event := range events {
			s.Events = append(s.Events, event)
		}
		result <- s.Err
	}()
	return events, result
}

func (s *EventSink[T]) Today() string { return s.TodayValue }

func (s *EventSink[T]) Now() time.Time { return s.NowValue }

type ScheduleFake struct {
	ID       syncerids.ID
	Due      bool
	Cron     string
	NextSync *time.Time
}

func (s *ScheduleFake) BalanceSyncScheduleDue(ctx context.Context, id syncerids.ID, _ time.Time) (string, bool, error) {
	cron, err := s.BalanceSyncScheduleCron(ctx, id)
	if err != nil || !s.Due {
		return "", false, err
	}
	return cron, true, nil
}

func (s *ScheduleFake) BalanceSyncScheduleCron(_ context.Context, id syncerids.ID) (string, error) {
	if id != s.ID {
		return "", errors.New("unexpected schedule id")
	}
	return cmp.Or(s.Cron, "30 16 * * *"), nil
}

func (s *ScheduleFake) SetBalanceSyncScheduleSynced(_ context.Context, id syncerids.ID, next time.Time) error {
	if id != s.ID {
		return errors.New("unexpected schedule id")
	}
	next = next.UTC()
	s.NextSync = &next
	return nil
}

func FakeAccountIDByExternalID(externalID string, accountIDMaps ...map[string]int64) (int64, error) {
	for _, accountIDs := range accountIDMaps {
		if id, ok := accountIDs[externalID]; ok {
			return id, nil
		}
	}
	return 1, nil
}
