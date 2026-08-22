package txnplaid

import (
	"testing"
	"time"

	"tallyo/internal/transactions"
	"tallyo/internal/utils"
	testutil "tallyo/internal/utils/test"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
)

var errFake = fakeError("fake")

type fakeError string

func (e fakeError) Error() string { return string(e) }

func TestTransactionDatetime(t *testing.T) {
	tx := plaidapi.NewTransactionWithDefaults()
	tx.SetDate("2026-05-23")
	if got := formatTestDateTime(transactionDatetime(*tx)); got != "2026-05-23T12:00:00Z" {
		t.Errorf("transactionDatetime (date only) = %q", got)
	}

	tx2 := plaidapi.NewTransactionWithDefaults()
	tx2.SetDate("2026-05-24")
	tx2.SetAuthorizedDate("2026-05-23")
	tx2.SetDatetime(time.Date(2026, 5, 24, 9, 0, 0, 0, time.UTC))
	if got := formatTestDateTime(transactionDatetime(*tx2)); got != "2026-05-23T12:00:00Z" {
		t.Errorf("transactionDatetime (authorized_date) = %q", got)
	}

	tx3 := plaidapi.NewTransactionWithDefaults()
	tx3.SetDate("2026-05-23")
	tx3.SetDatetime(time.Date(2026, 5, 23, 10, 0, 0, 0, time.UTC))
	if got := formatTestDateTime(transactionDatetime(*tx3)); got != "2026-05-23T10:00:00Z" {
		t.Errorf("transactionDatetime (datetime fallback) = %q", got)
	}
	tx3.SetDatetime(time.Date(2026, 5, 23, 0, 0, 0, 0, time.UTC))
	if got := formatTestDateTime(transactionDatetime(*tx3)); got != "2026-05-23T12:00:00Z" {
		t.Errorf("transactionDatetime (midnight datetime fallback) = %q", got)
	}

	tx4 := plaidapi.NewTransactionWithDefaults()
	tx4.SetDate("2026-05-23")
	tx4.SetAuthorizedDate("2026-05-23")
	tx4.SetDatetime(time.Date(2026, 5, 24, 9, 0, 0, 0, time.UTC))
	tx4.SetAuthorizedDatetime(time.Date(2026, 5, 23, 19, 21, 0, 0, time.UTC))
	if got := formatTestDateTime(transactionDatetime(*tx4)); got != "2026-05-23T19:21:00Z" {
		t.Errorf("transactionDatetime (authorized_datetime) = %q", got)
	}
	tx4.SetAuthorizedDatetime(time.Date(2026, 5, 23, 0, 0, 0, 0, time.UTC))
	if got := formatTestDateTime(transactionDatetime(*tx4)); got != "2026-05-23T12:00:00Z" {
		t.Errorf("transactionDatetime (midnight authorized_datetime) = %q", got)
	}
}

func TestTransactionPostedDatetime(t *testing.T) {
	tx := plaidapi.NewTransactionWithDefaults()
	tx.SetDate("2026-05-23")
	if got := formatTestDateTime(transactionPostedDatetime(*tx)); got != "2026-05-23T12:00:00Z" {
		t.Errorf("transactionPostedDatetime (date only) = %q", got)
	}

	tx.SetDatetime(time.Date(2026, 5, 24, 9, 0, 0, 0, time.UTC))
	if got := formatTestDateTime(transactionPostedDatetime(*tx)); got != "2026-05-24T09:00:00Z" {
		t.Errorf("transactionPostedDatetime (datetime) = %q", got)
	}
	tx.SetDatetime(time.Date(2026, 5, 24, 0, 0, 0, 0, time.UTC))
	if got := formatTestDateTime(transactionPostedDatetime(*tx)); got != "2026-05-24T12:00:00Z" {
		t.Errorf("transactionPostedDatetime (midnight datetime) = %q", got)
	}
}

func formatTestDateTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339)
}

func TestPlaidCategoryPersonalFinanceCategory(t *testing.T) {
	tx := plaidapi.NewTransactionWithDefaults()
	pfc := plaidapi.NewPersonalFinanceCategoryWithDefaults()
	pfc.SetPrimary("FOOD_AND_DRINK")
	pfc.SetDetailed("FOOD_AND_DRINK_COFFEE")
	tx.SetPersonalFinanceCategory(*pfc)

	cat := plaidCategory(*tx)
	if cat == nil || *cat != "FOOD_AND_DRINK:FOOD_AND_DRINK_COFFEE" {
		t.Errorf("plaidCategory(pfc) = %v", cat)
	}
}

func TestPlaidCategoryNil(t *testing.T) {
	tx := plaidapi.NewTransactionWithDefaults()
	if got := plaidCategory(*tx); got != nil {
		t.Errorf("plaidCategory(empty) = %v", got)
	}
}

func TestDuckDuckGoFaviconURL(t *testing.T) {
	tests := []struct {
		name    string
		website string
		want    *string
	}{
		{name: "bare host", website: "americanexpress.com", want: new("https://icons.duckduckgo.com/ip3/americanexpress.com.ico")},
		{name: "scheme and path", website: "https://wellsfargo.com/checking/", want: new("https://icons.duckduckgo.com/ip3/wellsfargo.com.ico")},
		{name: "http forced to https", website: "http://example.com/path?utm=1", want: new("https://icons.duckduckgo.com/ip3/example.com.ico")},
		{name: "protocol relative", website: "//example.com/path", want: new("https://icons.duckduckgo.com/ip3/example.com.ico")},
		{name: "blank", website: "   ", want: nil},
		{name: "invalid", website: "https://", want: nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := utils.DuckDuckGoFaviconURL(tt.website)
			if tt.want == nil {
				if got != nil {
					t.Fatalf("DuckDuckGoFaviconURL(%q) = %q, want nil", tt.website, *got)
				}
				return
			}
			if got == nil || *got != *tt.want {
				t.Fatalf("DuckDuckGoFaviconURL(%q) = %v, want %q", tt.website, got, *tt.want)
			}
		})
	}
}

func TestTransactionHelpers(t *testing.T) {
	tx := plaidapi.NewTransactionWithDefaults()
	tx.SetCategory([]string{"Food", "Groceries"})
	category := plaidCategory(*tx)
	if category == nil || *category != "Food:Groceries" {
		t.Fatalf("plaidCategory() = %#v", category)
	}
}

func TestAppendGeneralErrorReportsFailure(t *testing.T) {
	report := (&Adapter{BaseAdapter: transactions.BaseAdapter{Log: testutil.Logger}}).generalErrorReport(errFake)

	if len(report.Items) != 1 || report.Items[0].Err == nil {
		t.Fatalf("generalErrorReport result = %#v", report)
	}
}
