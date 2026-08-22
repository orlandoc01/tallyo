package handler

import (
	"encoding/csv"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"
	"tallyo/internal/transactions"
	u "tallyo/internal/utils"

	"github.com/samber/lo"
)

const exportPageSize = 500

var exportCSVHeader = []string{
	"external_id", "source", "datetime", "posted_datetime", "amount", "merchant_name", "original_name",
	"category", "account_id", "account_name", "owner",
	"notes", "is_recurring", "is_reviewed", "is_hidden", "pending",
}

func exportHandler(store transactions.ImportExportStore, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		filter, err := parseExportFilter(r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		page, cursor, err := store.ExportTransactionPage(r.Context(), filter, nil, exportPageSize)
		if err != nil {
			logger.Error("export query failed", "error", err)
			http.Error(w, "export failed", http.StatusInternalServerError)
			return
		}

		filename := "transactions-" + time.Now().Format("2006-01-02") + ".csv"
		w.Header().Set("Content-Type", "text/csv")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))

		cw := csv.NewWriter(w)
		_ = cw.Write(exportCSVHeader)
		for {
			for _, tx := range page {
				_ = cw.Write(exportRow(tx))
			}
			cw.Flush()
			if err := cw.Error(); err != nil {
				logger.Error("csv flush error", "error", err)
				return
			}
			if cursor == nil {
				return
			}
			page, cursor, err = store.ExportTransactionPage(r.Context(), filter, cursor, exportPageSize)
			if err != nil {
				logger.Error("export query failed mid-stream", "error", err)
				return
			}
		}
	}
}

func exportRow(row transactions.ExportTransaction) []string {
	tx := row.Transaction
	category := ""
	if tx.Category != nil {
		category = tx.Category.Name
	}
	accountID, accountName, owner := "", "", ""
	if tx.Account != nil {
		accountID = tx.Account.ID.EncodedString()
		accountName = tx.Account.Name
		if tx.Account.Owner != nil {
			owner = tx.Account.Owner.Name
		}
	}
	return []string{
		safeCSVText(row.ExternalID),
		safeCSVText(row.Source),
		tx.Datetime.UTC().Format(time.RFC3339),
		tx.PostedDatetime.UTC().Format(time.RFC3339),
		formatCents(tx.Amount),
		safeCSVText(lo.FromPtr(tx.MerchantName)),
		safeCSVText(lo.FromPtr(tx.OriginalName)),
		safeCSVText(category),
		accountID,
		safeCSVText(accountName),
		safeCSVText(owner),
		safeCSVText(lo.FromPtr(tx.Notes)),
		strconv.FormatBool(tx.IsRecurring),
		strconv.FormatBool(tx.IsReviewed),
		strconv.FormatBool(tx.IsHidden),
		strconv.FormatBool(tx.Pending),
	}
}

func formatCents(cents money.Cents) string {
	sign := ""
	magnitude := uint64(cents)
	if cents < 0 {
		sign = "-"
		magnitude = uint64(-(cents + 1)) + 1
	}
	return fmt.Sprintf("%s%d.%02d", sign, magnitude/100, magnitude%100)
}

func safeCSVText(value string) string {
	if value == "" {
		return ""
	}

	switch value[0] {
	case '=', '+', '-', '@', '\t', '\r':
		return "'" + value
	default:
		return value
	}
}

func parseExportFilter(r *http.Request) (*model.TransactionsFilter, error) {
	q := r.URL.Query()
	f := &model.TransactionsFilter{}

	if q.Get("datetimeFrom") != "" || q.Get("datetimeTo") != "" {
		f.DatetimeRange = &model.DateTimeRange{}
		for _, field := range []struct {
			name string
			dest **time.Time
		}{{"datetimeFrom", &f.DatetimeRange.From}, {"datetimeTo", &f.DatetimeRange.To}} {
			if q.Get(field.name) == "" {
				continue
			}
			dt, err := parseDateTimeParam(q.Get(field.name))
			if err != nil {
				return nil, fmt.Errorf("invalid %s: %w", field.name, err)
			}
			*field.dest = dt
		}
	}
	for _, field := range []struct {
		name string
		dest **string
	}{
		{"merchantPrefix", &f.MerchantPrefix},
		{"originalPrefix", &f.OriginalPrefix},
		{"search", &f.Search},
	} {
		if value := q.Get(field.name); value != "" {
			*field.dest = &value
		}
	}

	var err error
	for _, field := range []struct {
		name string
		dest *[]*model.GlobalID
	}{{"categoryIds", &f.CategoryIds}, {"accountIds", &f.AccountIds}, {"ownerIds", &f.OwnerIds}, {"tagIds", &f.TagIds}} {
		if *field.dest, err = parseGlobalIDList(q.Get(field.name)); err != nil {
			return nil, fmt.Errorf("invalid %s: %w", field.name, err)
		}
	}
	if err := model.ValidateTransactionsFilterIDTypes(f); err != nil {
		return nil, err
	}

	for _, field := range []struct {
		name string
		dest **bool
	}{{"isReviewed", &f.IsReviewed}, {"isRecurring", &f.IsRecurring}, {"isPending", &f.IsPending}, {"isHidden", &f.IsHidden}, {"excludeTransfers", &f.ExcludeTransfers}, {"excludeIncome", &f.ExcludeIncome}, {"untagged", &f.Untagged}} {
		if *field.dest, err = parseBoolParam(q.Get(field.name)); err != nil {
			return nil, fmt.Errorf("invalid %s: %w", field.name, err)
		}
	}

	for _, field := range []struct {
		name string
		dest **money.Cents
	}{
		{"amountMin", &f.AmountMin},
		{"amountMax", &f.AmountMax},
		{"exactAmount", &f.ExactAmount},
	} {
		if *field.dest, err = parseMoneyParam(q.Get(field.name)); err != nil {
			return nil, fmt.Errorf("invalid %s: %w", field.name, err)
		}
	}
	return f, nil
}

func parseGlobalIDList(v string) ([]*model.GlobalID, error) {
	decode := func(s string) (*model.GlobalID, error) {
		id, err := model.DecodeGlobalID(s)
		if err != nil {
			return nil, err
		}
		return &id, nil
	}
	return u.MapErr(splitCSVParam(v), decode)
}

func parseDateTimeParam(v string) (*time.Time, error) {
	t, err := time.Parse(time.RFC3339, v)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func parseBoolParam(v string) (*bool, error) {
	switch v {
	case "":
		return nil, nil
	case "true", "1":
		return new(true), nil
	case "false", "0":
		return new(false), nil
	default:
		return nil, fmt.Errorf("value %q is not a boolean", v)
	}
}

func parseMoneyParam(v string) (*money.Cents, error) {
	if v == "" {
		return nil, nil
	}
	fl, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return nil, fmt.Errorf("value %q is not a number: %w", v, err)
	}
	cents, err := money.FromDollarsChecked(fl)
	if err != nil {
		return nil, err
	}
	return new(cents), nil
}

func splitCSVParam(v string) []string {
	if v == "" {
		return nil
	}
	return u.Map(strings.Split(v, ","), strings.TrimSpace)
}
