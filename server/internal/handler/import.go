package handler

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"tallyo/internal/auth"
	"tallyo/internal/money"
	"tallyo/internal/transactions"
)

const maxImportSize = 10 << 20 // 10 MB

func importHandler(store transactions.ImportExportStore, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxImportSize)
		if err := r.ParseMultipartForm(maxImportSize); err != nil {
			http.Error(w, "invalid multipart form or file too large", http.StatusBadRequest)
			return
		}
		file, _, err := r.FormFile("file")
		if auth.HTTPFail(w, err, http.StatusBadRequest, "missing file field") {
			return
		}
		defer func() { _ = file.Close() }()

		rows, parseErrs, err := parseImportCSV(file)
		if err != nil {
			http.Error(w, fmt.Sprintf("csv parse error: %s", err), http.StatusBadRequest)
			return
		}

		result, err := store.ImportTransactions(r.Context(), rows)
		if err != nil {
			logger.Error("import transactions failed", "error", err)
			http.Error(w, "import failed", http.StatusInternalServerError)
			return
		}
		// Prepend CSV parse errors so row numbers align with the original file.
		if len(parseErrs) > 0 {
			result.Skipped += len(parseErrs)
			result.Errors = append(parseErrs, result.Errors...)
		}
		if result.Errors == nil {
			result.Errors = []transactions.ImportRowError{}
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(result); err != nil {
			logger.Error("import encode response", "error", err)
		}
	}
}

// normalizeDatetime parses a bare YYYY-MM-DD string as noon UTC.
func normalizeDatetime(s string) (time.Time, error) {
	if len(s) == 10 && s[4] == '-' && s[7] == '-' {
		date, err := time.Parse(time.DateOnly, s)
		if err != nil {
			return time.Time{}, err
		}
		return time.Date(date.Year(), date.Month(), date.Day(), 12, 0, 0, 0, time.UTC), nil
	}
	return time.Parse(time.RFC3339, s)
}

func parseImportCSV(r io.Reader) ([]transactions.ImportRow, []transactions.ImportRowError, error) {
	cr := csv.NewReader(r)
	cr.TrimLeadingSpace = true

	header, err := cr.Read()
	if err != nil {
		return nil, nil, fmt.Errorf("read header: %w", err)
	}

	colIndex := make(map[string]int, len(header))
	for i, h := range header {
		colIndex[strings.ToLower(strings.TrimSpace(h))] = i
	}

	for _, required := range []string{"account_id", "datetime", "amount"} {
		if _, ok := colIndex[required]; !ok {
			return nil, nil, fmt.Errorf("missing required column %q", required)
		}
	}
	_, hasMerchant := colIndex["merchant_name"]
	_, hasOriginal := colIndex["original_name"]
	if !hasMerchant && !hasOriginal {
		return nil, nil, fmt.Errorf("CSV must contain at least one of: merchant_name, original_name")
	}

	col := func(record []string, name string) string {
		i, ok := colIndex[name]
		if !ok || i >= len(record) {
			return ""
		}
		return strings.TrimSpace(record[i])
	}

	var rows []transactions.ImportRow
	var parseErrs []transactions.ImportRowError

	for rowNum := 1; ; rowNum++ {
		record, err := cr.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, nil, fmt.Errorf("read row %d: %w", rowNum, err)
		}

		accountID := col(record, "account_id")
		externalID := col(record, "external_id")
		source := col(record, "source")
		if source == "" {
			source = transactions.TransactionSourceManual
		}
		datetimeRaw := col(record, "datetime")
		amountStr := col(record, "amount")
		merchant := col(record, "merchant_name")
		original := col(record, "original_name")

		switch {
		case accountID == "":
			parseErrs = append(parseErrs, transactions.ImportRowError{Row: rowNum, Message: "account_id is required"})
			continue
		case datetimeRaw == "":
			parseErrs = append(parseErrs, transactions.ImportRowError{Row: rowNum, Message: "datetime is required"})
			continue
		case merchant == "" && original == "":
			parseErrs = append(parseErrs, transactions.ImportRowError{Row: rowNum, Message: "merchant_name or original_name is required"})
			continue
		}

		amount, err := money.ParseDecimal(amountStr)
		if err != nil {
			parseErrs = append(parseErrs, transactions.ImportRowError{Row: rowNum, Message: fmt.Sprintf("invalid amount %q", amountStr)})
			continue
		}

		// Normalize bare YYYY-MM-DD dates to match Plaid sync's noon UTC fallback.
		dt, err := normalizeDatetime(datetimeRaw)
		if err != nil {
			parseErrs = append(parseErrs, transactions.ImportRowError{Row: rowNum, Message: fmt.Sprintf("invalid datetime %q", datetimeRaw)})
			continue
		}
		postedDtRaw := col(record, "posted_datetime")
		postedDt := dt
		if postedDtRaw != "" {
			parsed, err := normalizeDatetime(postedDtRaw)
			if err != nil {
				parseErrs = append(parseErrs, transactions.ImportRowError{Row: rowNum, Message: fmt.Sprintf("invalid posted_datetime %q", col(record, "posted_datetime"))})
				continue
			}
			postedDt = parsed
		}

		rows = append(rows, transactions.ImportRow{
			RowNum:         rowNum,
			ExternalID:     externalID,
			Source:         source,
			AccountID:      accountID,
			Datetime:       dt,
			PostedDatetime: postedDt,
			Amount:         amount,
			MerchantName:   merchant,
			OriginalName:   original,
			Category:       col(record, "category"),
			Notes:          col(record, "notes"),
			IsRecurring:    strings.EqualFold(col(record, "is_recurring"), "true"),
			IsHidden:       strings.EqualFold(col(record, "is_hidden"), "true"),
		})
	}
	return rows, parseErrs, nil
}
