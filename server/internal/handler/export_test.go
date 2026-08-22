package handler

import (
	"fmt"
	"net/http/httptest"
	"testing"
	"time"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/transactions"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
)

func TestParseBoolParam(t *testing.T) {
	cases := []struct {
		input string
		want  *bool
	}{
		{"", nil},
		{"true", new(true)},
		{"1", new(true)},
		{"false", new(false)},
		{"0", new(false)},
	}
	for _, tc := range cases {
		got, err := parseBoolParam(tc.input)
		if err != nil {
			t.Errorf("parseBoolParam(%q) unexpected error: %v", tc.input, err)
			continue
		}
		if tc.want == nil {
			if got != nil {
				t.Errorf("parseBoolParam(%q) = %v, want nil", tc.input, *got)
			}
		} else if got == nil || *got != *tc.want {
			t.Errorf("parseBoolParam(%q) = %v, want %v", tc.input, got, *tc.want)
		}
	}
}

func TestSplitCSVParam(t *testing.T) {
	if got := splitCSVParam(""); got != nil {
		t.Errorf("splitCSVParam(\"\") = %v, want nil", got)
	}
	got := splitCSVParam("a, b, c")
	if len(got) != 3 || got[0] != "a" || got[1] != "b" || got[2] != "c" {
		t.Errorf("splitCSVParam(\"a, b, c\") = %v", got)
	}
}

func TestExportRow(t *testing.T) {
	merchant := "Shop"
	notes := "note"
	tx := &model.Transaction{
		ID:             model.New(model.GlobalIDTransaction, 1),
		Datetime:       test.DateTime("2026-05-01T00:00:00Z"),
		PostedDatetime: test.DateTime("2026-05-01T00:00:00Z"),
		Amount:         money.FromDollars(9.99),
		MerchantName:   &merchant,
		Notes:          &notes,
		IsRecurring:    true,
		IsReviewed:     false,
		Account: &model.Account{
			ID:    model.New(model.GlobalIDAccount, 1),
			Name:  "Checking",
			Owner: &model.Owner{ID: model.New(model.GlobalIDOwner, 1), Name: "alex"},
		},
		Category: &model.Category{Name: "Groceries"},
	}
	row := exportRow(transactions.ExportTransaction{ExternalID: "tx1", Source: "plaid", Transaction: tx})
	if row[0] != "tx1" || row[1] != "plaid" || row[2] != "2026-05-01T00:00:00Z" || row[4] != "9.99" {
		t.Errorf("exportRow() first fields = %v", row[:5])
	}
	if row[5] != "Shop" || row[7] != "Groceries" || row[8] != tx.Account.ID.EncodedString() {
		t.Errorf("exportRow() name/category fields = %v", row)
	}
	if row[11] != "note" || row[12] != "true" || row[13] != "false" {
		t.Errorf("exportRow() trailing fields = %v", row[11:])
	}

	tx2 := &model.Transaction{ID: model.New(model.GlobalIDTransaction, 2), Datetime: test.DateTime("2026-05-01T00:00:00Z"), PostedDatetime: test.DateTime("2026-05-01T00:00:00Z"), Amount: 1}
	row2 := exportRow(transactions.ExportTransaction{ExternalID: "tx2", Source: "manual", Transaction: tx2})
	if row2[5] != "" || row2[9] != "" || row2[10] != "" {
		t.Errorf("exportRow() nil fields not empty: %v", row2)
	}
}

