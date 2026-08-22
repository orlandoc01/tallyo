package handler

import (
	"strings"
	"testing"
	"time"

	"tallyo/internal/money"
	"tallyo/internal/transactions"
	"tallyo/internal/utils/must"
)

func TestNormalizeDatetime(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{"2026-05-01", "2026-05-01T12:00:00Z"},
		{"2026-05-01T00:00:00Z", "2026-05-01T00:00:00Z"},
		{"2026-05-01T15:30:00Z", "2026-05-01T15:30:00Z"},
		{"", ""},
		{"2026-05", "2026-05"},
	}
	for _, tc := range cases {
		got, err := normalizeDatetime(tc.input)
		if tc.want == "" || !strings.Contains(tc.want, "T") {
			if err == nil {
				t.Errorf("normalizeDatetime(%q) error = nil, want failure", tc.input)
			}
			continue
		}
		if err != nil {
			t.Errorf("normalizeDatetime(%q) error = %v", tc.input, err)
			continue
		}
		if formatted := got.UTC().Format(time.RFC3339); formatted != tc.want {
			t.Errorf("normalizeDatetime(%q) = %q, want %q", tc.input, formatted, tc.want)
		}
	}
}

func TestParseImportCSVMissingRequiredColumn(t *testing.T) {
	cases := []struct {
		name string
		csv  string
	}{
		{"missing account_id", "datetime,amount,merchant_name\n2026-05-01,10.00,Shop"},
		{"missing datetime", "account_id,amount,merchant_name\nacc1,10.00,Shop"},
		{"missing amount", "account_id,datetime,merchant_name\nacc1,2026-05-01,Shop"},
		{"missing name columns", "account_id,datetime,amount\nacc1,2026-05-01,10.00"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := parseImportCSV(strings.NewReader(tc.csv))
			if err == nil {
				t.Fatalf("expected error for %s", tc.name)
			}
		})
	}
}

func TestParseImportCSVValidRows(t *testing.T) {
	csv := `external_id,source,account_id,datetime,amount,merchant_name,original_name,category,notes,is_recurring,is_hidden,posted_datetime
csv-1,plaid,acc1,2026-05-01,10.50,Coffee Shop,,Food,my note,true,true,2026-05-02
,manual,acc2,2026-05-02T12:00:00Z,-5.00,,Original Name,,,false,false,
csv-3,,acc3,2026-05-03,20.00,Merchant,,,,true,,2026-05-03
`
	rows, errs, err := parseImportCSV(strings.NewReader(csv))
	must.NoErr(t, err)
	if len(errs) != 0 {
		t.Fatalf("unexpected parse errors: %v", errs)
	}
	if len(rows) != 3 {
		t.Fatalf("expected 3 rows, got %d", len(rows))
	}

	// bare date normalized to ISO 8601 noon UTC, matching Plaid sync fallback.
	if rows[0].Datetime.UTC().Format(time.RFC3339) != "2026-05-01T12:00:00Z" {
		t.Errorf("row[0].Datetime = %q, want normalized", rows[0].Datetime)
	}
	if rows[0].PostedDatetime.UTC().Format(time.RFC3339) != "2026-05-02T12:00:00Z" {
		t.Errorf("row[0].PostedDatetime = %q", rows[0].PostedDatetime)
	}
	if rows[0].ExternalID != "csv-1" ||
		rows[0].Source != transactions.TransactionSourcePlaid ||
		rows[0].Amount != money.FromDollars(10.50) ||
		rows[0].MerchantName != "Coffee Shop" ||
		rows[0].Category != "Food" ||
		rows[0].Notes != "my note" ||
		!rows[0].IsRecurring ||
		!rows[0].IsHidden {
		t.Errorf("row[0] = %+v", rows[0])
	}

	// full ISO 8601 datetime unchanged; posted_datetime defaults to datetime
	if rows[1].Datetime.UTC().Format(time.RFC3339) != "2026-05-02T12:00:00Z" {
		t.Errorf("row[1].Datetime = %q", rows[1].Datetime)
	}
	if rows[1].PostedDatetime.UTC().Format(time.RFC3339) != "2026-05-02T12:00:00Z" {
		t.Errorf("row[1].PostedDatetime = %q, expected fallback to Datetime", rows[1].PostedDatetime)
	}
	if rows[1].OriginalName != "Original Name" || rows[1].IsRecurring {
		t.Errorf("row[1] = %+v", rows[1])
	}
	if rows[1].Source != transactions.TransactionSourceManual || rows[2].Source != transactions.TransactionSourceManual {
		t.Errorf("expected manual/default sources, got rows[1]=%q rows[2]=%q", rows[1].Source, rows[2].Source)
	}
	if rows[2].ExternalID != "csv-3" {
		t.Errorf("row[2].ExternalID = %q", rows[2].ExternalID)
	}
	if rows[1].IsHidden || rows[2].IsHidden {
		t.Errorf("expected false/default is_hidden values, got rows[1]=%v rows[2]=%v", rows[1].IsHidden, rows[2].IsHidden)
	}
}

func TestParseImportCSVRowErrors(t *testing.T) {
	csv := `account_id,datetime,amount,merchant_name
,2026-05-01,10.00,Shop
acc1,,10.00,Shop
acc1,2026-05-01,10.00,
acc1,2026-05-01,notanumber,Shop
acc1,2026-05-01,10.001,Shop
acc1,not-a-date,10.00,Shop
`
	_, errs, err := parseImportCSV(strings.NewReader(csv))
	must.NoErr(t, err)
	if len(errs) != 6 {
		t.Fatalf("expected 6 row errors, got %d: %v", len(errs), errs)
	}
}

func TestParseImportCSVRejectsInvalidPostedDatetime(t *testing.T) {
	csv := `account_id,datetime,amount,merchant_name,posted_datetime
acc1,2026-05-01,10.00,Shop,not-a-date
`
	_, errs, err := parseImportCSV(strings.NewReader(csv))
	must.NoErr(t, err)
	if len(errs) != 1 || !strings.Contains(errs[0].Message, "invalid posted_datetime") {
		t.Fatalf("expected posted_datetime row error, got %v", errs)
	}
}
