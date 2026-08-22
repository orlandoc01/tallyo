package txnplaid

import (
	"strings"
	"testing"
	"time"

	"tallyo/internal/accounts"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
	"tallyo/internal/utils/must"
)

func TestConvertInvestmentTransaction(t *testing.T) {
	security := plaidapi.NewSecurityWithDefaults()
	security.SetSecurityId("sec-1")
	security.SetName("iShares 0-3 Month Treasury Bond ETF")
	security.SetTickerSymbol("SGOV")
	itx := plaidInvestmentTransaction("itx-1", "invest", "sec-1", "buy", "buy", 123.45, "2026-06-18")
	logoURL := "https://icons.duckduckgo.com/ip3/chase.com.ico"

	synced, err := convertInvestmentTransaction(
		itx,
		map[string]plaidapi.Security{"sec-1": *security},
		"Chase",
		&logoURL,
	)
	must.NoErr(t, err)
	if synced.ExternalID != "itx-1" || synced.AccountID != "invest" || synced.Amount != 123.45 {
		t.Fatalf("synced identity fields = %#v", synced)
	}
	if formatTestDateTime(synced.Datetime) != "2026-06-18T12:00:00Z" || formatTestDateTime(synced.PostedDatetime) != "2026-06-18T12:00:00Z" {
		t.Fatalf("synced datetimes = %q, %q", synced.Datetime, synced.PostedDatetime)
	}
	if synced.MerchantName == nil || *synced.MerchantName != "Chase - iShares 0-3 Month Treasury Bond ETF (SGOV)" {
		t.Fatalf("merchant = %#v", synced.MerchantName)
	}
	if synced.OriginalName == nil || *synced.OriginalName != "BUY" {
		t.Fatalf("original = %#v", synced.OriginalName)
	}
	if synced.LogoURL == nil || *synced.LogoURL != logoURL {
		t.Fatalf("logo = %#v", synced.LogoURL)
	}
	if synced.PlaidCategory == nil || *synced.PlaidCategory != "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS" {
		t.Fatalf("plaid category = %#v", synced.PlaidCategory)
	}
	if synced.RawProviderJSON == nil || !strings.Contains(*synced.RawProviderJSON, "itx-1") {
		t.Fatalf("raw provider json = %#v", synced.RawProviderJSON)
	}
}

func TestDeriveInvestmentMerchantNameCashEquivalentFallback(t *testing.T) {
	security := plaidapi.NewSecurityWithDefaults()
	security.SetSecurityId("cash")
	security.SetName("U.S. Dollar")
	security.SetIsCashEquivalent(true)
	itx := plaidInvestmentTransaction("itx-1", "invest", "cash", "cash", "deposit", -100, "2026-06-18")

	got := deriveInvestmentMerchantName(itx, map[string]plaidapi.Security{"cash": *security}, "Chase")
	if got != "Chase - Investment Deposit" {
		t.Fatalf("deriveInvestmentMerchantName() = %q", got)
	}
}

func TestSyntheticInvestmentPFC2(t *testing.T) {
	tests := []struct {
		name    string
		txType  string
		subtype string
		want    string
	}{
		{name: "buy", txType: "buy", subtype: "buy", want: "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS"},
		{name: "sell", txType: "sell", subtype: "sell", want: "TRANSFER_IN:TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS"},
		{name: "dividend", txType: "fee", subtype: "dividend", want: "INCOME:INCOME_DIVIDENDS"},
		{name: "interest", txType: "cash", subtype: "interest", want: "INCOME:INCOME_INTEREST_EARNED"},
		{name: "deposit", txType: "cash", subtype: "deposit", want: "TRANSFER_IN:TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS"},
		{name: "withdrawal", txType: "cash", subtype: "withdrawal", want: "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS"},
		{name: "fee", txType: "fee", subtype: "account fee", want: "BANK_FEES:BANK_FEES_OTHER_BANK_FEES"},
		{name: "transfer", txType: "transfer", subtype: "transfer", want: "TRANSFER_OUT:TRANSFER_OUT_ACCOUNT_TRANSFER"},
		{name: "cancel", txType: "cancel", subtype: "cancel", want: "TRANSFER_IN:TRANSFER_IN_OTHER_TRANSFER_IN"},
		{name: "pending credit", txType: "cash", subtype: "pending credit", want: "TRANSFER_IN:TRANSFER_IN_OTHER_TRANSFER_IN"},
		{name: "pending debit", txType: "cash", subtype: "pending debit", want: "TRANSFER_OUT:TRANSFER_OUT_OTHER_TRANSFER_OUT"},
		{name: "brokerage catchall", txType: "cash", subtype: "rebalance", want: "TRANSFER_OUT:TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			itx := plaidInvestmentTransaction("itx", "invest", "sec", tt.txType, tt.subtype, 1, "2026-06-18")
			got := syntheticInvestmentPFC2(itx)
			if got == nil || *got != tt.want {
				t.Fatalf("syntheticInvestmentPFC2() = %#v, want %q", got, tt.want)
			}
		})
	}
}

func TestInvestmentTransactionDateRange(t *testing.T) {
	now := time.Date(2026, 6, 20, 12, 0, 0, 0, time.UTC)
	adapter := &Adapter{now: func() time.Time { return now }}
	start, end := adapter.investmentTransactionDateRange(accounts.PlaidItemSecret{})
	if start != "2026-05-21" || end != "2026-06-20" {
		t.Fatalf("initial range = %s..%s", start, end)
	}

	lastSynced := time.Date(2026, 6, 14, 9, 0, 0, 0, time.UTC)
	start, end = adapter.investmentTransactionDateRange(accounts.PlaidItemSecret{LastSyncedAt: &lastSynced})
	if start != "2026-06-07" || end != "2026-06-20" {
		t.Fatalf("lookback range = %s..%s", start, end)
	}
}

func TestFilterOutInvestmentAccounts(t *testing.T) {
	checking := regularPlaidTransaction("checking", "checking", 10, "2026-06-18")
	investment := regularPlaidTransaction("investment", "invest", 20, "2026-06-18")
	filtered := filterOutInvestmentAccounts(
		[]plaidapi.Transaction{checking, investment},
		map[string]struct{}{"invest": {}},
	)
	if len(filtered) != 1 || filtered[0].GetTransactionId() != "checking" {
		t.Fatalf("filtered = %#v", filtered)
	}
}

func regularPlaidTransaction(id string, accountID string, amount float64, date string) plaidapi.Transaction {
	tx := plaidapi.NewTransactionWithDefaults()
	tx.SetTransactionId(id)
	tx.SetAccountId(accountID)
	tx.SetAmount(amount)
	tx.SetDate(date)
	tx.SetName(id)
	return *tx
}

func plaidInvestmentTransaction(
	id string,
	accountID string,
	securityID string,
	txType string,
	subtype string,
	amount float64,
	date string,
) plaidapi.InvestmentTransaction {
	itx := plaidapi.NewInvestmentTransactionWithDefaults()
	itx.SetInvestmentTransactionId(id)
	itx.SetAccountId(accountID)
	itx.SetSecurityId(securityID)
	itx.SetType(plaidapi.InvestmentTransactionType(txType))
	itx.SetSubtype(plaidapi.InvestmentTransactionSubtype(subtype))
	itx.SetAmount(amount)
	itx.SetDate(date)
	itx.SetName(strings.ToUpper(subtype))
	return *itx
}