func TestSafeCSVTextNeutralizesFormulaPrefixes(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
	}{
		{name: "equals", input: "=SUM(A1:A2)", want: "'=SUM(A1:A2)"},
		{name: "plus", input: "+cmd", want: "'+cmd"},
		{name: "minus", input: "-10", want: "'-10"},
		{name: "at", input: "@cmd", want: "'@cmd"},
		{name: "tab", input: "\t=cmd", want: "'\t=cmd"},
		{name: "carriage return", input: "\r=cmd", want: "'\r=cmd"},
		{name: "slash is safe", input: "/cmd", want: "/cmd"},
		{name: "safe text", input: "Coffee Shop", want: "Coffee Shop"},
		{name: "empty", input: "", want: ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := safeCSVText(tc.input); got != tc.want {
				t.Fatalf("safeCSVText(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestExportRowNeutralizesTextCells(t *testing.T) {
	merchant := "=merchant"
	original := "+original"
	notes := "\tmessage"
	tx := &model.Transaction{
		ID:             model.New(model.GlobalIDTransaction, 1),
		Datetime:       test.DateTime("2026-05-01T00:00:00Z"),
		PostedDatetime: test.DateTime("2026-05-01T00:00:00Z"),
		Amount:         money.FromDollars(-9.99),
		MerchantName:   &merchant,
		OriginalName:   &original,
		Notes:          &notes,
		Account: &model.Account{
			ID:    model.New(model.GlobalIDAccount, 1),
			Name:  "@checking",
			Owner: &model.Owner{ID: model.New(model.GlobalIDOwner, 1), Name: "/alex"},
		},
		Category: &model.Category{Name: "-Groceries"},
	}

	row := exportRow(transactions.ExportTransaction{ExternalID: "=tx1", Source: "manual", Transaction: tx})
	if row[0] != "'=tx1" || row[5] != "'=merchant" || row[6] != "'+original" || row[7] != "'-Groceries" {
		t.Fatalf("exportRow() text fields = %v", row[:8])
	}
	if row[4] != "-9.99" || row[9] != "'@checking" || row[10] != "/alex" || row[11] != "'\tmessage" {
		t.Fatalf("exportRow() mixed fields = %v", row)
	}
}

func TestParseExportFilter(t *testing.T) {
	cat1 := model.New(model.GlobalIDCategory, 1)
	cat2 := model.New(model.GlobalIDCategory, 2)
	cat3 := model.New(model.GlobalIDCategory, 3)
	owner1 := model.New(model.GlobalIDOwner, 1)
	owner2 := model.New(model.GlobalIDOwner, 1)
	tag := model.New(model.GlobalIDTag, 1)
	req := httptest.NewRequest("GET", fmt.Sprintf("/?datetimeFrom=2026-01-01T00:00:00Z&datetimeTo=2027-01-01T00:00:00Z&merchantPrefix=foo&categoryIds=%s,%s,%s&ownerIds=%s,%s&tagIds=%s&untagged=false&isReviewed=true&isHidden=false&amountMin=5.5&amountMax=100&excludeTransfers=1", cat1.EncodedString(), cat2.EncodedString(), cat3.EncodedString(), owner1.EncodedString(), owner2.EncodedString(), tag.EncodedString()), nil)
	f, err := parseExportFilter(req)
	must.NoErr(t, err)

	if f.DatetimeRange == nil || f.DatetimeRange.From == nil || f.DatetimeRange.From.UTC().Format(time.RFC3339) != "2026-01-01T00:00:00Z" {
		t.Errorf("DatetimeRange.From = %v", f.DatetimeRange)
	}
	if f.DatetimeRange == nil || f.DatetimeRange.To == nil || f.DatetimeRange.To.UTC().Format(time.RFC3339) != "2027-01-01T00:00:00Z" {
		t.Errorf("DatetimeRange.To = %v", f.DatetimeRange)
	}
	if f.MerchantPrefix == nil || *f.MerchantPrefix != "foo" {
		t.Errorf("MerchantPrefix = %v", f.MerchantPrefix)
	}
	if len(f.CategoryIds) != 3 || *f.CategoryIds[0] != cat1 || *f.CategoryIds[2] != cat3 {
		t.Errorf("CategoryIds = %v", f.CategoryIds)
	}
	if len(f.OwnerIds) != 2 {
		t.Errorf("OwnerIds = %v", f.OwnerIds)
	}
	if len(f.TagIds) != 1 || *f.TagIds[0] != tag || f.Untagged == nil || *f.Untagged {
		t.Errorf("tag filter = %v, untagged = %v", f.TagIds, f.Untagged)
	}
	if f.IsReviewed == nil || !*f.IsReviewed {
		t.Errorf("IsReviewed = %v", f.IsReviewed)
	}
	if f.IsHidden == nil || *f.IsHidden {
		t.Errorf("IsHidden = %v", f.IsHidden)
	}
	if f.AmountMin == nil || *f.AmountMin != money.FromDollars(5.5) {
		t.Errorf("AmountMin = %v", f.AmountMin)
	}
	if f.ExcludeTransfers == nil || !*f.ExcludeTransfers {
		t.Errorf("ExcludeTransfers = %v", f.ExcludeTransfers)
	}

	acc1 := model.New(model.GlobalIDAccount, 1)
	acc2 := model.New(model.GlobalIDAccount, 2)
	req3 := httptest.NewRequest("GET", fmt.Sprintf("/?accountIds=%s,%s&originalPrefix=orig&exactAmount=42.5", acc1.EncodedString(), acc2.EncodedString()), nil)
	f3, err := parseExportFilter(req3)
	must.NoErr(t, err)
	if len(f3.AccountIds) != 2 || *f3.AccountIds[0] != acc1 {
		t.Errorf("AccountIds = %v", f3.AccountIds)
	}
	if f3.OriginalPrefix == nil || *f3.OriginalPrefix != "orig" {
		t.Errorf("OriginalPrefix = %v", f3.OriginalPrefix)
	}
	if f3.ExactAmount == nil || *f3.ExactAmount != money.FromDollars(42.5) {
		t.Errorf("ExactAmount = %v", f3.ExactAmount)
	}

	req2 := httptest.NewRequest("GET", "/", nil)
	f2, err := parseExportFilter(req2)
	must.NoErr(t, err)
	if f2.DatetimeRange != nil || f2.MerchantPrefix != nil || f2.IsReviewed != nil {
		t.Errorf("empty filter has unexpected non-nil fields")
	}
}

func TestParseExportFilterFailsClosed(t *testing.T) {
	cases := []struct {
		name  string
		query string
	}{
		{"malformed datetime", "datetimeFrom=not-a-date"},
		{"malformed amount", "amountMin=not-a-number"},
		{"malformed bool", "isReviewed=maybe"},
		{"malformed untagged", "untagged=maybe"},
		{"malformed global id", "categoryIds=not-a-valid-id"},
		{"malformed tag id", "tagIds=not-a-valid-id"},
		{"wrong global id type", "categoryIds=" + model.New(model.GlobalIDAccount, 1).EncodedString()},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/?"+tc.query, nil)
			if _, err := parseExportFilter(req); err == nil {
				t.Fatalf("parseExportFilter(%q) expected error, got none", tc.query)
			}
		})
	}
}
