package txnplaid

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"tallyo/internal/transactions"
	u "tallyo/internal/utils"

	plaidapi "github.com/plaid/plaid-go/v20/plaid"
	"github.com/samber/lo"
)

func convertTransaction(ctx context.Context, tx plaidapi.Transaction) (transactions.SyncedTransaction, error) {
	rawJSON, err := json.Marshal(tx)
	if err != nil {
		return transactions.SyncedTransaction{}, fmt.Errorf(
			"marshal raw plaid transaction %q: %w",
			tx.GetTransactionId(),
			err,
		)
	}
	rawJSONString := string(rawJSON)
	merchant := lo.EmptyableToPtr(tx.GetMerchantName())
	original := lo.EmptyableToPtr(tx.GetOriginalDescription())
	if original == nil {
		original = lo.EmptyableToPtr(tx.GetName())
	}
	return transactions.SyncedTransaction{
		ExternalID:      tx.GetTransactionId(),
		AccountID:       tx.GetAccountId(),
		Amount:          tx.GetAmount(),
		Datetime:        transactionDatetime(tx),
		PostedDatetime:  transactionPostedDatetime(tx),
		MerchantName:    merchant,
		OriginalName:    original,
		LogoURL:         extractTransactionLogoURL(tx),
		PlaidCategory:   plaidCategory(tx),
		RawProviderJSON: &rawJSONString,
		Source:          transactions.TransactionSourcePlaid,
		Pending:         tx.GetPending(),
	}, ctx.Err()
}

// extractTransactionLogoURL prefers Plaid-provided transaction logos first,
// then counterparty logos, then website favicons. The DuckDuckGo favicon
// fallback is intentionally last so generic favicons do not replace branded
// assets returned directly by Plaid.
func extractTransactionLogoURL(tx plaidapi.Transaction) *string {
	if url := tx.GetLogoUrl(); url != "" {
		return &url
	}
	for _, cp := range tx.GetCounterparties() {
		if url := cp.GetLogoUrl(); url != "" {
			return &url
		}
	}
	for _, cp := range tx.GetCounterparties() {
		if website := cp.GetWebsite(); website != "" {
			return u.DuckDuckGoFaviconURL(website)
		}
	}
	return nil
}

// transactionDatetime keeps date-only Plaid values at noon UTC so clients
// rendering in local timezones do not roll them back to the previous day.
func transactionDatetime(tx plaidapi.Transaction) time.Time {
	if t, ok := tx.GetAuthorizedDatetimeOk(); ok && t != nil {
		return formatPlaidDatetime(*t)
	}
	if s, ok := tx.GetAuthorizedDateOk(); ok && s != nil && *s != "" {
		return plaidDateOnlyDatetime(*s)
	}
	if t, ok := tx.GetDatetimeOk(); ok && t != nil {
		return formatPlaidDatetime(*t)
	}
	return plaidDateOnlyDatetime(tx.GetDate())
}

func transactionPostedDatetime(tx plaidapi.Transaction) time.Time {
	if t, ok := tx.GetDatetimeOk(); ok && t != nil {
		return formatPlaidDatetime(*t)
	}
	return plaidDateOnlyDatetime(tx.GetDate())
}

// formatPlaidDatetime treats midnight timestamps as date-only values and keeps
// them at noon UTC for the same timezone-safe rendering reason.
func formatPlaidDatetime(t time.Time) time.Time {
	utc := t.UTC()
	if utc.Hour() == 0 && utc.Minute() == 0 && utc.Second() == 0 && utc.Nanosecond() == 0 {
		return time.Date(utc.Year(), utc.Month(), utc.Day(), 12, 0, 0, 0, time.UTC)
	}
	return utc
}

func plaidDateOnlyDatetime(value string) time.Time {
	date, err := time.Parse(time.DateOnly, value)
	if err != nil {
		return time.Time{}
	}
	return time.Date(date.Year(), date.Month(), date.Day(), 12, 0, 0, 0, time.UTC)
}

func plaidCategory(tx plaidapi.Transaction) *string {
	if pfc, ok := tx.GetPersonalFinanceCategoryOk(); ok {
		primary := pfc.GetPrimary()
		detailed := pfc.GetDetailed()
		joined := primary + ":" + detailed
		return &joined
	}
	if categories := tx.GetCategory(); len(categories) > 0 {
		joined := strings.Join(categories, ":")
		return &joined
	}
	return nil
}
